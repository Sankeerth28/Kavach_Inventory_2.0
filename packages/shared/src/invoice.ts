import { z } from 'zod';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type ExtractedHeader,
  type ExtractedLine,
  type QualityIssue,
} from './extraction';
import type {
  CatalogUnit,
  MatchCandidate,
  MatchConflict,
  MatchMethod,
  MatchStatus,
  ProposedMaterial,
} from './matching-types';
import { IdSchema, PageQuerySchema, PhoneSchema, QuantitySchema } from './schemas';

/**
 * Contracts of AI invoice processing (Phase 3): suppliers, document upload, review and
 * Confirm & Receive (PRD §7–§13). Quantities are decimal strings (CLAUDE.md invariant 5).
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export const INVOICE_STATUSES = [
  'UPLOADING',
  'QUEUED',
  'PROCESSING',
  'NEEDS_RECAPTURE',
  'READY_FOR_REVIEW',
  'POSTED',
  'REVERSED',
  'FAILED',
  'DISCARDED',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** PRD §10.2 screen 2. */
export const PROCESSING_STAGES = [
  'UPLOADED',
  'QUALITY_CHECK',
  'READING',
  'IDENTIFYING',
  'MATCHING',
  'PREPARING',
  'DONE',
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

export const LINE_STATUSES = ['PENDING', 'CONFIRMED', 'EXCLUDED'] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** PRD §10.2 screen 4, plus EXCESS (DECISIONS Q5). */
export const DISCREPANCY_REASONS = [
  'SHORT_SUPPLY',
  'DAMAGED',
  'REJECTED',
  'EXCESS',
  'OTHER',
] as const;
export type DiscrepancyReason = (typeof DISCREPANCY_REASONS)[number];

export const AI_STAGES = ['QUALITY_CHECK', 'EXTRACTION', 'MATCH_TIEBREAK'] as const;
export type AiStage = (typeof AI_STAGES)[number];

export const AI_CALL_STATUSES = [
  'SUCCESS',
  'INVALID_OUTPUT',
  'PROVIDER_ERROR',
  'TIMEOUT',
  'REFUSED',
] as const;
export type AiCallStatus = (typeof AI_CALL_STATUSES)[number];

/** PRD §7.2 */
export const UPLOAD_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number];

export const UPLOAD_LIMITS = {
  /** Per file. */
  maxFileBytes: 15 * 1024 * 1024,
  /** Files per document (images of pages, or PDFs). */
  maxFiles: 10,
  /** Pages across all files of a document. */
  maxPages: 20,
} as const;

/** What a file really is, from its first bytes. The declared content type is not trusted. */
export function sniffMimeType(head: Uint8Array): UploadMimeType | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return 'image/jpeg';
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    head.length >= 5 &&
    head[0] === 0x25 &&
    head[1] === 0x50 &&
    head[2] === 0x44 &&
    head[3] === 0x46 &&
    head[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  return null;
}

// ── Building blocks ──────────────────────────────────────────────────────────

const text = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

const optionalId = IdSchema.nullish();

/** undefined = leave as is, null or '' = clear. */
const quantityPatch = z
  .union([QuantitySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

export const GstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9]{2}[A-Z0-9]{13}$/, 'A GSTIN has 15 characters and starts with two digits');

const gstinPatch = z
  .union([GstinSchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null || v === '' ? null : v));

const optionalPhone = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  PhoneSchema.optional(),
);

/** Document numbers compare without punctuation or case: "SKC/26-27/1045" = "skc 26 27 1045". */
export function normaliseDocumentNo(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return s.length > 0 ? s : null;
}

/** Finds the unit a document means by "Bags", "bgs", "MT", "Nos" … or null. Never guesses. */
export function resolveUnit(
  raw: string | null | undefined,
  units: readonly CatalogUnit[],
): CatalogUnit | null {
  if (!raw) return null;
  const key = raw
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  if (!key) return null;
  for (const u of units) {
    const names = [u.code, u.name, u.symbol, ...u.aliases].map((n) =>
      n.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, ''),
    );
    if (names.includes(key)) return u;
  }
  return null;
}

/** "50 KG", "50kg", "237 ml" → size and unit. Returns null when the text is not a plain pack size. */
export function parsePackSize(
  raw: string | null | undefined,
  units: readonly CatalogUnit[],
): { size: string; unit: CatalogUnit } | null {
  if (!raw) return null;
  const m = /^\s*(\d{1,9}(?:\.\d{1,3})?)\s*([\p{L}.]+)\s*$/u.exec(raw.normalize('NFKC'));
  if (!m) return null;
  const unit = resolveUnit(m[2], units);
  if (!unit || Number(m[1]) <= 0) return null;
  return { size: m[1]!, unit };
}

