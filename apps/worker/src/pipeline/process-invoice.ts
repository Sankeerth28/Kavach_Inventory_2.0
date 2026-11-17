import {
  type Prisma,
  type PrismaClient,
  createMaterialCatalog,
  loadMatchingMasters,
} from '@kavach/db';
import { matchLine } from '@kavach/matching';
import {
  type AiCallStatus,
  type AiStage,
  Decimal,
  type ExtractedField,
  type ExtractedLine,
  type ExtractionResult,
  ExtractionResultSchema,
  type MatchContext,
  type MatchLineInput,
  type PageQualityDto,
  type TieBreaker,
  TieBreakResultSchema,
  type UploadMimeType,
  fieldNeedsReview,
  normalise,
  normaliseDocumentNo,
  parseProjectSettings,
  resolveUnit,
} from '@kavach/shared';
import type { DocumentStorage } from '@kavach/storage';
import {
  type DocumentExtractor,
  ExtractorError,
  type ExtractorResponse,
  type PageInput,
} from '../extractors/document-extractor';
import { assessImage, combineQuality, pdfQuality, prepareImage } from './quality';

/**
 * The document pipeline (PRD §7.3, §10.2 screen 2; ARCHITECTURE §7).
 *
 *   claim → quality check → read (AI extraction, validated) → identify supplier → match lines
 *   → prepare the draft receipt → READY_FOR_REVIEW
 *
 * It writes `invoices`, `invoice_pages` (quality), `invoice_items` (drafts) and
 * `ai_processing_logs`, and nothing else. It never touches stock, the ledger, the Material
 * Master or supplier mappings: those change only when a Store Manager confirms, in the API
 * (PRD §24.1: AI proposes → backend validates → Store Manager confirms → inventory engine posts).
 */
export const MAX_ATTEMPTS = 4;
/** A claim older than this is taken to be a crashed worker (ARCHITECTURE §7.2). */
export const STALE_CLAIM_MINUTES = 10;

export interface PipelineDeps {
  /** Scoped client: every model query names its project. */
  db: PrismaClient;
  storage: DocumentStorage;
  extractor: DocumentExtractor;
  log?: (message: string) => void;
}

export type PipelineOutcome =
  | 'READY_FOR_REVIEW'
  | 'NEEDS_RECAPTURE'
  | 'FAILED'
  | 'RETRY_LATER'
  /** The document was not in the state this run started from: its work is dropped. */
  | 'STALE';

interface Claim {
  id: string;
  project_id: string;
  extraction_version: number;
  attempt_count: number;
}

/** Atomically takes one waiting document. Two workers can never take the same one. */
export async function claimNext(db: PrismaClient, invoiceId?: string): Promise<Claim | null> {
  const rows = invoiceId
    ? await db.$queryRaw<Claim[]>`
        UPDATE invoices SET status = 'PROCESSING', stage = 'QUALITY_CHECK',
               attempt_count = attempt_count + 1, processing_started_at = now(), updated_at = now()
        WHERE id = (
          SELECT id FROM invoices
          WHERE id = ${invoiceId}::uuid AND status = 'QUEUED'
            AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          FOR UPDATE SKIP LOCKED)
        RETURNING id, project_id, extraction_version, attempt_count`
    : await db.$queryRaw<Claim[]>`
        UPDATE invoices SET status = 'PROCESSING', stage = 'QUALITY_CHECK',
               attempt_count = attempt_count + 1, processing_started_at = now(), updated_at = now()
        WHERE id = (
          SELECT id FROM invoices
          WHERE status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, project_id, extraction_version, attempt_count`;
  return rows[0] ?? null;
}

/**
 * Failed-processing recovery (PRD §25.3): a document whose worker died goes back to the queue,
 * and after too many attempts it is marked failed so the user can retry or enter it by hand.
 */
