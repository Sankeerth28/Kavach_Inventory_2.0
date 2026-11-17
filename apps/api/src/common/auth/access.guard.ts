import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdSchema, isRoleCode, permissionsForRole } from '@kavach/shared';
import type { AuthContext, KavachRequest } from '../context/request-context';
import { DomainError, forbidden, unauthenticated } from '../errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { requestIdOf } from '../../app.setup';
import { ACCESS_KEY, type AccessRule } from './access.decorators';
import { TokenService } from './token.service';

/**
 * The single gate in front of every route (CLAUDE.md invariants 6 and 7, PRD §3, ARCHITECTURE §6.1).
 *
 * 1. A route with no access declaration is denied.
 * 2. The bearer token must be valid and the user active.
 * 3. A user who must change their password can do nothing else.
 * 4. Project routes need `X-Project-Id`, an active membership of that project, and a role that
 *    holds the required permission. The membership is read on every request, so removing a
 *    member or changing a role takes effect immediately.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(host: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
      host.getHandler(),
      host.getClass(),
    ]);
    if (!rule) throw forbidden(); // default-deny
    if (rule.kind === 'public') return true;

    const req = host.switchToHttp().getRequest<KavachRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthenticated();
    const userId = await this.tokens.verifyAccessToken(header.slice(7));

    const user = await this.prisma.unscoped.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, status: true, mustChangePassword: true },
    });
    if (!user || user.status !== 'ACTIVE') throw unauthenticated();

    const auth: AuthContext = {
      userId: user.id,
      userName: user.name,
      requestId: requestIdOf(req),
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    };
    req.auth = auth;

    const pendingAllowed = rule.kind === 'authenticated' && rule.allowPasswordChangePending;
    if (user.mustChangePassword && !pendingAllowed) {
      throw new DomainError(
        'PASSWORD_CHANGE_REQUIRED',
        'Change your password before you continue.',
        403,
      );
    }
    if (rule.kind === 'authenticated') return true;

    const projectId = req.headers['x-project-id'];
    if (typeof projectId !== 'string' || !IdSchema.safeParse(projectId).success) {
      throw new DomainError('PROJECT_REQUIRED', 'Select a project first.', 400);
    }
    const member = await this.prisma.unscoped.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: user.id } },
      select: {
        id: true,
        status: true,
        role: { select: { code: true } },
        project: { select: { status: true } },
        stores: { select: { storeId: true } },
      },
    });
    // Not a member, removed, or the project is archived: same answer, nothing revealed.
    if (!member || member.status !== 'ACTIVE' || member.project.status !== 'ACTIVE') {
      throw forbidden('You do not have access to this project.');
    }
    const roleCode = member.role.code;
    if (!isRoleCode(roleCode)) throw forbidden();

    const permissions = new Set(permissionsForRole(roleCode));
    if (!rule.anyOf.some((p) => permissions.has(p))) throw forbidden();

    req.ctx = {
      ...auth,
      projectId,
      memberId: member.id,
      roleCode,
      permissions,
      storeIds: roleCode === 'PROJECT_ADMIN' ? 'ALL' : member.stores.map((s) => s.storeId),
    };
    return true;
  }
}