// ── Suppliers (PRD §4 module 9, §9; DECISIONS Q7) ────────────────────────────

export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(160),
  gstin: gstinPatch,
  address: text(500),
  phone: optionalPhone,
});

export const UpdateSupplierSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  gstin: gstinPatch,
  address: text(500),
  phone: z.preprocess((v) => (v === '' ? null : v), PhoneSchema.nullable().optional()),
  isActive: z.boolean().optional(),
});

export const SupplierListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  includeInactive: z.coerce.boolean().optional(),
});

export const MappingListQuerySchema = PageQuerySchema.extend({
  supplierId: IdSchema.optional(),
  status: z.enum(['CONFIRMED', 'DISABLED']).optional(),
  q: z.string().trim().max(120).optional(),
});

export const DisableMappingSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});

// ── Documents ────────────────────────────────────────────────────────────────

export const CreateInvoiceSchema = z.object({ storeId: IdSchema });

export const SubmitInvoiceSchema = z.object({
  /** Process even though the quality check asked for a better image (DECISIONS Q27). */
  overrideQuality: z.boolean().default(false),
});

export const InvoiceListQuerySchema = PageQuerySchema.extend({
  status: z.enum(INVOICE_STATUSES).optional(),
  /** PROCESSING = uploading / queued / processing; REVIEW = waiting for the user; DONE = received. */
  group: z.enum(['PROCESSING', 'REVIEW', 'DONE', 'PROBLEM']).optional(),
  storeId: IdSchema.optional(),
  q: z.string().trim().max(120).optional(),
});

const version = z.number().int().min(0);

export const UpdateInvoiceHeaderSchema = z.object({
  version,
  /** An existing supplier, or null to use the typed name (a supplier is created on confirm, Q7). */
  supplierId: optionalId,
  supplierName: text(160),
  supplierGstin: gstinPatch,
  supplierAddress: text(500),
  invoiceNo: text(80),
  invoiceDate: z
    .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null)),
  challanNo: text(80),
  documentType: z.enum(DOCUMENT_TYPES).optional(),
  notes: text(500),
});

export const ProposedMaterialSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(160),
  categoryId: IdSchema.nullable().default(null),
  brand: z.string().trim().max(80).nullable().default(null),
  specification: z.string().trim().max(500).nullable().default(null),
  grade: z.string().trim().max(40).nullable().default(null),
  size: z.string().trim().max(60).nullable().default(null),
  stockUnitId: IdSchema.nullable().default(null),
  packSize: z.union([QuantitySchema, z.null()]).default(null),
  packUnitId: IdSchema.nullable().default(null),
  isVariableWeight: z.boolean().default(false),
  confirmNotDuplicate: z.boolean().default(false),
});

const lineEdits = {
  /** Correcting the description re-runs matching for the line. */
  description: z.string().trim().min(1).max(500).optional(),
  /** Choose an existing material (clears any new-material proposal). */
  materialId: optionalId,
  /** Create a new material on confirm (clears the chosen material). */
  proposedMaterial: ProposedMaterialSchema.nullish(),
  invoiceQty: quantityPatch,
  invoiceUnitId: optionalId,
  acceptedQty: quantityPatch,
  damagedQty: quantityPatch,
  rejectedQty: quantityPatch,
  discrepancyReason: z.enum(DISCREPANCY_REASONS).nullish(),
  notes: text(300),
  lineStatus: z.enum(LINE_STATUSES).optional(),
};

export const UpdateInvoiceItemSchema = z.object({ version, ...lineEdits });

/** A line typed by the user because the document could not be read (PRD §11.5). */
export const AddInvoiceItemSchema = z.object({
  version,
  ...lineEdits,
  description: z.string().trim().min(1, 'Describe the material').max(500),
});

export const ConfirmInvoiceSchema = z.object({ version });

export const DuplicateOverrideSchema = z.object({
  /** Why this is a genuinely different document (DECISIONS Q6). */
  note: z.string().trim().min(3, 'Say why').max(500),
});

export const AiLogListQuerySchema = PageQuerySchema.extend({
  invoiceId: IdSchema.optional(),
  status: z.enum(AI_CALL_STATUSES).optional(),
});

