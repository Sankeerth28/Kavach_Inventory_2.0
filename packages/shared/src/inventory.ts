import { z } from 'zod';
import {
  IdSchema,
  MaterialInputSchema,
  PageQuerySchema,
  PhoneSchema,
  QuantitySchema,
} from './schemas';

/**
 * Contracts of the inventory engine (Phase 2): receipts, issues, returns, verification,
 * adjustments, reversals, stock and transaction views.
 * Quantities are decimal strings everywhere (CLAUDE.md invariant 5).
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export const POSTING_TYPES = [
  'RECEIPT_INVOICE',
  'RECEIPT_MANUAL',
  'RECEIPT_QUICK',
  'ISSUE',
  'RETURN',
  'ADJUSTMENT',
  'REVERSAL',
] as const;
export type PostingType = (typeof POSTING_TYPES)[number];

/** PRD §18.1 */
export const TXN_TYPES = [
  'MATERIAL_IN',
  'MATERIAL_OUT',
  'MATERIAL_RETURN',
  'STOCK_ADJUSTMENT',
  'REVERSAL',
] as const;
export type TxnType = (typeof TXN_TYPES)[number];

/** AVAILABLE is the only bucket that counts as available stock (PRD §15.3, §19.1). */
export const STOCK_BUCKETS = ['AVAILABLE', 'DAMAGED', 'SCRAP'] as const;
export type StockBucket = (typeof STOCK_BUCKETS)[number];

/** PRD §15.3 */
export const RETURN_CONDITIONS = ['GOOD', 'DAMAGED', 'SCRAP'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export const CONDITION_BUCKET: Record<ReturnCondition, StockBucket> = {
  GOOD: 'AVAILABLE',
  DAMAGED: 'DAMAGED',
  SCRAP: 'SCRAP',
};

export const ADJUSTMENT_KINDS = [
  'COUNT_CORRECTION',
  'MANUAL_CORRECTION',
  'DISPOSITION_WRITE_OFF',
  'DISPOSITION_RESTORE',
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const VERIFICATION_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** PRD §16.2 */
export const STOCK_STATUSES = ['AVAILABLE', 'LOW', 'OUT', 'INACTIVE'] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

// ── Building blocks ──────────────────────────────────────────────────────────

const text = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((v) => (v ? v : null));

const PositiveQuantity = QuantitySchema.refine((v) => Number(v) > 0, 'Must be greater than zero');

const optionalQuantity = z
  .union([QuantitySchema, z.literal(''), z.null()])
  .optional()
  .transform((v) => (v && Number(v) > 0 ? v : null));

const optionalId = IdSchema.nullish().transform((v) => v ?? null);

/** Sent as the `Idempotency-Key` header on every posting request (CLAUDE.md invariant 4). */
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,80}$/, 'Idempotency-Key must be 16–80 letters, digits, - or _');

// ── Contractors (DECISIONS Q31) ──────────────────────────────────────────────

const optionalPhone = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  PhoneSchema.optional(),
);

export const CreateContractorSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(120),
  phone: optionalPhone,
  /** Must be true to add a contractor whose name is close to an existing one. */
  confirmNotDuplicate: z.boolean().default(false),
});

export const UpdateContractorSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.preprocess((v) => (v === '' ? null : v), PhoneSchema.nullable().optional()),
  isActive: z.boolean().optional(),
});

export const MergeContractorSchema = z.object({
  /** The contractor that survives. */
  intoId: IdSchema,
});

// ── Postings ─────────────────────────────────────────────────────────────────

const header = {
  storeId: IdSchema,
  notes: text(500),
};

/** Manual multi-line receipt (DECISIONS Q4). The path the invoice flow feeds in Phase 3. */
export const ReceiptSchema = z.object({
  ...header,
  supplierName: text(160),
  /** Invoice or challan number as written. */
  externalRef: text(80),
  lines: z
    .array(
      z
        .object({
          materialId: IdSchema,
          /** Good quantity, into available stock. In `unitId`, or the stock unit. */
          acceptedQuantity: optionalQuantity,
          /** Damaged on delivery: kept on site in the damaged bucket (DECISIONS Q5). */
          damagedQuantity: optionalQuantity,
          unitId: optionalId,
          notes: text(300),
        })
        .refine((l) => l.acceptedQuantity !== null || l.damagedQuantity !== null, {
          message: 'Enter a quantity',
          path: ['acceptedQuantity'],
        }),
    )
    .min(1, 'Add at least one material')
    .max(100),
});

