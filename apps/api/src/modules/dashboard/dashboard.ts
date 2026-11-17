import { Controller, Get, Injectable } from '@nestjs/common';
import type { DashboardSummaryDto } from '@kavach/shared';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Phase 1 dashboard: master-data counts only (PRD §28 Phase 1). Stock, low-stock alerts,
 * today's movements and the AI overview (PRD §5) need the ledger and arrive in Phases 2 and 3.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(ctx: RequestContext): Promise<DashboardSummaryDto> {
    const db = this.prisma.db;
    const projectId = ctx.projectId;
    const full = ctx.permissions.has('dashboard:view_full');
    const [
      materialCount,
      inactiveMaterialCount,
      categoryCount,
      storeCount,
      locationCount,
      members,
    ] = await Promise.all([
      db.material.count({ where: { projectId, status: 'ACTIVE' } }),
      db.material.count({ where: { projectId, status: 'INACTIVE' } }),
      db.materialCategory.count({ where: { projectId, isActive: true, parentId: null } }),
      ctx.storeIds === 'ALL'
        ? db.store.count({ where: { projectId, isActive: true } })
        : Promise.resolve(ctx.storeIds.length),
      db.location.count({ where: { projectId, isActive: true } }),
      full ? db.projectMember.count({ where: { projectId, status: 'ACTIVE' } }) : null,
    ]);
    return {
      view: full ? 'FULL' : 'OPERATIONAL',
      materialCount,
      inactiveMaterialCount,
      categoryCount,
      storeCount,
      locationCount,
      memberCount: members,
    };
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('dashboard:view_full', 'dashboard:view_operational')
  summary(@Ctx() ctx: RequestContext): Promise<DashboardSummaryDto> {
    return this.dashboard.summary(ctx);
  }
}