export const UpdateConfidenceSchema = z
  .object({
    auto: z.number().min(0.5).max(1),
    confirm: z.number().min(0.1).max(1),
  })
  .refine((v) => v.confirm <= v.auto, {
    message: 'The review threshold cannot be above the high-confidence one',
    path: ['confirm'],
  });

// ── Input types ──────────────────────────────────────────────────────────────

export type CreateSupplierInput = z.input<typeof CreateSupplierSchema>;
export type UpdateSupplierInput = z.input<typeof UpdateSupplierSchema>;
export type SupplierListInput = z.input<typeof SupplierListQuerySchema>;
export type MappingListInput = z.input<typeof MappingListQuerySchema>;
export type MappingListQuery = z.infer<typeof MappingListQuerySchema>;
export type DisableMappingInput = z.infer<typeof DisableMappingSchema>;
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type SubmitInvoiceInput = z.input<typeof SubmitInvoiceSchema>;
export type InvoiceListInput = z.input<typeof InvoiceListQuerySchema>;
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;
export type UpdateInvoiceHeaderInput = z.input<typeof UpdateInvoiceHeaderSchema>;
export type UpdateInvoiceHeader = z.output<typeof UpdateInvoiceHeaderSchema>;
export type UpdateInvoiceItemInput = z.input<typeof UpdateInvoiceItemSchema>;
export type UpdateInvoiceItem = z.output<typeof UpdateInvoiceItemSchema>;
export type AddInvoiceItemInput = z.input<typeof AddInvoiceItemSchema>;
export type AddInvoiceItem = z.output<typeof AddInvoiceItemSchema>;
export type ConfirmInvoiceInput = z.infer<typeof ConfirmInvoiceSchema>;
export type DuplicateOverrideInput = z.infer<typeof DuplicateOverrideSchema>;
export type AiLogListInput = z.input<typeof AiLogListQuerySchema>;
export type AiLogListQuery = z.infer<typeof AiLogListQuerySchema>;
export type UpdateConfidenceInput = z.infer<typeof UpdateConfidenceSchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export interface SupplierDto {
  id: string;
  name: string;
  gstin: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  aliases: string[];
  mappingCount: number;
}

export interface SupplierMappingDto {
  id: string;
  supplierId: string;
  supplierName: string;
  /** As printed on the confirming document. */
  description: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  status: 'CONFIRMED' | 'DISABLED';
  confirmedByName: string;
  confirmedAt: string;
  timesUsed: number;
  lastUsedAt: string;
  disabledReason: string | null;
}

export interface PageQualityDto {
  ok: boolean;
  issues: QualityIssue[];
  /** Plain-language advice: "Hold the phone steady and retake the photo." */
  advice: string[];
  widthPx: number | null;
  heightPx: number | null;
}

export interface QualityReportDto {
  /** false: the check asks for a better image (PRD §7.3 step 2). */
  ok: boolean;
  issues: QualityIssue[];
  advice: string[];
  handwritten: boolean;
  note: string | null;
}

export interface InvoicePageDto {
  pageNo: number;
  mimeType: UploadMimeType;
  /** Pages inside the file: 1 for an image. */
  pageCount: number;
  sizeBytes: number;
  originalName: string | null;
  /** The stored file was removed by the retention job. */
  purged: boolean;
  quality: PageQualityDto | null;
}

/** What stops a line from being received. The user must clear every one. */
export const LINE_ISSUE_CODES = [
  'NOT_CONFIRMED',
  'MATERIAL_REQUIRED',
  'MATERIAL_INACTIVE',
  'NEW_MATERIAL_INCOMPLETE',
  'UNIT_REQUIRED',
  'UNIT_INCOMPATIBLE',
  'QUANTITY_REQUIRED',
  'QUANTITY_NOT_WHOLE',
  'REASON_REQUIRED',
] as const;
export type LineIssueCode = (typeof LINE_ISSUE_CODES)[number];

export interface LineIssue {
  code: LineIssueCode;
  message: string;
}

export interface InvoiceItemDto {
  id: string;
  lineNo: number;
  pageNo: number | null;
  isManualEntry: boolean;
  /** As written on the document (or as corrected by the user). */
  description: string;
  hsnCode: string | null;
  /** The frozen AI output, with per-field confidence. null for a manual line. */
  extracted: ExtractedLine | null;

  matchStatus: MatchStatus;
  matchMethod: MatchMethod | null;
  matchScore: number | null;
  candidates: MatchCandidate[];
  specConflicts: MatchConflict[];