/** PRD §10.3. Either an existing material or a new one (DECISIONS Q33). */
export const QuickReceiveSchema = z
  .object({
    ...header,
    materialId: optionalId,
    newMaterial: MaterialInputSchema.extend({ confirmNotDuplicate: z.boolean().default(false) })
      .nullish()
      .transform((v) => v ?? null),
    quantity: PositiveQuantity,
    unitId: optionalId,
    supplierName: text(160),
    externalRef: text(80),
  })
  .refine((v) => (v.materialId === null) !== (v.newMaterial === null), {
    message: 'Choose a material or enter a new one',
    path: ['materialId'],
  });

/** PRD §14 */
export const IssueSchema = z.object({
  ...header,
  /** Destination (PRD §26 rule 6). */
  locationId: IdSchema,
  contractorId: optionalId,
  lines: z
    .array(z.object({ materialId: IdSchema, quantity: PositiveQuantity, unitId: optionalId }))
    .min(1, 'Add at least one material')
    .max(100),
});

/** PRD §15 */
export const ReturnSchema = z.object({
  ...header,
  /** Returned from (PRD §26 rule 7). */
  locationId: IdSchema,
  contractorId: optionalId,
  lines: z
    .array(
      z.object({
        materialId: IdSchema,
        quantity: PositiveQuantity,
        unitId: optionalId,
        condition: z.enum(RETURN_CONDITIONS),
      }),
    )
    .min(1, 'Add at least one material')
    .max(100),
});

const SignedQuantity = z
  .string()
  .trim()
  .regex(/^-?\d{1,15}(\.\d{1,3})?$/, 'Enter a number with up to 3 decimals')
  .refine((v) => Number(v) !== 0, 'Must not be zero');

/** Direct adjustment by the Project Admin (PRD §3.1, §26 rule 11; DECISIONS Q23). */
export const AdjustmentSchema = z
  .object({
    storeId: IdSchema,
    materialId: IdSchema,
    kind: z.enum(['MANUAL_CORRECTION', 'DISPOSITION_WRITE_OFF', 'DISPOSITION_RESTORE']),
    bucket: z.enum(STOCK_BUCKETS),
    /** Manual correction: signed change. Write-off and restore: a positive quantity. */
    quantity: SignedQuantity,
    reason: z.string().trim().min(3, 'Give a reason').max(500),
  })
  .refine((v) => v.kind === 'MANUAL_CORRECTION' || v.bucket !== 'AVAILABLE', {
    message: 'Choose damaged or scrap stock',
    path: ['bucket'],
  })
  .refine((v) => v.kind === 'MANUAL_CORRECTION' || Number(v.quantity) > 0, {
    message: 'Enter a positive quantity',
    path: ['quantity'],
  });