export async function reapStaleClaims(db: PrismaClient): Promise<number> {
  return db.$executeRaw`
    UPDATE invoices SET
      status = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN 'FAILED'::"InvoiceStatus" ELSE 'QUEUED'::"InvoiceStatus" END,
      failure_code = CASE WHEN attempt_count >= ${MAX_ATTEMPTS} THEN 'PROCESSING_STALLED' ELSE failure_code END,
      failure_message = CASE WHEN attempt_count >= ${MAX_ATTEMPTS}
        THEN 'Processing did not finish. Try again, or enter the lines by hand.' ELSE failure_message END,
      processing_started_at = NULL, updated_at = now()
    WHERE status = 'PROCESSING'
      AND processing_started_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}::int)`;
}

const value = <T>(f: ExtractedField<T> | undefined): T | null => f?.value ?? null;

/** Decimal(18,3) or null. A value with more decimals is left for the user rather than rounded. */
function quantity(v: string | null): string | null {
  if (v === null) return null;
  const d = new Decimal(v);
  return d.decimalPlaces() <= 3 ? d.toString() : null;
}

function money(v: string | null, places: number): string | null {
  if (v === null) return null;
  return new Decimal(v).toDecimalPlaces(places).toString();
}

function backoffSeconds(attempt: number): number {
  return 5 * 4 ** Math.max(0, attempt - 1); // 5 s, 20 s, 80 s
}

export function toMatchLine(line: ExtractedLine, unitId: string | null): MatchLineInput {
  return {
    description: value(line.description) ?? '',
    suggestedName: value(line.suggestedName),
    brand: value(line.brand),
    category: value(line.category),
    specification: value(line.specification),
    grade: value(line.grade),
    size: value(line.size),
    packSize: value(line.packSize),
    unitId,
  };
}

/** Fields the user must look at before the line can be trusted (PRD §8.1, ARCHITECTURE §7.3). */
const CRITICAL_LINE_FIELDS = ['description', 'quantity', 'unit'] as const;