  material: {
    id: string;
    code: string;
    name: string;
    categoryName: string;
    stockUnitId: string;
    stockUnitCode: string;
    packSize: string | null;
    packUnitCode: string | null;
    status: 'ACTIVE' | 'INACTIVE';
  } | null;
  proposedMaterial: ProposedMaterial | null;
  /** A starting point for "create new material", built from what the document says. */
  suggestedProposal: ProposedMaterial | null;

  invoiceQty: string | null;
  invoiceUnitId: string | null;
  invoiceUnitCode: string | null;
  /** The unit as written, when it is not in the unit master ("Brass"). */
  invoiceUnitRaw: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
  acceptedQty: string | null;
  damagedQty: string;
  rejectedQty: string;
  shortQty: string;
  discrepancyReason: DiscrepancyReason | null;
  notes: string | null;
  lineStatus: LineStatus;

  /** What will enter stock, in the material's stock unit (PRD §12.3). null when it cannot be computed yet. */
  stock: { unitCode: string; acceptedQty: string; damagedQty: string } | null;
  /** Blocking problems. Empty = ready. */
  issues: LineIssue[];
  /** Things to look at twice; never blocking (DECISIONS Q35). */
  warnings: string[];
  /** Field names the AI was unsure about (PRD §8.1, §11.2 step 7). */
  uncertainFields: string[];
}

export interface DuplicateHitDto {
  /** HEADER = same supplier, number and date; FINGERPRINT = same file; CHALLAN = same supplier and challan (Q8). */
  kind: 'HEADER' | 'FINGERPRINT' | 'CHALLAN';
  invoiceId: string;
  invoiceNo: string | null;
  challanNo: string | null;
  supplierName: string | null;
  receivedAt: string | null;
  referenceNo: string | null;
}

export interface InvoiceSummaryDto {
  id: string;
  storeId: string;
  storeName: string;
  status: InvoiceStatus;
  stage: ProcessingStage;
  documentType: DocumentType;
  supplierName: string | null;
  invoiceNo: string | null;
  challanNo: string | null;
  invoiceDate: string | null;
  lineCount: number;
  pageCount: number;
  uploadedByName: string;
  createdAt: string;
  postedAt: string | null;
  receiptReferenceNo: string | null;
  postingId: string | null;
  failureMessage: string | null;
}

export interface InvoiceDetailDto extends InvoiceSummaryDto {
  version: number;
  quality: QualityReportDto | null;
  qualityOverridden: boolean;
  failureCode: string | null;

  supplierId: string | null;
  /** The name as written on the document, used to create the supplier when none is chosen. */
  supplierNameRaw: string | null;
  supplierGstin: string | null;
  supplierAddress: string | null;
  invoiceTotal: string | null;
  notes: string | null;
  extractedHeader: ExtractedHeader | null;
  /** Header fields the AI was unsure about. */
  uncertainHeaderFields: string[];
  /** Existing suppliers that look like the one on the document. */
  supplierSuggestions: { id: string; name: string; gstin: string | null; reason: string }[];

  pages: InvoicePageDto[];
  items: InvoiceItemDto[];

  /** Earlier receipts of what looks like the same document (PRD §13.3). */
  duplicates: DuplicateHitDto[];
  duplicateOverride: { byName: string; at: string; note: string } | null;

  /** Soft checks on totals (DECISIONS Q35). */
  warnings: string[];
  /** PRD §10.2 screen 5. */
  summary: {
    lines: number;
    excluded: number;
    newMaterials: number;
    needsAttention: number;
    blockers: string[];
    /** True when Confirm & Receive would be accepted as things stand. */
    ready: boolean;
  };
  thresholds: { auto: number; confirm: number };
}

export interface DuplicateInvoiceDetails {
  duplicates: DuplicateHitDto[];
}

export interface AiLogDto {
  id: string;
  invoiceId: string | null;
  invoiceNo: string | null;
  lineNo: number | null;
  stage: AiStage;
  provider: string;
  model: string;
  promptVersion: string;
  attempt: number;
  status: AiCallStatus;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  triggeredByName: string;
  createdAt: string;
}

/** PRD §5.1 E. */
export interface AiOverviewDto {
  invoicesProcessed: number;
  successfulExtractions: number;
  failedAttempts: number;
  matchedLines: number;
  newMaterialsCreated: number;
  linesNeedingReview: number;
  pendingReview: number;
  processing: number;
}
