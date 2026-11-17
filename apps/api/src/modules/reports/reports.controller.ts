import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  REPORT_LIMITS,
  type ReportDefinition,
  type ReportDto,
  type ReportExportQuery,
  ReportExportQuerySchema,
  type ReportKey,
  type ReportQuery,
  ReportQuerySchema,
  isReportKey,
} from '@kavach/shared';
import type { Response } from 'express';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { forbidden, notFound } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RATE_RULES, RateLimiter } from '../../common/rate-limit/rate-limiter';
import { zod } from '../../common/validation/zod.pipe';
import { reportFileName, reportToPdf, reportToXlsx } from './report-export';
import { ReportsService } from './reports.service';

function reportKey(value: string): ReportKey {
  if (!isReportKey(value)) throw notFound('Report');
  return value;
}

const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

/**
 * Reports (PRD §19). A Project Admin sees all ten; a Store Manager sees the operational ones,
 * for their own stores (PRD §3.2, DECISIONS Q18). Which report a role may open is decided in
 * `ReportsService.run`, not by which links the screen shows.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
  ) {}

  @Get()
  @RequirePermission('report:view_all', 'report:view_operational')
  list(@Ctx() ctx: RequestContext): ReportDefinition[] {
    return this.reports.available(ctx);
  }

  @Get(':key')
  @RequirePermission('report:view_all', 'report:view_operational')
  run(
    @Ctx() ctx: RequestContext,
    @Param('key') key: string,
    @Query(zod(ReportQuerySchema)) query: ReportQuery,
  ): Promise<ReportDto> {
    return this.reports.run(ctx, reportKey(key), query, REPORT_LIMITS.screen);
  }

  /** Excel or PDF (PRD §19). Every export is recorded in the audit log. */
  @Get(':key/export')
  @RequirePermission('report:view_all', 'report:view_operational')
  async export(
    @Ctx() ctx: RequestContext,
    @Param('key') key: string,
    @Query(zod(ReportExportQuerySchema)) query: ReportExportQuery,
    @Res() res: Response,
  ): Promise<void> {
    if (!ctx.permissions.has('report:export')) throw forbidden();
    await this.limiter.consume(
      `export:${ctx.userId}`,
      RATE_RULES.export(),
      'Too many report files in a short time. Try again in a few minutes.',
    );
    const { format, ...filters } = query;
    const report = await this.reports.run(ctx, reportKey(key), filters, REPORT_LIMITS.export);
    const file = format === 'xlsx' ? await reportToXlsx(report) : await reportToPdf(report);

    await this.prisma.db.$transaction((tx) =>
      this.audit.write(tx, ctx, {
        action: 'report.export',
        entityType: 'report',
        entityId: report.key,
        metadata: { format, filters: report.filters, rows: report.rows.length },
      }),
    );

    res
      .status(200)
      .set({
        'Content-Type': MIME[format],
        'Content-Disposition': `attachment; filename="${reportFileName(report, format)}"`,
        'Content-Length': String(file.length),
      })
      .end(file);
  }
}
