import { Controller, Get, Injectable, Query } from '@nestjs/common';
import type { Prisma } from '@kavach/db';
import { type AuditLogDto, AuditListQuerySchema, type Paginated } from '@kavach/shared';
import type { z } from 'zod';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { zod } from '../../common/validation/zod.pipe';

type Query_ = z.output<typeof AuditListQuerySchema>;

/** Read-only view of this project's audit trail (PRD §3.1 "Audit Logs: Full Access", §18.3). */
@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, q: Query_): Promise<Paginated<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = {
      projectId: ctx.projectId,
      entityType: q.entityType,
      entityId: q.entityId,
      action: q.action,
      actorUserId: q.actorUserId,
      createdAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
    };
    const [total, rows] = await Promise.all([
      this.prisma.db.auditLog.count({ where }),
      this.prisma.db.auditLog.findMany({
        where,
        include: { actor: { select: { name: true } } },
        orderBy: { id: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id.toString(),
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actorType: r.actorType,
        actorUserId: r.actorUserId,
        actorName: r.actor?.name ?? null,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly logs: AuditLogsService) {}

  @Get()
  @RequirePermission('audit_log:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(AuditListQuerySchema)) query: Query_,
  ): Promise<Paginated<AuditLogDto>> {
    return this.logs.list(ctx, query);
  }
}