export async function processInvoice(deps: PipelineDeps, claim: Claim): Promise<PipelineOutcome> {
  const { db, storage, extractor } = deps;
  const log = deps.log ?? (() => undefined);
  const projectId = claim.project_id;
  const invoiceId = claim.id;

  /** Every write is conditional on the claim still being ours: stale work is dropped silently. */
  const mine: Prisma.InvoiceWhereInput = {
    projectId,
    id: invoiceId,
    status: 'PROCESSING',
    extractionVersion: claim.extraction_version,
  };
  const setStage = (stage: 'READING' | 'IDENTIFYING' | 'MATCHING' | 'PREPARING') =>
    db.invoice.updateMany({ where: mine, data: { stage } });

  const invoice = await db.invoice.findFirst({
    where: { projectId, id: invoiceId },
    include: { pages: { orderBy: { pageNo: 'asc' } }, project: { select: { settings: true } } },
  });
  if (!invoice || invoice.status !== 'PROCESSING') return 'STALE';

  let attempt = 0;
  const logCall = async (
    stage: AiStage,
    status: AiCallStatus,
    startedAt: number,
    res: ExtractorResponse | null,
    extra: { lineNo?: number; errors?: unknown; errorCode?: string; errorMessage?: string } = {},
  ) => {
    attempt += 1;
    await db.aiProcessingLog.create({
      data: {
        projectId,
        invoiceId,
        lineNo: extra.lineNo ?? null,
        triggeredById: invoice.uploadedById,
        stage,
        provider: extractor.provider,
        model: res?.model ?? extractor.model,
        promptVersion: extractor.promptVersion,
        attempt,
        status,
        latencyMs: Date.now() - startedAt,
        inputTokens: res?.inputTokens ?? null,
        outputTokens: res?.outputTokens ?? null,
        response:
          res?.raw === undefined || res?.raw === null
            ? undefined
            : (res.raw as Prisma.InputJsonValue),
        validationErrors: extra.errors ? (extra.errors as Prisma.InputJsonValue) : undefined,
        errorCode: extra.errorCode ?? null,
        errorMessage: extra.errorMessage?.slice(0, 500) ?? null,
      },
    });
  };

  const fail = async (code: string, message: string): Promise<PipelineOutcome> => {
    await db.invoice.updateMany({
      where: mine,
      data: {
        status: 'FAILED',
        failureCode: code,
        failureMessage: message.slice(0, 500),
        processingStartedAt: null,
      },
    });
    log(`invoice ${invoiceId} failed: ${code}`);
    return 'FAILED';
  };

  try {
    // ── 1. Quality check (PRD §7.3 step 2) ────────────────────────────────────
    const inputs: PageInput[] = [];
    const pageQuality: PageQualityDto[] = [];
    for (const page of invoice.pages) {
      const original = await storage.get(page.storageKey);
      const mimeType = page.mimeType as UploadMimeType;
      const quality = mimeType === 'application/pdf' ? pdfQuality() : await assessImage(original);
      pageQuality.push(quality);
      await db.invoicePage.updateMany({
        where: { projectId, id: page.id },
        data: {
          quality: quality as unknown as Prisma.InputJsonValue,
          widthPx: quality.widthPx,
          heightPx: quality.heightPx,
        },
      });
      const unreadable = quality.issues.includes('UNREADABLE');
      inputs.push({
        pageNo: page.pageNo,
        mimeType: mimeType === 'application/pdf' ? mimeType : 'image/jpeg',
        pageCount: page.pageCount,
        data:
          mimeType === 'application/pdf' || unreadable ? original : await prepareImage(original),
        sha256: page.sha256,
      });
    }
    if (inputs.length === 0) return await fail('NO_PAGES', 'The document has no pages.');

    const measured = combineQuality(pageQuality);
    // A file that cannot even be decoded is never sent on, override or not (DECISIONS Q27).
    const undecodable = pageQuality.some((q) => q.issues.includes('UNREADABLE'));
    if (!measured.ok && (undecodable || !invoice.qualityOverridden)) {
      await db.invoice.updateMany({
        where: mine,
        data: {
          status: 'NEEDS_RECAPTURE',
          qualityReport: measured as unknown as Prisma.InputJsonValue,
          processingStartedAt: null,
        },
      });
      return 'NEEDS_RECAPTURE';
    }

    // ── 2. Read: AI extraction into the predefined schema (PRD §7.3 steps 3–4) ─
    await setStage('READING');
    const masters = await loadMatchingMasters(db, projectId);
    const hints = {
      units: masters.units.map((u) => u.name),
      categories: masters.categories.map((c) => c.name),
    };

    let result: ExtractionResult | null = null;
    let previous: unknown = null;
    let errors: string[] = [];
    for (let round = 0; round < 2 && !result; round += 1) {
      const startedAt = Date.now();
      const res = await extractor
        .extract(inputs, hints, round === 0 ? undefined : { previous, errors })
        .catch(async (e: unknown) => {
          if (e instanceof ExtractorError) {
            await logCall(
              'EXTRACTION',
              e.kind === 'TIMEOUT'
                ? 'TIMEOUT'
                : e.kind === 'REFUSED'
                  ? 'REFUSED'
                  : 'PROVIDER_ERROR',
              startedAt,
              null,
              { errorCode: e.code, errorMessage: e.message },
            );
          }
          throw e;
        });
      const parsed = ExtractionResultSchema.safeParse(res.raw);
      if (parsed.success) {
        await logCall('EXTRACTION', 'SUCCESS', startedAt, res);
        result = parsed.data;
      } else {
        // Invalid output is a failed extraction, never partial truth (CLAUDE.md AI rules).
        errors = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
        previous = res.raw;
        await logCall('EXTRACTION', 'INVALID_OUTPUT', startedAt, res, { errors });
      }
    }
    if (!result) {
      return await fail(
        'INVALID_OUTPUT',
        'The document could not be read into a usable form. Try again, or enter the lines by hand.',
      );
    }

    const report = combineQuality(pageQuality, {
      readable: result.quality.readable,
      issues: result.quality.issues,
      note: result.quality.note,
      handwritten: result.handwritten,
    });
    if (!result.quality.readable && !invoice.qualityOverridden) {
      await db.invoice.updateMany({
        where: mine,
        data: {
          status: 'NEEDS_RECAPTURE',
          qualityReport: report as unknown as Prisma.InputJsonValue,
          processingStartedAt: null,
        },
      });
      return 'NEEDS_RECAPTURE';
    }

    // ── 3. Identify the supplier: GSTIN first, then the name or a known alias ──
    await setStage('IDENTIFYING');
    const h = result.header;
    const gstin = value(h.gstin)?.toUpperCase().replace(/\s+/g, '') ?? null;
    const supplierName = value(h.supplierName);
    const normSupplier = normalise(supplierName);
    let supplierId: string | null = null;
    if (gstin && /^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) {
      supplierId =
        (await db.supplier.findFirst({ where: { projectId, gstin, isActive: true } }))?.id ?? null;
    }
    if (!supplierId && normSupplier) {
      supplierId =
        (
          await db.supplier.findFirst({
            where: { projectId, normalizedName: normSupplier, isActive: true },
          })
        )?.id ??
        (
          await db.supplierAlias.findFirst({
            where: { projectId, normalizedAlias: normSupplier, supplier: { isActive: true } },
          })
        )?.supplierId ??
        null;
    }

    // ── 4. Match every line against the Material Master (PRD §7.3 step 5) ─────
    await setStage('MATCHING');
    const settings = parseProjectSettings(invoice.project.settings);
    const ctx: MatchContext = {
      supplierId,
      units: masters.units,
      conversions: masters.conversions,
      categories: masters.categories,
      thresholds: settings.confidence,
    };
    const catalog = createMaterialCatalog(db, projectId);

    const items: Prisma.InvoiceItemCreateManyInput[] = [];
    let lineNo = 0;
    for (const line of result.lines) {
      lineNo += 1;
      const description = value(line.description);
      // Partial extraction (PRD §11.5): an unreadable line is kept and flagged, the rest go on.
      const unit = resolveUnit(value(line.unit), masters.units);
      const input = toMatchLine(line, unit?.id ?? null);

      const tieBreak: TieBreaker = async (l, candidates) => {
        const startedAt = Date.now();
        try {
          const res = await extractor.resolveCandidates(l, candidates);
          const parsed = TieBreakResultSchema.safeParse(res.raw);
          const offered = new Set(candidates.map((c) => c.materialId));
          if (
            !parsed.success ||
            (parsed.data.materialId !== null && !offered.has(parsed.data.materialId))
          ) {
            await logCall('MATCH_TIEBREAK', 'INVALID_OUTPUT', startedAt, res, { lineNo });
            return null;
          }
          await logCall('MATCH_TIEBREAK', 'SUCCESS', startedAt, res, { lineNo });
          return { materialId: parsed.data.materialId, confidence: parsed.data.confidence };
        } catch (e) {
          // A failed tie-break never fails the document: the line simply stays in review.
          await logCall('MATCH_TIEBREAK', 'PROVIDER_ERROR', startedAt, null, {
            lineNo,
            errorCode: e instanceof ExtractorError ? e.code : 'ERROR',
            errorMessage: e instanceof Error ? e.message : String(e),
          });
          return null;
        }
      };

      const match = description
        ? await matchLine(input, ctx, catalog, tieBreak)
        : {
            status: 'REVIEW_REQUIRED' as const,
            method: null,
            score: null,
            materialId: null,
            requiresConfirmation: true,
            candidates: [],
            conflicts: [],
            proposal: null,
            ambiguous: false,
          };

      const qty = quantity(value(line.quantity));
      const uncertain = CRITICAL_LINE_FIELDS.some((f) =>
        fieldNeedsReview(line[f], settings.confidence),
      );
      // DECISIONS Q13: a high-confidence match with nothing uncertain needs no per-line tick;
      // everything else waits for the user.
      const clean =
        match.status === 'MATCHED' &&
        !match.requiresConfirmation &&
        !uncertain &&
        qty !== null &&
        unit !== null;

      items.push({
        projectId,
        invoiceId,
        lineNo,
        pageNo: line.page,
        extracted: line as unknown as Prisma.InputJsonValue,
        originalDescription: description ?? '(unreadable line)',
        normalizedDescription: normalise(description),
        hsnCode: value(line.hsn),
        matchStatus: match.status,
        matchMethod: match.method,
        matchScore: match.score === null ? null : match.score.toFixed(4),
        candidates: match.candidates as unknown as Prisma.InputJsonValue,
        specConflicts:
          match.conflicts.length > 0
            ? (match.conflicts as unknown as Prisma.InputJsonValue)
            : undefined,
        materialId: match.status === 'MATCHED' ? match.materialId : null,
        proposedMaterial:
          match.status === 'NEW_MATERIAL' && match.proposal
            ? (match.proposal as unknown as Prisma.InputJsonValue)
            : undefined,
        invoiceQty: qty,
        invoiceUnitId: unit?.id ?? null,
        invoiceUnitRaw: value(line.unit),
        unitPrice: money(value(line.unitPrice), 4),
        lineTotal: money(value(line.lineTotal), 2),
        // The invoice is not proof of receipt: this is a starting value the user verifies (PRD §10.2 screen 4).
        acceptedQty: qty,
        lineStatus: clean ? 'CONFIRMED' : 'PENDING',
      });
    }

    // ── 5. Prepare the draft receipt ──────────────────────────────────────────
    await setStage('PREPARING');
    const invoiceNo = value(h.invoiceNo);
    const challanNo = value(h.challanNo);
    const date = value(h.invoiceDate);
    const done = await db.$transaction(async (tx) => {
      const updated = await tx.invoice.updateMany({
        where: mine,
        data: {
          status: 'READY_FOR_REVIEW',
          stage: 'DONE',
          documentType: result.documentType,
          qualityReport: report as unknown as Prisma.InputJsonValue,
          supplierId,
          supplierNameRaw: supplierName,
          supplierGstinRaw: gstin,
          supplierAddressRaw: value(h.supplierAddress),
          invoiceNo,
          normalizedInvoiceNo: normaliseDocumentNo(invoiceNo),
          invoiceDate: date ? new Date(`${date}T00:00:00.000Z`) : null,
          challanNo,
          normalizedChallanNo: normaliseDocumentNo(challanNo),
          invoiceTotal: money(value(h.invoiceTotal), 2),
          taxDetails: value(h.taxDetails) ?? undefined,
          extractedHeader: h as unknown as Prisma.InputJsonValue,
          failureCode: null,
          failureMessage: null,
          processingStartedAt: null,
          nextAttemptAt: null,
          version: { increment: 1 },
        },
      });
      if (updated.count === 0) return false;
      // A re-extraction replaces the earlier draft lines.
      await tx.invoiceItem.deleteMany({ where: { projectId, invoiceId } });
      if (items.length > 0) await tx.invoiceItem.createMany({ data: items });
      return true;
    });
    if (!done) return 'STALE';
    log(`invoice ${invoiceId} ready for review: ${items.length} line(s)`);
    return 'READY_FOR_REVIEW';
  } catch (e) {
    if (e instanceof ExtractorError && e.retryable && claim.attempt_count < MAX_ATTEMPTS) {
      // Safe retry (PRD §25.3): back to the queue, to be picked up after a pause.
      await db.invoice.updateMany({
        where: mine,
        data: {
          status: 'QUEUED',
          stage: 'UPLOADED',
          processingStartedAt: null,
          nextAttemptAt: new Date(Date.now() + backoffSeconds(claim.attempt_count) * 1000),
          failureCode: e.code,
          failureMessage: e.message.slice(0, 500),
        },
      });
      return 'RETRY_LATER';
    }
    if (e instanceof ExtractorError) {
      const message =
        e.kind === 'NOT_CONFIGURED'
          ? e.message
          : e.kind === 'REFUSED'
            ? 'The AI service declined to read this document. Enter the lines by hand.'
            : e.retryable
              ? 'The AI service is not answering. Try again in a few minutes, or enter the lines by hand.'
              : `The AI service could not read this document (${e.code}). Try again, or enter the lines by hand.`;
      return await fail(e.code, message);
    }
    log(`invoice ${invoiceId} crashed: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return await fail('INTERNAL', 'Something went wrong while reading the document. Try again.');
  }
}
