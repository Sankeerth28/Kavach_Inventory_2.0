import { z } from 'zod';
import type { PermissionCode } from './permissions';
import { IdSchema } from './schemas';

/**
 * Reports (PRD §19). Every report is a plain table: the same shape is shown on screen, written
 * to Excel and PDF, and listed on mobile, so the three never disagree.
 */
export const REPORT_KEYS = [
  'current-stock',
  'material-in',
  'material-out',
  'material-return',
  'material-movement',
  'supplier-wise',
  'low-stock',
  'stock-discrepancy',
  'ai-processing',
  'new-materials',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export type ReportFilter = 'dates' | 'store' | 'byStore' | 'material' | 'supplier' | 'category';

export interface ReportDefinition {
  key: ReportKey;
  title: string;
  description: string;
  /**
   * Operational reports are open to Store Managers, for their stores (DECISIONS Q18, adopted as
   * recommended). The others need `report:view_all`.
   */
  operational: boolean;
  filters: readonly ReportFilter[];
}

export const REPORTS: Record<ReportKey, ReportDefinition> = {
  'current-stock': {
    key: 'current-stock',
    title: 'Current Stock Report',
    description: 'What is in the store now: available, damaged and scrap, with stock status.',
    operational: true,
    filters: ['store', 'byStore', 'category'],
  },
  'material-in': {
    key: 'material-in',
    title: 'Material In Report',
    description: 'Every receipt line in the period, with supplier and document number.',
    operational: true,
    filters: ['dates', 'store', 'material', 'supplier'],
  },
  'material-out': {
    key: 'material-out',
    title: 'Material Out Report',
    description: 'Every issue line in the period, with destination and contractor.',
    operational: true,
    filters: ['dates', 'store', 'material'],
  },
  'material-return': {
    key: 'material-return',
    title: 'Material Return Report',
    description: 'Every return line in the period, with its condition.',
    operational: true,
    filters: ['dates', 'store', 'material'],
  },
  'material-movement': {
    key: 'material-movement',
    title: 'Material Movement Report',
    description: 'Opening + In + Reusable Returns − Out + Adjustments = Closing, per material.',
    operational: true,
    filters: ['dates', 'store', 'byStore', 'material', 'category'],
  },
  'supplier-wise': {
    key: 'supplier-wise',
    title: 'Supplier-wise Report',
    description: 'What each supplier delivered in the period, per material.',
    operational: false,
    filters: ['dates', 'store', 'supplier', 'material'],
  },
  'low-stock': {
    key: 'low-stock',
    title: 'Low Stock Report',
    description: 'Materials at or below their minimum stock, or out of stock.',
    operational: true,
    filters: ['category'],
  },
  'stock-discrepancy': {
    key: 'stock-discrepancy',
    title: 'Physical Stock Discrepancy Report',
    description: 'Physical counts that differed from the system, and what was decided.',
    operational: false,
    filters: ['dates', 'store', 'material'],
  },
  'ai-processing': {
    key: 'ai-processing',
    title: 'AI Processing Report',
    description: 'Scanned documents in the period: how they were read and matched.',
    operational: false,
    filters: ['dates', 'store'],
  },
  'new-materials': {
    key: 'new-materials',
    title: 'New Material Creation Report',
    description: 'Materials added to the Material Master in the period, and how.',
    operational: false,
    filters: ['dates', 'category'],
  },
};

/** The reports a member may open (PRD §3.1 "View All", §3.2 "Operational Reports"). */
export function reportsFor(permissions: Iterable<PermissionCode>): ReportDefinition[] {
  const held = new Set(permissions);
  if (held.has('report:view_all')) return REPORT_KEYS.map((k) => REPORTS[k]);
  if (held.has('report:view_operational')) {
    return REPORT_KEYS.map((k) => REPORTS[k]).filter((r) => r.operational);
  }
  return [];
}

export function isReportKey(value: string): value is ReportKey {
  return (REPORT_KEYS as readonly string[]).includes(value);
}

/** A real calendar day: "2026-02-30" and "2026-13-01" are refused here, not by the database. */
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, 'Not a real date');
/** A yes/no filter: a boolean from code, "true"/"false" from a query string. */
const flag = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .optional()
  .transform((v) => v === true || v === 'true');

/**
 * Filters shared by all reports. Dates are calendar days in the project's time zone, both
 * inclusive. A filter a report does not use is ignored.
 */
export const ReportQuerySchema = z
  .object({
    from: day.optional(),
    to: day.optional(),
    storeId: IdSchema.optional(),
    /** One row per store instead of one row for the stores together. */
    byStore: flag,
    materialId: IdSchema.optional(),
    supplierId: IdSchema.optional(),
    categoryId: IdSchema.optional(),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'The start date is after the end date',
    path: ['to'],
  });

export const REPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export const ReportExportQuerySchema = ReportQuerySchema.and(
  z.object({ format: z.enum(REPORT_FORMATS) }),
);

export type ReportQuery = z.output<typeof ReportQuerySchema>;
export type ReportQueryInput = z.input<typeof ReportQuerySchema>;
export type ReportExportQuery = z.output<typeof ReportExportQuerySchema>;

/** How a value is shown and aligned. Quantities are decimal strings (CLAUDE.md invariant 5). */
export type ReportColumnKind = 'text' | 'quantity' | 'count' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
}

export type ReportCell = string | number | null;

export interface ReportDto {
  key: ReportKey;
  title: string;
  projectName: string;
  /** IANA time zone the dates are shown in. */
  timezone: string;
  generatedAt: string;
  generatedByName: string;
  /** The filters as applied, in words: shown above the table and in every export. */
  filters: { label: string; value: string }[];
  columns: ReportColumn[];
  rows: Record<string, ReportCell>[];
  /** True when there were more rows than the limit; `rows` holds the first ones only. */
  truncated: boolean;
  /** How to read the report: formula, what is left out. */
  notes: string[];
}

/** Rows shown on screen, and rows written to a file. */
export const REPORT_LIMITS = { screen: 1000, export: 20000 } as const;

/** Formats a report cell as text, the same way on every client and in the PDF. */
export function formatReportCell(
  value: ReportCell,
  kind: ReportColumnKind,
  timezone: string,
): string {
  if (value === null || value === '') return '';
  if (kind === 'date' || kind === 'datetime') {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      ...(kind === 'datetime' ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
    }).format(d);
  }
  return String(value);
}
