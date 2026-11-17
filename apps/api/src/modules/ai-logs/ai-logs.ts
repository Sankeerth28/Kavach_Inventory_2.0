import { Body, Controller, Get, Injectable, Patch, Query } from '@nestjs/common';
import type { Prisma } from '@kavach/db';
import {
  type AiLogDto,
  type AiLogListQuery,
  AiLogListQuerySchema,
  type AiOverviewDto,
  type ConfidenceThresholds,
  type Paginated,
  type UpdateConfidenceInput,
  UpdateConfidenceSchema,
  parseProjectSettings,
} from '@kavach/shared';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { zod } from '../../common/validation/zod.pipe';

/**
 * AI Processing Logs (PRD §3.1 "View All", §3.2 "View Own Activity", §18.3) and the AI overview
 * on the admin dashboard (PRD §5.1 E). Read-only: the log is written by the worker and is
 * append-only in the database.
 */
@Injectable()
export class AiLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: AiLogListQuery): Promise<Paginated<AiLogDto>> {
    const where: Prisma.AiProcessingLogWhereInput = { projectId: ctx.projectId };
    // "Own activity": a Store Manager sees the calls made for documents they uploaded.
    if (!ctx.permissions.has('ai_log:view_all')) where.triggeredById = ctx.userId;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.status) where.status = query.status;
    const [total, rows] = await Promise.all([
      this.prisma.db.aiProcessingLog.count({ where }),
      this.prisma.db.aiProcessingLog.findMany({
        where,
        include: {
          triggeredBy: { select: { name: true } },
          invoice: { select: { invoiceNo: true, challanNo: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        invoiceId: r.invoiceId,
        invoiceNo: r.invoice?.invoiceNo ?? r.invoice?.challanNo ?? null,
        lineNo: r.lineNo,
        stage: r.stage,
        provider: r.provider,
        model: r.model,
        promptVersion: r.promptVersion,
        attempt: r.attempt,
        status: r.status,
        latencyMs: r.latencyMs,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        errorCode: r.errorCode,
        errorMessage: r.errorMessage,
        triggeredByName: r.triggeredBy.name,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** PRD §5.1 E. Counts only; an admin sees the project, a Store Manager their own uploads. */
  async overview(ctx: RequestContext): Promise<AiOverviewDto> {
    const db = this.prisma.db;
    const projectId = ctx.projectId;
    const mine = ctx.permissions.has('ai_log:view_all') ? {} : { uploadedById: ctx.userId };
    const invoice = (status: Prisma.InvoiceWhereInput['status']) =>
      db.invoice.count({ where: { projectId, ...mine, status } });
    const item = (where: Prisma.InvoiceItemWhereInput) =>
      db.invoiceItem.count({
        where: { projectId, isManualEntry: false, invoice: { ...mine }, ...where },
      });
    const [processed, read, failed, matched, created, review, pending, processing] =
      await Promise.all([
        invoice({ in: ['READY_FOR_REVIEW', 'POSTED', 'REVERSED', 'FAILED', 'NEEDS_RECAPTURE'] }),
        invoice({ in: ['READY_FOR_REVIEW', 'POSTED', 'REVERSED'] }),
        invoice({ in: ['FAILED'] }),
        item({
          matchStatus: 'MATCHED',
          invoice: { ...mine, status: { in: ['POSTED', 'REVERSED'] } },
        }),
        item({ createdMaterialId: { not: null } }),
        item({ matchStatus: 'REVIEW_REQUIRED', invoice: { ...mine, status: 'READY_FOR_REVIEW' } }),
        invoice('READY_FOR_REVIEW'),
        invoice({ in: ['QUEUED', 'PROCESSING'] }),
      ]);
    return {
      invoicesProcessed: processed,
      successfulExtractions: read,
      failedAttempts: failed,
      matchedLines: matched,
      newMaterialsCreated: created,
      linesNeedingReview: review,
      pendingReview: pending,
      processing,
    };
  }

  async thresholds(ctx: RequestContext): Promise<ConfidenceThresholds> {
    const project = await this.prisma.db.project.findUniqueOrThrow({
      where: { id: ctx.projectId },
      select: { settings: true },
    });
    return parseProjectSettings(project.settings).confidence;
  }

  /** PRD §8.2: the confidence thresholds are configurable per project. */
  async setThresholds(
    ctx: RequestContext,
    input: UpdateConfidenceInput,
  ): Promise<ConfidenceThresholds> {
    return this.prisma.db.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: ctx.projectId },
        select: { settings: true },
      });
      const before = parseProjectSettings(project.settings).confidence;
      const settings = {
        ...((project.settings as Record<string, unknown> | null) ?? {}),
        confidence: { auto: input.auto, confirm: input.confirm },
      };
      await tx.project.update({
        where: { id: ctx.projectId },
        data: { settings: settings as Prisma.InputJsonValue },
      });
      await this.audit.write(tx, ctx, {
        action: 'settings.confidence_update',
        entityType: 'project',
        entityId: ctx.projectId,
        before,
        after: input,
      });
      return { auto: input.auto, confirm: input.confirm };
    });
  }
}

@Controller('ai-logs')
export class AiLogsController {
  constructor(private readonly logs: AiLogsService) {}

  @Get()
  @RequirePermission('ai_log:view_all', 'ai_log:view_own')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(AiLogListQuerySchema)) query: AiLogListQuery,
  ): Promise<Paginated<AiLogDto>> {
    return this.logs.list(ctx, query);
  }

  @Get('overview')
  @RequirePermission('ai_log:view_all', 'ai_log:view_own')
  overview(@Ctx() ctx: RequestContext): Promise<AiOverviewDto> {
    return this.logs.overview(ctx);
  }
}

@Controller('settings')
export class AiSettingsController {
  constructor(private readonly logs: AiLogsService) {}

  @Get('confidence')
  @RequirePermission('project:view')
  get(@Ctx() ctx: RequestContext): Promise<ConfidenceThresholds> {
    return this.logs.thresholds(ctx);
  }

  @Patch('confidence')
  @RequirePermission('settings:manage')
  set(
    @Ctx() ctx: RequestContext,
    @Body(zod(UpdateConfidenceSchema)) body: UpdateConfidenceInput,
  ): Promise<ConfidenceThresholds> {
    return this.logs.setThresholds(ctx, body);
  }
}