export const ReverseSchema = z.object({
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

// ── Stock verification (PRD §17) ─────────────────────────────────────────────

export const SubmitVerificationSchema = z.object({
  storeId: IdSchema,
  materialId: IdSchema,
  physicalQuantity: QuantitySchema,
  reason: z.string().trim().min(3, 'Give a reason').max(500),
});

export const ReviewVerificationSchema = z.object({ note: text(500) });
export const RejectVerificationSchema = z.object({
  note: z.string().trim().min(3, 'Say why').max(500),
});

// ── Queries ──────────────────────────────────────────────────────────────────

export const StockListQuerySchema = PageQuerySchema.extend({
  /** Omit for the total across the stores you may see. */
  storeId: IdSchema.optional(),
  q: z.string().trim().max(120).optional(),
  categoryId: IdSchema.optional(),
  status: z.enum(STOCK_STATUSES).optional(),
});

export const TransactionListQuerySchema = PageQuerySchema.extend({
  storeId: IdSchema.optional(),
  materialId: IdSchema.optional(),
  type: z.enum(TXN_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Transaction ID, reference number or material name. */
  q: z.string().trim().max(120).optional(),
});

export const VerificationListQuerySchema = PageQuerySchema.extend({
  status: z.enum(VERIFICATION_STATUSES).optional(),
  storeId: IdSchema.optional(),
});

export const DashboardQuerySchema = z.object({
  /** Days of movement to show (PRD §5.1 D). */
  days: z.coerce.number().int().min(1).max(90).default(7),
});

// ── Input types ──────────────────────────────────────────────────────────────

export type CreateContractorInput = z.input<typeof CreateContractorSchema>;
export type UpdateContractorInput = z.input<typeof UpdateContractorSchema>;
export type MergeContractorInput = z.infer<typeof MergeContractorSchema>;
export type ReceiptInput = z.input<typeof ReceiptSchema>;
export type QuickReceiveInput = z.input<typeof QuickReceiveSchema>;
export type IssueInput = z.input<typeof IssueSchema>;
export type ReturnInput = z.input<typeof ReturnSchema>;
export type AdjustmentInput = z.input<typeof AdjustmentSchema>;
export type ReverseInput = z.infer<typeof ReverseSchema>;
export type SubmitVerificationInput = z.input<typeof SubmitVerificationSchema>;
export type ReviewVerificationInput = z.infer<typeof ReviewVerificationSchema>;
export type RejectVerificationInput = z.infer<typeof RejectVerificationSchema>;
export type StockListQuery = z.infer<typeof StockListQuerySchema>;
export type StockListInput = z.input<typeof StockListQuerySchema>;
export type TransactionListQuery = z.infer<typeof TransactionListQuerySchema>;
export type TransactionListInput = z.input<typeof TransactionListQuerySchema>;
export type VerificationListQuery = z.infer<typeof VerificationListQuerySchema>;
export type VerificationListInput = z.input<typeof VerificationListQuerySchema>;
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;
export type DashboardInput = z.input<typeof DashboardQuerySchema>;

// ── Responses ────────────────────────────────────────────────────────────────

export interface ContractorDto {
  id: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  /** Set when this contractor was merged into another one. */
  mergedIntoId: string | null;
}

export interface SimilarContractorsDetails {
  similar: Pick<ContractorDto, 'id' | 'name' | 'phone' | 'isActive'>[];
}

/** One ledger row (PRD §18.2). */
export interface TransactionDto {
  id: string;
  /** Transaction ID, e.g. TXN-2026-000123 */
  txnNo: string;
  postingId: string;
  postingReferenceNo: string;
  postingType: PostingType;
  type: TxnType;
  bucket: StockBucket;
  /** Signed change in the stock unit. */
  quantity: string;
  unitCode: string;
  /** Balance of this bucket in this store after the row. */
  balanceAfter: string;
  /** What the user typed, when it was not the stock unit (PRD §12.3). */
  enteredQuantity: string | null;
  enteredUnitCode: string | null;
  materialId: string;
  materialCode: string;
  materialName: string;
  storeId: string;
  storeName: string;
  locationPath: string | null;
  contractorName: string | null;
  supplierName: string | null;
  returnCondition: ReturnCondition | null;
  /** PRD §18.2 "Status" (DECISIONS Q24). */
  status: 'POSTED' | 'REVERSED';
  /** For a reversal row: the transaction it reverses. */
  reversesTxnNo: string | null;
  notes: string | null;
  createdByName: string;
  createdAt: string;
}

/** Warnings never block a posting; they tell the user to look twice. */
export type PostingWarning =
  /** Quick Receive: this reference number was used before (DECISIONS Q33). */
  | { code: 'REFERENCE_REUSED'; message: string }
  /** Return: more came back than was issued to that location (DECISIONS Q32). */
  | { code: 'RETURN_EXCEEDS_ISSUED'; message: string };

/** The result of every posting endpoint, and of a retry with the same Idempotency-Key. */
export interface PostingDto {
  id: string;
  /** RCV-2026-000045, ISS-…, RET-…, ADJ-…, REV-… */
  referenceNo: string;
  type: PostingType;
  storeId: string;
  storeName: string;
  supplierName: string | null;
  externalRef: string | null;
  notes: string | null;
  postedByName: string;
  postedAt: string;
  status: 'POSTED' | 'REVERSED';
  /** The reversal of this posting, if any. */
  reversedBy: { id: string; referenceNo: string } | null;
  /** For a reversal: the posting it reverses. */
  reverses: { id: string; referenceNo: string } | null;
  lines: TransactionDto[];
  warnings: PostingWarning[];
  /** Quick Receive that created a material. */
  createdMaterialId: string | null;
  /** Receipt from a scanned invoice or challan (Phase 3). */
  invoiceId: string | null;
  supplierId: string | null;
}

export interface InsufficientStockDetails {
  materialId: string;
  materialName: string;
  bucket: StockBucket;
  available: string;
  requested: string;
  unitCode: string;
}

export interface StockRowDto {
  materialId: string;
  materialCode: string;
  materialName: string;
  categoryName: string;
  brand: string | null;
  grade: string | null;
  size: string | null;
  unitCode: string;
  unitDecimalPlaces: number;
  /** In the selected store, or summed over the stores you may see. */
  availableQty: string;
  damagedQty: string;
  scrapQty: string;
  /** Sum over every store of the project: what low stock is judged on (DECISIONS Q21). */
  projectAvailableQty: string;
  minimumStock: string | null;
  status: StockStatus;
}

export interface StockDetailDto extends StockRowDto {
  stores: {
    storeId: string;
    storeName: string;
    availableQty: string;
    damagedQty: string;
    scrapQty: string;
  }[];
  /** PRD §16.4, available stock only, reversals netted into the type they reverse. */
  totals: MovementTotals;
  recent: TransactionDto[];
  /** True once any transaction exists: identity fields are locked (DECISIONS Q22). */
  hasTransactions: boolean;
}

/** PRD §19.1: opening + received + reusableReturns − issued + adjustments = closing. */
export interface MovementTotals {
  received: string;
  issued: string;
  reusableReturns: string;
  adjustments: string;
}

export interface VerificationDto {
  id: string;
  storeId: string;
  storeName: string;
  materialId: string;
  materialCode: string;
  materialName: string;
  unitCode: string;
  systemQty: string;
  physicalQty: string;
  /** physical − system, as captured when the count was submitted (DECISIONS Q17). */
  differenceQty: string;
  reason: string;
  status: VerificationStatus;
  submittedByName: string;
  submittedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  /** Available stock now. */
  currentQty: string;
  /** True when stock moved after the count: the reviewer should look again. */
  movedSinceCount: boolean;
  adjustmentReferenceNo: string | null;
}

export interface ReconciliationDto {
  checkedBalances: number;
  /** Balances that do not equal the sum of their ledger rows. Must be empty. */
  mismatches: {
    storeId: string;
    materialId: string;
    bucket: StockBucket;
    balance: string;
    ledgerSum: string;
  }[];
}

export interface LowStockDto {
  materialId: string;
  materialCode: string;
  materialName: string;
  unitCode: string;
  projectAvailableQty: string;
  minimumStock: string;
  status: 'LOW' | 'OUT';
}

/** PRD §5.1 and §5.2. Counts, never sums of mixed units (DECISIONS Q20). */
export interface DashboardDto {
  view: 'FULL' | 'OPERATIONAL';
  materialTypes: number;
  materialsInStock: number;
  lowStockCount: number;
  outOfStockCount: number;
  todayIn: number;
  todayOut: number;
  lowStock: LowStockDto[];
  recentTransactions: TransactionDto[];
  /** Number of ledger entries per day and type over the selected period. */
  movement: { date: string; in: number; out: number; returns: number; adjustments: number }[];
  /** Operational view: materials issued most often in the last 30 days. */
  frequentMaterials: {
    materialId: string;
    materialCode: string;
    materialName: string;
    issues: number;
  }[];
  pendingVerifications: number;
}
