import { Body, Controller, Get, Injectable, Param, Patch, Post } from '@nestjs/common';
import { Prisma, type Store } from '@kavach/db';
import { CreateStoreSchema, type StoreDto, UpdateStoreSchema } from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';

type CreateStore = z.output<typeof CreateStoreSchema>;
type UpdateStore = z.output<typeof UpdateStoreSchema>;

const toDto = (s: Store): StoreDto => ({
  id: s.id,
  code: s.code,
  name: s.name,
  address: s.address,
  isActive: s.isActive,
});

/** Physical project stores (PRD §23.3). Stock is tracked per store from Phase 2. */
@Injectable()
export class StoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Project Admins see every store; a Store Manager sees the stores they operate (Q2). */
  async list(ctx: RequestContext): Promise<StoreDto[]> {
    const stores = await this.prisma.db.store.findMany({
      where: {
        projectId: ctx.projectId,
        ...(ctx.storeIds === 'ALL' ? {} : { id: { in: [...ctx.storeIds] } }),
      },
      orderBy: { name: 'asc' },
    });
    return stores.map(toDto);
  }

  async create(ctx: RequestContext, input: CreateStore): Promise<StoreDto> {
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const store = await tx.store.create({ data: { projectId: ctx.projectId, ...input } });
        await this.audit.write(tx, ctx, {
          action: 'store.create',
          entityType: 'store',
          entityId: store.id,
          after: toDto(store),
        });
        return toDto(store);
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw conflict(`A store with the code ${input.code} already exists.`);
      }
      throw e;
    }
  }

  async update(ctx: RequestContext, id: string, input: UpdateStore): Promise<StoreDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.store.findFirst({ where: { projectId: ctx.projectId, id } });
      if (!before) throw notFound('Store');
      if (input.isActive === false && before.isActive) {
        const others = await tx.store.count({
          where: { projectId: ctx.projectId, isActive: true, id: { not: id } },
        });
        if (others === 0) throw conflict('A project needs at least one active store.');
      }
      const after = await tx.store.update({
        where: { projectId_id: { projectId: ctx.projectId, id } },
        data: { name: input.name, address: input.address, isActive: input.isActive },
      });
      await this.audit.write(tx, ctx, {
        action: 'store.update',
        entityType: 'store',
        entityId: id,
        before: toDto(before),
        after: toDto(after),
      });
      return toDto(after);
    });
  }
}

@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get()
  @RequirePermission('store:view')
  list(@Ctx() ctx: RequestContext): Promise<StoreDto[]> {
    return this.stores.list(ctx);
  }

  @Post()
  @RequirePermission('store:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateStoreSchema)) body: CreateStore,
  ): Promise<StoreDto> {
    return this.stores.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('store:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateStoreSchema)) body: UpdateStore,
  ): Promise<StoreDto> {
    return this.stores.update(ctx, id, body);
  }
}
