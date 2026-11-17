import { z } from 'zod';

/**
 * The structured output every document extractor must return (PRD §7.3 step 4, §22.2;
 * ARCHITECTURE §7.4). The worker validates the model's answer against this schema. An answer that
 * does not fit is a failed extraction, never partial truth (CLAUDE.md AI rules).
 *
 * Confidence is per field (PRD §8.1). A field the document does not state is
 * `{ value: null, confidence: 0 }`: nothing is invented (PRD §12.4).
 */
export const EXTRACTION_SCHEMA_VERSION = 1;

export const DOCUMENT_TYPES = ['INVOICE', 'CHALLAN', 'INVOICE_WITH_CHALLAN', 'UNKNOWN'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** PRD §7.3 step 2. HANDWRITTEN is never a reason to reject. */
export const QUALITY_ISSUES = [
  'BLURRY',
  'LOW_RESOLUTION',
  'POOR_LIGHTING',
  'WRONG_ORIENTATION',
  'CROPPED',
  'MISSING_PAGES',
  'SHADOWS',
  'UNREADABLE',
] as const;
export type QualityIssue = (typeof QUALITY_ISSUES)[number];

const confidence = z.number().min(0).max(1);

/** "2,500.00" → "2500.00". Models sometimes add thousands separators despite the prompt. */
const cleanNumber = (v: unknown) => (typeof v === 'string' ? v.replace(/[,\s]/g, '') : v);

/** Decimal strings, never JS numbers (CLAUDE.md invariant 5). */
const DecimalString = z.preprocess(
  cleanNumber,
  z.string().regex(/^\d{1,15}(\.\d{1,4})?$/, 'Expected a plain decimal number'),
);

const Text = z.string().trim().min(1).max(500);

export const field = <T extends z.ZodType>(value: T) =>
  z.object({
    /** null when the document does not state it. */
    value: value.nullable(),
    confidence,
    /** false when the text is there but cannot be read reliably (PRD §11). */
    legible: z.boolean(),
  });

export interface ExtractedField<T> {
  value: T | null;
  confidence: number;
  legible: boolean;
}

export const ExtractedHeaderSchema = z.object({
  supplierName: field(Text),
  supplierAddress: field(Text),
  gstin: field(Text),
  invoiceNo: field(Text),
  invoiceDate: field(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')),
  challanNo: field(Text),
  invoiceTotal: field(DecimalString),
  /** Free-form tax lines, kept for reference only: accounting is out of scope (PRD §27). */
  taxDetails: field(Text),
});

export const ExtractedLineSchema = z.object({
  lineNo: z.number().int().min(1),
  /** Page of the document the line was read from. */
  page: z.number().int().min(1).nullable(),
  /** The description exactly as written on the document. */
  description: field(Text),
  suggestedName: field(Text),
  brand: field(Text),
  category: field(Text),
  specification: field(Text),
  grade: field(Text),
  size: field(Text),
  /** As printed, for example "50 KG". Never assumed. */
  packSize: field(Text),
  quantity: field(DecimalString),
  unit: field(Text),
  unitPrice: field(DecimalString),
  lineTotal: field(DecimalString),
  hsn: field(Text),
});

export const ExtractionResultSchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  handwritten: z.boolean(),
  quality: z.object({
    /** false: nothing useful can be read; ask for a better image. */
    readable: z.boolean(),
    issues: z.array(z.enum(QUALITY_ISSUES)).max(8),
    note: z.string().max(500).nullable(),
  }),
  header: ExtractedHeaderSchema,
  lines: z.array(ExtractedLineSchema).max(200),
});

export type ExtractedHeader = z.infer<typeof ExtractedHeaderSchema>;
export type ExtractedLine = z.infer<typeof ExtractedLineSchema>;
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

/** The model's answer to "which of these candidates is this line?" (ARCHITECTURE §7.3 step 6). */
export const TieBreakResultSchema = z.object({
  /** One of the candidate ids that were offered, or null for "none of them". */
  materialId: z.string().nullable(),
  confidence,
  reason: z.string().max(300).nullable(),
});
export type TieBreakResult = z.infer<typeof TieBreakResultSchema>;

/** PRD §8.2. Thresholds are per project and configurable. */
export interface ConfidenceThresholds {
  /** At or above: high confidence. */
  auto: number;
  /** At or above: needs the user's confirmation. Below: manual review. */
  confirm: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = { auto: 0.95, confirm: 0.7 };

export const ProjectSettingsSchema = z.object({
  confidence: z
    .object({
      auto: z.number().min(0.5).max(1).default(DEFAULT_THRESHOLDS.auto),
      confirm: z.number().min(0.1).max(1).default(DEFAULT_THRESHOLDS.confirm),
    })
    .refine(
      (v) => v.confirm <= v.auto,
      'The review threshold cannot be above the high-confidence one',
    )
    .default(DEFAULT_THRESHOLDS),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

/** Reads `projects.settings`, falling back to the defaults when it is empty or malformed. */
export function parseProjectSettings(raw: unknown): ProjectSettings {
  const parsed = ProjectSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : { confidence: { ...DEFAULT_THRESHOLDS } };
}

export type ConfidenceBand = 'HIGH' | 'MEDIUM' | 'LOW';

export function confidenceBand(
  score: number,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceBand {
  if (score >= thresholds.auto) return 'HIGH';
  if (score >= thresholds.confirm) return 'MEDIUM';
  return 'LOW';
}

/** A field needs the user's eyes when it is unreadable or below the review threshold. */
export function fieldNeedsReview(
  f: ExtractedField<unknown> | null | undefined,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (!f) return false;
  if (!f.legible) return true;
  return f.value !== null && f.confidence < thresholds.confirm;
}
