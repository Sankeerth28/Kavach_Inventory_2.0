import { Body, Controller, Get, HttpCode, Injectable, Param, Patch, Post } from '@nestjs/common';
import { Prisma, addMember } from '@kavach/db';
import {
  CreateUserSchema,
  type MemberDto,
  ROLE_NAMES,
  ResetPasswordSchema,
  type RoleCode,
  UpdateUserSchema,
  isRoleCode,
} from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { PasswordService } from '../../common/auth/password.service';
import { TokenService } from '../../common/auth/token.service';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { DomainError, forbidden, invalid, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';

type CreateUser = z.output<typeof CreateUserSchema>;
type UpdateUser = z.output<typeof UpdateUserSchema>;

const INCLUDE = { user: true, role: true, stores: true } satisfies Prisma.ProjectMemberInclude;
type MemberRow = Prisma.ProjectMemberGetPayload<{ include: typeof INCLUDE }>;

const toDto = (m: MemberRow): MemberDto => {
  const roleCode: RoleCode = isRoleCode(m.role.code) ? m.role.code : 'STORE_MANAGER';
  return {
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    roleCode,
    roleName: ROLE_NAMES[roleCode],
    status: m.status,
    storeIds: m.stores.map((s) => s.storeId),
    mustChangePassword: m.user.mustChangePassword,
    lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
};

/** What the audit log keeps about a member. Never a password or a hash. */
const auditView = (m: MemberDto) => ({
  name: m.name,
  email: m.email,
  phone: m.phone,
  roleCode: m.roleCode,
  status: m.status,
  storeIds: m.storeIds,
});

const multiProject = () =>
  new DomainError(
    'MULTI_PROJECT_USER',
    'This person also works on another project. Ask the system operator to make this change.',
    409,
  );

/**
 * User management for one project (PRD §3.1 "Create and manage Store Manager accounts").
 *
 * User accounts are global, memberships are per project. A Project Admin controls memberships of
 * their own project only, and may change the account itself (name, password) only while the
 * person belongs to no other project. Otherwise an admin of one project could take over an
 * account that has access to another.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async list(ctx: RequestContext): Promise<MemberDto[]> {
    const rows = await this.prisma.db.projectMember.findMany({
      where: { projectId: ctx.projectId },
      include: INCLUDE,
      orderBy: { user: { name: 'asc' } },
    });
    return rows.map(toDto);
  }

  async create(ctx: RequestContext, input: CreateUser): Promise<MemberDto> {
    const passwordHash = await this.passwords.hash(input.password);
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        await this.assertStores(tx, ctx, input.storeIds);
        const taken = await tx.user.findFirst({
          where: {
            OR: [
              ...(input.email ? [{ email: input.email }] : []),
              ...(input.phone ? [{ phone: input.phone }] : []),
            ],
          },
          select: { id: true },
        });
        if (taken) throw this.identifierTaken();

        const user = await tx.user.create({
          data: {
            name: input.name,
            email: input.email ?? null,
            phone: input.phone ?? null,
            passwordHash,
            mustChangePassword: true, // DECISIONS Q36
            createdById: ctx.userId,
          },
        });
        await addMember(tx, {
          projectId: ctx.projectId,
          userId: user.id,
          roleCode: input.roleCode,
          storeIds: input.storeIds,
        });
        const member = toDto(await this.load(tx, ctx, user.id));
        await this.audit.write(tx, ctx, {
          action: 'user.create',
          entityType: 'user',
          entityId: user.id,
          after: auditView(member),
        });
        return member;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw this.identifierTaken();
      }
      throw e;
    }
  }

  async update(ctx: RequestContext, userId: string, input: UpdateUser): Promise<MemberDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const row = await this.load(tx, ctx, userId);
      const before = toDto(row);

      const changesAccess =
        (input.roleCode !== undefined && input.roleCode !== before.roleCode) ||
        (input.status !== undefined && input.status !== before.status);
      // An admin cannot lock themselves out, so a project always keeps at least one admin.
      if (changesAccess && userId === ctx.userId) {
        throw forbidden('You cannot change your own role or access.');
      }

      if (input.name !== undefined && input.name !== before.name) {
        await this.assertSingleProject(userId);
        await tx.user.update({ where: { id: userId }, data: { name: input.name } });
      }

      const roleCode = input.roleCode ?? before.roleCode;
      const storeIds = roleCode === 'PROJECT_ADMIN' ? [] : (input.storeIds ?? before.storeIds);
      if (roleCode === 'STORE_MANAGER' && storeIds.length === 0) {
        throw invalid('Assign at least one store.');
      }
      await this.assertStores(tx, ctx, storeIds);

      if (input.roleCode !== undefined && input.roleCode !== before.roleCode) {
        const role = await tx.role.findUniqueOrThrow({ where: { code: input.roleCode } });
        await tx.projectMember.updateMany({
          where: { projectId: ctx.projectId, id: row.id },
          data: { roleId: role.id },
        });
      }
      if (input.status !== undefined && input.status !== before.status) {
        await tx.projectMember.updateMany({
          where: { projectId: ctx.projectId, id: row.id },
          data: { status: input.status },
        });
      }
      await tx.projectMemberStore.deleteMany({
        where: { projectId: ctx.projectId, memberId: row.id },
      });
      if (storeIds.length > 0) {
        await tx.projectMemberStore.createMany({
          data: storeIds.map((storeId) => ({
            projectId: ctx.projectId,
            memberId: row.id,
            storeId,
          })),
        });
      }

      const after = toDto(await this.load(tx, ctx, userId));
      await this.audit.write(tx, ctx, {
        action: 'user.update',
        entityType: 'user',
        entityId: userId,
        before: auditView(before),
        after: auditView(after),
      });
      return after;
    });
  }

  /** Sets a temporary password. The person must choose their own at next login (Q36). */
  async resetPassword(ctx: RequestContext, userId: string, password: string): Promise<void> {
    if (userId === ctx.userId) {
      throw forbidden('Use "Change password" to change your own password.');
    }
    const passwordHash = await this.passwords.hash(password);
    await this.prisma.db.$transaction(async (tx) => {
      await this.load(tx, ctx, userId);
      await this.assertSingleProject(userId);
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true },
      });
      await this.tokens.revokeAllForUser(tx, userId);
      await this.audit.write(tx, ctx, {
        action: 'user.password_reset',
        entityType: 'user',
        entityId: userId,
      });
    });
  }

  private identifierTaken(): DomainError {
    return new DomainError(
      'IDENTIFIER_TAKEN',
      'This e-mail or mobile number is already in use.',
      409,
    );
  }

  private async load(db: Db, ctx: RequestContext, userId: string): Promise<MemberRow> {
    const row = await db.projectMember.findFirst({
      where: { projectId: ctx.projectId, userId },
      include: INCLUDE,
    });
    if (!row) throw notFound('User');
    return row;
  }

  /** Every store id must be an active store of this project. */
  private async assertStores(db: Db, ctx: RequestContext, storeIds: string[]): Promise<void> {
    const unique = [...new Set(storeIds)];
    if (unique.length === 0) return;
    const found = await db.store.count({
      where: { projectId: ctx.projectId, id: { in: unique }, isActive: true },
    });
    if (found !== unique.length) throw invalid('Choose active stores of this project.');
  }

  /**
   * Counts a person's memberships across projects. Deliberately unscoped: it returns a number
   * only, and decides whether this project's admin may touch the shared account.
   */
  private async assertSingleProject(userId: string): Promise<void> {
    const memberships = await this.prisma.unscoped.projectMember.count({ where: { userId } });
    if (memberships > 1) throw multiProject();
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user:manage')
  list(@Ctx() ctx: RequestContext): Promise<MemberDto[]> {
    return this.users.list(ctx);
  }

  @Post()
  @RequirePermission('user:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateUserSchema)) body: CreateUser,
  ): Promise<MemberDto> {
    return this.users.create(ctx, body);
  }

  @Patch(':userId')
  @RequirePermission('user:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('userId', IdPipe) userId: string,
    @Body(zod(UpdateUserSchema)) body: UpdateUser,
  ): Promise<MemberDto> {
    return this.users.update(ctx, userId, body);
  }

  @Post(':userId/reset-password')
  @HttpCode(204)
  @RequirePermission('user:manage')
  async resetPassword(
    @Ctx() ctx: RequestContext,
    @Param('userId', IdPipe) userId: string,
    @Body(zod(ResetPasswordSchema)) body: z.output<typeof ResetPasswordSchema>,
  ): Promise<void> {
    await this.users.resetPassword(ctx, userId, body.password);
  }
}
