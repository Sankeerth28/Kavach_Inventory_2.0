import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type MatchingMasters,
  Prisma,
  createMaterialCatalog,
  loadMatchingMasters,
  toCatalogMaterial,
} from '@kavach/db';
import { buildProposal, conflictsWith, matchLine } from '@kavach/matching';
import {
  type AddInvoiceItem,
  type ConfidenceThresholds,
  Decimal,
  type ExtractedField,
  type ExtractedHeader,
  type ExtractedLine,
  type InvoiceDetailDto,
  type InvoiceItemDto,
  type InvoiceListQuery,
  type InvoicePageDto,
  type InvoiceSummaryDto,
  type MatchCandidate,
  type MatchConflict,
  type MatchContext,
  type MatchLineInput,
  type MatchResult,
  type PageQualityDto,
  type Paginated,
  type PostingDto,
  type QualityReportDto,
  UPLOAD_LIMITS,
  type UpdateInvoiceHeader,
  type UpdateInvoiceItem,
  type UploadMimeType,
  fieldNeedsReview,
  nameSimilarity,
  normalise,
  normaliseDocumentNo,
  parseProjectSettings,
  sniffMimeType,
} from '@kavach/shared';
import { StorageObjectNotFound, invoicePageKey } from '@kavach/storage';
import { AuditService } from '../../common/audit/audit.service';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import {
  DOCUMENT_STORAGE,
  DocumentQueue,
  type DocumentStorage,
} from '../../common/documents/documents';
import { DomainError, invalid, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { RATE_RULES, RateLimiter } from '../../common/rate-limit/rate-limiter';
import {
  ITEM_INCLUDE,
  type ItemRow,
  type LineMasters,
  assessLine,
  findDuplicateInvoices,
  loadLineMasters,
  proposalOf,
} from '../inventory/invoice-lines';
import { InvoiceReceiptService } from '../inventory/invoice-receipt.service';

const DETAIL_INCLUDE = {
  store: { select: { name: true } },
  uploadedBy: { select: { name: true } },
  supplier: { select: { name: true, gstin: true } },
  duplicateOverrideBy: { select: { name: true } },
  posting: { select: { id: true, referenceNo: true } },
  pages: { orderBy: { pageNo: 'asc' } },
  items: { include: ITEM_INCLUDE, orderBy: { lineNo: 'asc' } },
  project: { select: { settings: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof DETAIL_INCLUDE }>;

const SUMMARY_INCLUDE = {
  store: { select: { name: true } },
  uploadedBy: { select: { name: true } },
  supplier: { select: { name: true } },
  posting: { select: { id: true, referenceNo: true } },
  pages: { select: { pageCount: true } },
  _count: { select: { items: true } },
} satisfies Prisma.InvoiceInclude;

type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

const GROUPS = {
  PROCESSING: ['UPLOADING', 'QUEUED', 'PROCESSING'],
  REVIEW: ['READY_FOR_REVIEW'],
  PROBLEM: ['NEEDS_RECAPTURE', 'FAILED'],
  DONE: ['POSTED', 'REVERSED'],
} as const;

const HEADER_FIELDS = [
  'supplierName',
  'gstin',
  'invoiceNo',
  'invoiceDate',
  'challanNo',
  'invoiceTotal',
] as const satisfies readonly (keyof ExtractedHeader)[];

const LINE_FIELDS = [
  'description',
  'quantity',
  'unit',
  'grade',
  'size',
  'packSize',
  'brand',
  'specification',
] as const satisfies readonly (keyof ExtractedLine)[];

const val = <T>(f: ExtractedField<T> | undefined): T | null => f?.value ?? null;
const dec = (v: Prisma.Decimal | null): string | null => (v === null ? null : v.toString());

/** Counts the pages of a PDF from its page objects. A rough count is enough for the page limit. */
function pdfPageCount(data: Buffer): number {
  const matches = data.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g);
  return Math.max(1, matches?.length ?? 1);
}

/**
 * Documents and their draft receipts (PRD §7, §10.2, §11, §13).
 *
 * Everything here works on drafts: `invoices`, `invoice_pages`, `invoice_items`. Stock changes in
 * exactly one place, `InvoiceReceiptService.confirm`, when the Store Manager presses
 * CONFIRM & RECEIVE. The AI pipeline runs in the worker; the API never calls a model.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly receipts: InvoiceReceiptService,
    private readonly queue: DocumentQueue,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly limiter: RateLimiter,
  ) {}

  // ── Upload (PRD §7.3 step 1) ───────────────────────────────────────────────

  async create(ctx: RequestContext, storeId: string): Promise<InvoiceDetailDto> {
    assertStoreAccess(ctx, storeId);
    const store = await this.prisma.db.store.findFirst({
      where: { projectId: ctx.projectId, id: storeId },
    });
    if (!store) throw notFound('Store');
    if (!store.isActive) throw new DomainError('CONFLICT', 'This store is inactive.', 409);
    const invoice = await this.prisma.db.invoice.create({
      data: { projectId: ctx.projectId, storeId, uploadedById: ctx.userId },
    });
    return this.get(ctx, invoice.id);
  }

  /** Stores one file of the document: an image of a page, or a PDF (PRD §7.2). */
  async addPage(
    ctx: RequestContext,
    id: string,
    body: unknown,
    originalName: string | null,
  ): Promise<InvoiceDetailDto> {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new DomainError('UNSUPPORTED_FILE', 'Send the file as JPG, PNG or PDF.', 415);
    }
    if (body.length > UPLOAD_LIMITS.maxFileBytes) {
      throw new DomainError('FILE_TOO_LARGE', 'The file is larger than 15 MB.', 413);
    }
    // Every stored file costs storage and an AI call later: one user cannot flood either.
    await this.limiter.consume(
      `upload:${ctx.userId}`,
      RATE_RULES.upload(),
      'Too many files in a short time. Wait a few minutes and try again.',
    );
    // The declared content type is not trusted: the type is read from the file itself (PRD §25.2).
    const mimeType = sniffMimeType(body.subarray(0, 16));
    if (!mimeType) {
      throw new DomainError('UNSUPPORTED_FILE', 'Only JPG, PNG and PDF files can be read.', 415);
    }
    const pageCount = mimeType === 'application/pdf' ? pdfPageCount(body) : 1;
    const sha256 = createHash('sha256').update(body).digest('hex');

    const invoice = await this.editable(this.prisma.db, ctx, id, ['UPLOADING']);
    const pages = await this.prisma.db.invoicePage.findMany({
      where: { projectId: ctx.projectId, invoiceId: id },
      select: { pageNo: true, pageCount: true },
    });
    if (pages.length >= UPLOAD_LIMITS.maxFiles) {
      throw new DomainError(
        'TOO_MANY_PAGES',
        `A document can have at most ${UPLOAD_LIMITS.maxFiles} files.`,
        409,
      );
    }
    const total = pages.reduce((n, p) => n + p.pageCount, 0) + pageCount;
    if (total > UPLOAD_LIMITS.maxPages) {
      throw new DomainError(
        'TOO_MANY_PAGES',
        `A document can have at most ${UPLOAD_LIMITS.maxPages} pages.`,
        409,
      );
    }
    const pageNo = Math.max(0, ...pages.map((p) => p.pageNo)) + 1;
    const storageKey = invoicePageKey(ctx.projectId, invoice.id, pageNo, mimeType);
    await this.storage.put(storageKey, body, mimeType);
    await this.prisma.db.invoicePage.create({
      data: {
        projectId: ctx.projectId,
        invoiceId: id,
        pageNo,
        storageKey,
        mimeType,
        originalName: originalName?.slice(0, 200) ?? null,
        sizeBytes: body.length,
        sha256,
        pageCount,
      },
    });
    return this.get(ctx, id);
  }

  /** Hands the uploaded document to the worker. Processing is asynchronous (PRD §25.1). */
  async submit(
    ctx: RequestContext,
    id: string,
    overrideQuality: boolean,
  ): Promise<InvoiceDetailDto> {
    const invoice = await this.editable(this.prisma.db, ctx, id, ['UPLOADING']);
    const pages = await this.prisma.db.invoicePage.findMany({
      where: { projectId: ctx.projectId, invoiceId: id },
      orderBy: { pageNo: 'asc' },
      select: { sha256: true },
    });
    if (pages.length === 0) throw invalid('Add at least one page before sending the document.');
    const documentFingerprint = createHash('sha256')
      .update(pages.map((p) => p.sha256).join(':'))
      .digest('hex');
    await this.prisma.db.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id, status: 'UPLOADING' },
        data: {
          status: 'QUEUED',
          stage: 'UPLOADED',
          documentFingerprint,
          qualityOverridden: overrideQuality,
        },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice.upload',
        entityType: 'invoice',
        entityId: id,
        after: { storeId: invoice.storeId, files: pages.length, documentFingerprint },
      });
    });
    await this.queue.notify(id, invoice.extractionVersion);
    return this.get(ctx, id);
  }

  /** Reads the document again: after a better choice on quality, or after a failure. */
  async reprocess(
    ctx: RequestContext,
    id: string,
    overrideQuality: boolean,
  ): Promise<InvoiceDetailDto> {
    const invoice = await this.editable(this.prisma.db, ctx, id, [
      'NEEDS_RECAPTURE',
      'FAILED',
      'READY_FOR_REVIEW',
    ]);
    const purged = await this.prisma.db.invoicePage.count({
      where: { projectId: ctx.projectId, invoiceId: id, purgedAt: { not: null } },
    });
    if (purged > 0) {
      throw new DomainError(
        'DOCUMENT_UNAVAILABLE',
        'The stored file was removed. Upload the document again.',
        410,
      );
    }
    const version = invoice.extractionVersion + 1;
    await this.prisma.db.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: {
          status: 'QUEUED',
          stage: 'UPLOADED',
          extractionVersion: version,
          attemptCount: 0,
          nextAttemptAt: null,
          failureCode: null,
          failureMessage: null,
          qualityOverridden: overrideQuality || invoice.qualityOverridden,
          version: { increment: 1 },
        },
      });
      await this.audit.write(tx, ctx, {
        action: overrideQuality ? 'invoice.quality_override' : 'invoice.reprocess',
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status },
        // The override of the quality warning is recorded (DECISIONS Q27).
        after: {
          status: 'QUEUED',
          qualityOverridden: overrideQuality || invoice.qualityOverridden,
        },
      });
    });
    await this.queue.notify(id, version);
    return this.get(ctx, id);
  }

  /** The document could not be read: keep it, and let the user type the lines (PRD §11.5). */
  async manualEntry(ctx: RequestContext, id: string): Promise<InvoiceDetailDto> {
    const invoice = await this.editable(this.prisma.db, ctx, id, ['FAILED', 'NEEDS_RECAPTURE']);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { status: 'READY_FOR_REVIEW', stage: 'DONE', version: { increment: 1 } },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice.manual_entry',
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status, failureCode: invoice.failureCode },
        after: { status: 'READY_FOR_REVIEW' },
      });
    });
    return this.get(ctx, id);
  }

  async discard(ctx: RequestContext, id: string): Promise<InvoiceDetailDto> {
    const invoice = await this.editable(this.prisma.db, ctx, id, [
      'UPLOADING',
      'QUEUED',
      'PROCESSING',
      'NEEDS_RECAPTURE',
      'READY_FOR_REVIEW',
      'FAILED',
    ]);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { status: 'DISCARDED', version: { increment: 1 } },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice.discard',
        entityType: 'invoice',
        entityId: id,
        before: { status: invoice.status },
        after: { status: 'DISCARDED' },
      });
    });
    return this.get(ctx, id);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async list(ctx: RequestContext, query: InvoiceListQuery): Promise<Paginated<InvoiceSummaryDto>> {
    if (query.storeId) assertStoreAccess(ctx, query.storeId);
    const where: Prisma.InvoiceWhereInput = { projectId: ctx.projectId };
    // Stock documents are store-level data: a Store Manager sees their own stores (invariant 6).
    if (query.storeId) where.storeId = query.storeId;
    else if (ctx.storeIds !== 'ALL') where.storeId = { in: [...ctx.storeIds] };
    if (query.status) where.status = query.status;
    else if (query.group) where.status = { in: [...GROUPS[query.group]] };
    else where.status = { not: 'DISCARDED' };
    if (query.q) {
      const no = normaliseDocumentNo(query.q);
      where.OR = [
        { supplierNameRaw: { contains: query.q, mode: 'insensitive' } },
        { supplier: { normalizedName: { contains: normalise(query.q) } } },
        ...(no
          ? [{ normalizedInvoiceNo: { contains: no } }, { normalizedChallanNo: { contains: no } }]
          : []),
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.db.invoice.count({ where }),
      this.prisma.db.invoice.findMany({
        where,
        include: SUMMARY_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => this.toSummary(r, r._count.items)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async get(ctx: RequestContext, id: string, db: Db = this.prisma.db): Promise<InvoiceDetailDto> {
    const invoice = await db.invoice.findFirst({
      where: { projectId: ctx.projectId, id },
      include: DETAIL_INCLUDE,
    });
    if (!invoice) throw notFound('Document');
    assertStoreAccess(ctx, invoice.storeId);
    return this.toDetail(db, ctx, invoice);
  }

  /** The stored file, served only through this permission-checked route (PRD §25.2). */
  async pageContent(
    ctx: RequestContext,
    id: string,
    pageNo: number,
  ): Promise<{ data: Buffer; mimeType: string; name: string }> {
    const page = await this.prisma.db.invoicePage.findFirst({
      where: { projectId: ctx.projectId, invoiceId: id, pageNo },
      include: { invoice: { select: { storeId: true } } },
    });
    if (!page) throw notFound('Page');
    assertStoreAccess(ctx, page.invoice.storeId);
    if (page.purgedAt) {
      throw new DomainError(
        'DOCUMENT_UNAVAILABLE',
        'The stored file was removed after the retention period.',
        410,
      );
    }
    try {
      return {
        data: await this.storage.get(page.storageKey),
        mimeType: page.mimeType,
        name: `page-${page.pageNo}.${page.mimeType === 'application/pdf' ? 'pdf' : page.mimeType === 'image/png' ? 'png' : 'jpg'}`,
      };
    } catch (e) {
      if (e instanceof StorageObjectNotFound) {
        throw new DomainError('DOCUMENT_UNAVAILABLE', 'The stored file is not available.', 410);
      }
      throw e;
    }
  }

  // ── Review (PRD §10.2 screens 3–4, §11) ────────────────────────────────────

  async updateHeader(
    ctx: RequestContext,
    id: string,
    input: UpdateInvoiceHeader,
  ): Promise<InvoiceDetailDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const invoice = await this.reviewable(tx, ctx, id, input.version);
      const data: Prisma.InvoiceUncheckedUpdateManyInput = {};

      let supplierChanged = false;
      if (input.supplierId !== undefined && input.supplierId !== invoice.supplierId) {
        if (input.supplierId !== null) {
          const supplier = await tx.supplier.findFirst({
            where: { projectId: ctx.projectId, id: input.supplierId },
          });
          if (!supplier) throw notFound('Supplier');
          if (!supplier.isActive) throw invalid('This supplier is inactive.');
        }
        data.supplierId = input.supplierId;
        supplierChanged = true;
      }
      if (input.supplierName !== undefined && input.supplierName !== invoice.supplierNameRaw) {
        data.supplierNameRaw = input.supplierName;
        // A newly typed name is a different supplier unless one is chosen in the same request.
        if (input.supplierId === undefined && invoice.supplierId !== null) {
          data.supplierId = null;
          supplierChanged = true;
        }
      }
      if (input.supplierGstin !== undefined) data.supplierGstinRaw = input.supplierGstin;
      if (input.supplierAddress !== undefined) data.supplierAddressRaw = input.supplierAddress;
      if (input.invoiceNo !== undefined) {
        data.invoiceNo = input.invoiceNo;
        data.normalizedInvoiceNo = normaliseDocumentNo(input.invoiceNo);
      }
      if (input.challanNo !== undefined) {
        data.challanNo = input.challanNo;
        data.normalizedChallanNo = normaliseDocumentNo(input.challanNo);
      }
      if (input.invoiceDate !== undefined) {
        data.invoiceDate = input.invoiceDate
          ? new Date(`${input.invoiceDate}T00:00:00.000Z`)
          : null;
      }
      if (input.documentType !== undefined) data.documentType = input.documentType;
      if (input.notes !== undefined) data.notes = input.notes;

      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { ...data, version: { increment: 1 } },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: id,
        before: {
          supplierId: invoice.supplierId,
          supplierName: invoice.supplierNameRaw,
          invoiceNo: invoice.invoiceNo,
          invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
          challanNo: invoice.challanNo,
        },
        after: data,
      });

      // Supplier mappings belong to a supplier: with another supplier, lines the user has not
      // resolved by hand are matched again (no LLM).
      if (supplierChanged) {
        const supplierId = (data.supplierId as string | null | undefined) ?? null;
        const matching = await this.matching(tx, ctx, supplierId);
        const items = await tx.invoiceItem.findMany({
          where: { projectId: ctx.projectId, invoiceId: id, lineStatus: { not: 'EXCLUDED' } },
        });
        for (const item of items) {
          if (item.matchMethod === 'MANUAL' || item.isManualEntry) continue;
          const result = await matchLine(this.lineInput(item), matching.ctx, matching.catalog);
          await tx.invoiceItem.updateMany({
            where: { projectId: ctx.projectId, id: item.id },
            data: this.matchColumns(result, item, matching.ctx.thresholds),
          });
        }
      }
      return this.get(ctx, id, tx);
    });
  }

  async updateItem(
    ctx: RequestContext,
    id: string,
    itemId: string,
    input: UpdateInvoiceItem,
  ): Promise<InvoiceDetailDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const invoice = await this.reviewable(tx, ctx, id, input.version);
      const item = await tx.invoiceItem.findFirst({
        where: { projectId: ctx.projectId, invoiceId: id, id: itemId },
      });
      if (!item) throw notFound('Line');

      const data = await this.lineChanges(tx, ctx, invoice.supplierId, item, input);
      await tx.invoiceItem.updateMany({
        where: { projectId: ctx.projectId, id: itemId },
        data: { ...data, reviewedById: ctx.userId, reviewedAt: new Date() },
      });
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { version: { increment: 1 } },
      });
      const after = await tx.invoiceItem.findFirstOrThrow({
        where: { projectId: ctx.projectId, id: itemId },
      });
      // User corrections are kept beside the frozen AI output (PRD §18.3).
      await this.audit.write(tx, ctx, {
        action: 'invoice_item.update',
        entityType: 'invoice_item',
        entityId: itemId,
        before: this.auditView(item),
        after: this.auditView(after),
        metadata: { invoiceId: id, lineNo: item.lineNo },
      });
      return this.get(ctx, id, tx);
    });
  }

  /** A line typed by the user (PRD §11.5 "allow manual entry for that item"). */
  async addItem(ctx: RequestContext, id: string, input: AddInvoiceItem): Promise<InvoiceDetailDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const invoice = await this.reviewable(tx, ctx, id, input.version);
      const last = await tx.invoiceItem.findFirst({
        where: { projectId: ctx.projectId, invoiceId: id },
        orderBy: { lineNo: 'desc' },
        select: { lineNo: true },
      });
      const created = await tx.invoiceItem.create({
        data: {
          projectId: ctx.projectId,
          invoiceId: id,
          lineNo: (last?.lineNo ?? 0) + 1,
          isManualEntry: true,
          originalDescription: input.description,
          normalizedDescription: normalise(input.description),
          matchStatus: 'REVIEW_REQUIRED',
          lineStatus: 'PENDING',
        },
      });
      const data = await this.lineChanges(tx, ctx, invoice.supplierId, created, input, true);
      await tx.invoiceItem.updateMany({
        where: { projectId: ctx.projectId, id: created.id },
        data: { ...data, reviewedById: ctx.userId, reviewedAt: new Date() },
      });
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { version: { increment: 1 } },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice_item.create',
        entityType: 'invoice_item',
        entityId: created.id,
        after: { description: input.description, manualEntry: true },
        metadata: { invoiceId: id, lineNo: created.lineNo },
      });
      return this.get(ctx, id, tx);
    });
  }

  /**
   * "Authorised resolution" of a duplicate (PRD §13.3, DECISIONS Q6): the Project Admin states
   * that this is a genuinely different document. The Store Manager can then receive it.
   */
  async overrideDuplicate(
    ctx: RequestContext,
    id: string,
    note: string,
  ): Promise<InvoiceDetailDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { projectId: ctx.projectId, id } });
      if (!invoice) throw notFound('Document');
      if (invoice.status !== 'READY_FOR_REVIEW') {
        throw new DomainError(
          'INVOICE_NOT_EDITABLE',
          'Only a document waiting for review can be authorised.',
          409,
        );
      }
      const duplicates = await this.duplicates(tx, invoice);
      await tx.invoice.updateMany({
        where: { projectId: ctx.projectId, id },
        data: {
          duplicateOverrideById: ctx.userId,
          duplicateOverrideAt: new Date(),
          duplicateOverrideNote: note,
          version: { increment: 1 },
        },
      });
      await this.audit.write(tx, ctx, {
        action: 'invoice.duplicate_override',
        entityType: 'invoice',
        entityId: id,
        after: { note },
        metadata: { duplicates },
      });
      return this.get(ctx, id, tx);
    });
  }

  /** CONFIRM & RECEIVE (PRD §10.2 screen 5). The inventory engine posts; nothing here does. */
  confirm(
    ctx: RequestContext,
    id: string,
    version: number,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    return this.receipts.confirm(ctx, id, version, idempotencyKey);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async editable(db: Db, ctx: RequestContext, id: string, statuses: readonly string[]) {
    const invoice = await db.invoice.findFirst({ where: { projectId: ctx.projectId, id } });
    if (!invoice) throw notFound('Document');
    assertStoreAccess(ctx, invoice.storeId);
    if (!statuses.includes(invoice.status)) {
      throw new DomainError(
        'INVOICE_NOT_EDITABLE',
        invoice.status === 'POSTED'
          ? 'This document was already received.'
          : 'This document cannot be changed in its current state.',
        409,
      );
    }
    return invoice;
  }

  private async reviewable(db: Db, ctx: RequestContext, id: string, version: number) {
    // Lock the row so two edits (or an edit and a confirmation) cannot interleave.
    await db.$queryRaw`SELECT id FROM invoices WHERE id = ${id}::uuid AND project_id = ${ctx.projectId}::uuid FOR UPDATE`;
    const invoice = await this.editable(db, ctx, id, ['READY_FOR_REVIEW']);
    if (invoice.version !== version) {
      throw new DomainError('STALE_VERSION', 'The document changed. Reload and try again.', 409);
    }
    return invoice;
  }

  private async matching(db: Db, ctx: RequestContext, supplierId: string | null) {
    const [masters, project] = await Promise.all([
      loadMatchingMasters(db, ctx.projectId),
      db.project.findUniqueOrThrow({ where: { id: ctx.projectId }, select: { settings: true } }),
    ]);
    const matchCtx: MatchContext = {
      supplierId,
      units: masters.units,
      conversions: masters.conversions,
      categories: masters.categories,
      thresholds: parseProjectSettings(project.settings).confidence,
    };
    return { ctx: matchCtx, catalog: createMaterialCatalog(db, ctx.projectId), masters };
  }

  private lineInput(item: {
    originalDescription: string;
    extracted: Prisma.JsonValue | null;
    invoiceUnitId: string | null;
  }): MatchLineInput {
    const x = item.extracted as unknown as ExtractedLine | null;
    return {
      description: item.originalDescription,
      suggestedName: val(x?.suggestedName),
      brand: val(x?.brand),
      category: val(x?.category),
      specification: val(x?.specification),
      grade: val(x?.grade),
      size: val(x?.size),
      packSize: val(x?.packSize),
      unitId: item.invoiceUnitId,
    };
  }

  private matchColumns(
    result: MatchResult,
    item: {
      extracted: Prisma.JsonValue | null;
      invoiceQty: Prisma.Decimal | null;
      invoiceUnitId: string | null;
    },
    thresholds: ConfidenceThresholds,
  ): Prisma.InvoiceItemUncheckedUpdateManyInput {
    const x = item.extracted as unknown as ExtractedLine | null;
    const uncertain = x
      ? (['description', 'quantity', 'unit'] as const).some((f) =>
          fieldNeedsReview(x[f], thresholds),
        )
      : true;
    const clean =
      result.status === 'MATCHED' &&
      !result.requiresConfirmation &&
      !uncertain &&
      item.invoiceQty !== null &&
      item.invoiceUnitId !== null;
    return {
      matchStatus: result.status,
      matchMethod: result.method,
      matchScore: result.score === null ? null : result.score.toFixed(4),
      candidates: result.candidates as unknown as Prisma.InputJsonValue,
      specConflicts:
        result.conflicts.length > 0
          ? (result.conflicts as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      materialId: result.status === 'MATCHED' ? result.materialId : null,
      proposedMaterial:
        result.status === 'NEW_MATERIAL' && result.proposal
          ? (result.proposal as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
      lineStatus: clean ? 'CONFIRMED' : 'PENDING',
    };
  }

  /** Turns a user edit into column changes, validating every reference against this project. */
  private async lineChanges(
    tx: Db,
    ctx: RequestContext,
    supplierId: string | null,
    item: Prisma.InvoiceItemGetPayload<object>,
    input: Omit<UpdateInvoiceItem, 'version'>,
    isNew = false,
  ): Promise<Prisma.InvoiceItemUncheckedUpdateManyInput> {
    const data: Prisma.InvoiceItemUncheckedUpdateManyInput = {};
    const next = {
      description: input.description ?? item.originalDescription,
      invoiceUnitId: input.invoiceUnitId !== undefined ? input.invoiceUnitId : item.invoiceUnitId,
    };

    if (input.description !== undefined && input.description !== item.originalDescription) {
      data.originalDescription = input.description;
      data.normalizedDescription = normalise(input.description);
    }
    if (input.invoiceUnitId !== undefined && input.invoiceUnitId !== item.invoiceUnitId) {
      if (input.invoiceUnitId !== null) {
        const unit = await tx.unit.findFirst({
          where: {
            id: input.invoiceUnitId,
            OR: [{ projectId: null }, { projectId: ctx.projectId }],
            isActive: true,
          },
        });
        if (!unit) throw notFound('Unit');
      }
      data.invoiceUnitId = input.invoiceUnitId;
    }

    const line = this.lineInput({
      ...item,
      originalDescription: next.description,
      invoiceUnitId: next.invoiceUnitId,
    });
    const explicit = input.materialId !== undefined || input.proposedMaterial !== undefined;
    const matching = await this.matching(tx, ctx, supplierId);

    if (input.materialId) {
      // The user chose the material: the choice stands, and any conflict with the document is
      // recorded and shown, never hidden (PRD §7.3 "AI must never silently assign…").
      const material = await tx.material.findFirst({
        where: { projectId: ctx.projectId, id: input.materialId },
        include: {
          category: { select: { name: true } },
          stockUnit: { select: { code: true } },
          packUnit: { select: { code: true } },
        },
      });
      if (!material) throw notFound('Material');
      if (material.status !== 'ACTIVE') {
        throw new DomainError('MATERIAL_INACTIVE', `${material.name} is inactive.`, 409);
      }
      const conflicts = conflictsWith(line, toCatalogMaterial(material), matching.ctx);
      data.materialId = material.id;
      data.proposedMaterial = Prisma.DbNull;
      data.matchStatus = 'MATCHED';
      data.matchMethod = 'MANUAL';
      data.matchScore = null;
      data.specConflicts =
        conflicts.length > 0 ? (conflicts as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    } else if (input.proposedMaterial) {
      const p = input.proposedMaterial;
      if (p.categoryId) {
        const category = await tx.materialCategory.findFirst({
          where: { projectId: ctx.projectId, id: p.categoryId },
        });
        if (!category) throw notFound('Category');
      }
      for (const unitId of [p.stockUnitId, p.packUnitId]) {
        if (!unitId) continue;
        const unit = await tx.unit.findFirst({
          where: { id: unitId, OR: [{ projectId: null }, { projectId: ctx.projectId }] },
        });
        if (!unit) throw notFound('Unit');
      }
      data.materialId = null;
      data.proposedMaterial = p as unknown as Prisma.InputJsonValue;
      data.matchStatus = 'NEW_MATERIAL';
      data.matchMethod = 'MANUAL';
      data.matchScore = null;
      data.specConflicts = Prisma.DbNull;
    } else if (input.materialId === null && input.proposedMaterial === undefined) {
      data.materialId = null;
      data.matchStatus = 'REVIEW_REQUIRED';
      data.matchMethod = null;
      data.matchScore = null;
      data.specConflicts = Prisma.DbNull;
    } else if (input.proposedMaterial === null && input.materialId === undefined) {
      data.proposedMaterial = Prisma.DbNull;
      data.matchStatus = 'REVIEW_REQUIRED';
      data.matchMethod = null;
    }

    // A corrected description (or a new manual line) is matched again, without the LLM.
    if (!explicit && (isNew || data.originalDescription !== undefined)) {
      const result = await matchLine(line, matching.ctx, matching.catalog);
      Object.assign(
        data,
        this.matchColumns(
          result,
          { ...item, invoiceUnitId: next.invoiceUnitId },
          matching.ctx.thresholds,
        ),
      );
      // A line the user typed or rewrote always waits for their tick.
      data.lineStatus = 'PENDING';
    }

    // Quantities. Invoice quantity and actual received quantity are separate (PRD §10.2 screen 4).
    const q = (v: string | null | undefined, current: Prisma.Decimal | null) =>
      v === undefined ? current : v === null ? null : new Prisma.Decimal(v);
    const invoiceQty = q(input.invoiceQty, item.invoiceQty);
    let acceptedQty = q(input.acceptedQty, item.acceptedQty);
    const damagedQty = q(input.damagedQty, item.damagedQty) ?? new Prisma.Decimal(0);
    const rejectedQty = q(input.rejectedQty, item.rejectedQty) ?? new Prisma.Decimal(0);
    // Correcting a misread invoice quantity carries the received quantity with it, as long as
    // the user had not entered a different received quantity.
    const untouched =
      input.acceptedQty === undefined &&
      damagedQty.isZero() &&
      rejectedQty.isZero() &&
      (item.acceptedQty === null ||
        (item.invoiceQty !== null && item.acceptedQty.equals(item.invoiceQty)));
    if (input.invoiceQty !== undefined && untouched) acceptedQty = invoiceQty;

    if (input.invoiceQty !== undefined) data.invoiceQty = invoiceQty;
    if (input.acceptedQty !== undefined || acceptedQty !== item.acceptedQty)
      data.acceptedQty = acceptedQty;
    if (input.damagedQty !== undefined) data.damagedQty = damagedQty;
    if (input.rejectedQty !== undefined) data.rejectedQty = rejectedQty;
    const received = new Decimal(acceptedQty?.toString() ?? '0')
      .plus(damagedQty.toString())
      .plus(rejectedQty.toString());
    const short =
      invoiceQty === null
        ? new Decimal(0)
        : Decimal.max(0, new Decimal(invoiceQty.toString()).minus(received));
    data.shortQty = short.toString();

    if (input.discrepancyReason !== undefined) data.discrepancyReason = input.discrepancyReason;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.lineStatus !== undefined) data.lineStatus = input.lineStatus;
    return data;
  }

  private auditView(item: Prisma.InvoiceItemGetPayload<object>) {
    return {
      description: item.originalDescription,
      materialId: item.materialId,
      proposedMaterial: item.proposedMaterial,
      matchStatus: item.matchStatus,
      matchMethod: item.matchMethod,
      invoiceQty: dec(item.invoiceQty),
      invoiceUnitId: item.invoiceUnitId,
      acceptedQty: dec(item.acceptedQty),
      damagedQty: item.damagedQty.toString(),
      rejectedQty: item.rejectedQty.toString(),
      discrepancyReason: item.discrepancyReason,
      lineStatus: item.lineStatus,
      notes: item.notes,
    };
  }

  private duplicates(
    db: Db,
    invoice: {
      id: string;
      projectId: string;
      supplierId: string | null;
      normalizedInvoiceNo: string | null;
      invoiceDate: Date | null;
      normalizedChallanNo: string | null;
      documentFingerprint: string | null;
    },
  ) {
    return findDuplicateInvoices(db, {
      projectId: invoice.projectId,
      invoiceId: invoice.id,
      supplierId: invoice.supplierId,
      normalizedInvoiceNo: invoice.normalizedInvoiceNo,
      invoiceDate: invoice.invoiceDate,
      normalizedChallanNo: invoice.normalizedChallanNo,
      documentFingerprint: invoice.documentFingerprint,
    });
  }

  private toSummary(r: SummaryRow | InvoiceRow, lineCount: number): InvoiceSummaryDto {
    return {
      id: r.id,
      storeId: r.storeId,
      storeName: r.store.name,
      status: r.status,
      stage: r.stage,
      documentType: r.documentType,
      supplierName: r.supplier?.name ?? r.supplierNameRaw,
      invoiceNo: r.invoiceNo,
      challanNo: r.challanNo,
      invoiceDate: r.invoiceDate?.toISOString().slice(0, 10) ?? null,
      lineCount,
      pageCount: r.pages.reduce((n, p) => n + p.pageCount, 0),
      uploadedByName: r.uploadedBy.name,
      createdAt: r.createdAt.toISOString(),
      postedAt: r.postedAt?.toISOString() ?? null,
      receiptReferenceNo: r.posting?.referenceNo ?? null,
      postingId: r.posting?.id ?? null,
      failureMessage: r.failureMessage,
    };
  }

  private toItem(
    item: ItemRow,
    lineMasters: LineMasters,
    masters: MatchingMasters,
    thresholds: ConfidenceThresholds,
    supplierId: string | null,
    open: boolean,
  ): InvoiceItemDto {
    const assessment = assessLine(item, lineMasters);
    const extracted = item.extracted as unknown as ExtractedLine | null;
    const uncertainFields = extracted
      ? LINE_FIELDS.filter((f) => fieldNeedsReview(extracted[f], thresholds))
      : [];
    const proposed = proposalOf(item);
    const matchCtx: MatchContext = {
      supplierId,
      units: masters.units,
      conversions: masters.conversions,
      categories: masters.categories,
      thresholds,
    };
    return {
      id: item.id,
      lineNo: item.lineNo,
      pageNo: item.pageNo,
      isManualEntry: item.isManualEntry,
      description: item.originalDescription,
      hsnCode: item.hsnCode,
      extracted,
      matchStatus: item.matchStatus,
      matchMethod: item.matchMethod,
      matchScore: item.matchScore === null ? null : Number(item.matchScore),
      candidates: (item.candidates as unknown as MatchCandidate[] | null) ?? [],
      specConflicts: (item.specConflicts as unknown as MatchConflict[] | null) ?? [],
      material: item.material
        ? {
            id: item.material.id,
            code: item.material.code,
            name: item.material.name,
            categoryName: item.material.category.name,
            stockUnitId: item.material.stockUnitId,
            stockUnitCode: item.material.stockUnit.code,
            packSize: dec(item.material.packSize),
            packUnitCode: item.material.packUnit?.code ?? null,
            status: item.material.status,
          }
        : null,
      proposedMaterial: proposed,
      suggestedProposal: open && !proposed ? buildProposal(this.lineInput(item), matchCtx) : null,
      invoiceQty: dec(item.invoiceQty),
      invoiceUnitId: item.invoiceUnitId,
      invoiceUnitCode: item.invoiceUnit?.code ?? null,
      invoiceUnitRaw: item.invoiceUnitRaw,
      unitPrice: dec(item.unitPrice),
      lineTotal: dec(item.lineTotal),
      acceptedQty: dec(item.acceptedQty),
      damagedQty: item.damagedQty.toString(),
      rejectedQty: item.rejectedQty.toString(),
      shortQty: item.shortQty.toString(),
      discrepancyReason: item.discrepancyReason,
      notes: item.notes,
      lineStatus: item.lineStatus,
      stock: assessment.stock
        ? {
            unitCode: assessment.stock.unitCode,
            acceptedQty: assessment.stock.accepted.toString(),
            damagedQty: assessment.stock.damaged.toString(),
          }
        : null,
      // After posting there is nothing left to fix.
      issues: open ? assessment.issues : [],
      warnings: open ? assessment.warnings : [],
      uncertainFields,
    };
  }

  private async toDetail(db: Db, ctx: RequestContext, r: InvoiceRow): Promise<InvoiceDetailDto> {
    const open = r.status === 'READY_FOR_REVIEW';
    const thresholds = parseProjectSettings(r.project.settings).confidence;
    const [lineMasters, masters] = await Promise.all([
      loadLineMasters(db, ctx.projectId),
      loadMatchingMasters(db, ctx.projectId),
    ]);
    const items = r.items.map((i) =>
      this.toItem(i, lineMasters, masters, thresholds, r.supplierId, open),
    );
    const active = items.filter((i) => i.lineStatus !== 'EXCLUDED');

    // The supplier on the document may be one we know under a similar name (DECISIONS Q7).
    const supplierSuggestions: InvoiceDetailDto['supplierSuggestions'] = [];
    if (open && !r.supplierId && (r.supplierNameRaw || r.supplierGstinRaw)) {
      const suppliers = await db.supplier.findMany({
        where: { projectId: ctx.projectId, isActive: true },
        select: { id: true, name: true, gstin: true, normalizedName: true },
        take: 500,
      });
      const tokens = normalise(r.supplierNameRaw).split(' ').filter(Boolean);
      for (const s of suppliers) {
        if (r.supplierGstinRaw && s.gstin === r.supplierGstinRaw) {
          supplierSuggestions.push({
            id: s.id,
            name: s.name,
            gstin: s.gstin,
            reason: 'Same GSTIN',
          });
        } else if (nameSimilarity(tokens, s.normalizedName.split(' ')) >= 0.6) {
          supplierSuggestions.push({
            id: s.id,
            name: s.name,
            gstin: s.gstin,
            reason: 'Similar name',
          });
        }
      }
    }

    const duplicates =
      open || r.status === 'QUEUED' || r.status === 'PROCESSING'
        ? await this.duplicates(db, r)
        : [];

    // Soft checks on totals (DECISIONS Q35). Never blocking: tax and accounting are out of scope.
    const warnings: string[] = [];
    if (open && r.invoiceTotal !== null) {
      const totals = active.map((i) => i.lineTotal).filter((t): t is string => t !== null);
      if (totals.length === active.length && totals.length > 0) {
        const sum = totals.reduce((a, t) => a.plus(t), new Decimal(0));
        const total = new Decimal(r.invoiceTotal.toString());
        // Lines are before tax, the total usually after it: only a total below the lines is odd.
        if (sum.gt(total.plus(1))) {
          warnings.push(
            `The lines add up to ${sum.toDecimalPlaces(2).toString()}, more than the document total of ${total.toString()}. A line may be misread.`,
          );
        }
      }
    }
    const quality = r.qualityReport as unknown as QualityReportDto | null;
    if (open && quality?.issues.includes('MISSING_PAGES')) {
      warnings.push('Some pages may be missing. Check that every line of the document is listed.');
    }

    const extractedHeader = r.extractedHeader as unknown as ExtractedHeader | null;
    const blockers: string[] = [];
    if (open) {
      if (active.length === 0) blockers.push('Add at least one material line.');
      if (!r.supplierId && (r.supplierNameRaw?.trim().length ?? 0) < 2)
        blockers.push('Enter the supplier.');
      const withIssues = active.filter((i) => i.issues.length > 0).length;
      if (withIssues > 0) blockers.push(`${withIssues} line(s) still need your attention.`);
      if (duplicates.length > 0 && !r.duplicateOverrideAt) {
        blockers.push('This looks like a document that was already received.');
      }
    }

    const pages: InvoicePageDto[] = r.pages.map((p) => ({
      pageNo: p.pageNo,
      mimeType: p.mimeType as UploadMimeType,
      pageCount: p.pageCount,
      sizeBytes: p.sizeBytes,
      originalName: p.originalName,
      purged: p.purgedAt !== null,
      quality: p.quality as unknown as PageQualityDto | null,
    }));

    return {
      ...this.toSummary(r, r.items.length),
      version: r.version,
      quality,
      qualityOverridden: r.qualityOverridden,
      failureCode: r.failureCode,
      supplierId: r.supplierId,
      supplierNameRaw: r.supplierNameRaw,
      supplierGstin: r.supplier?.gstin ?? r.supplierGstinRaw,
      supplierAddress: r.supplierAddressRaw,
      invoiceTotal: dec(r.invoiceTotal),
      notes: r.notes,
      extractedHeader,
      uncertainHeaderFields: extractedHeader
        ? HEADER_FIELDS.filter((f) => fieldNeedsReview(extractedHeader[f], thresholds))
        : [],
      supplierSuggestions: supplierSuggestions.slice(0, 5),
      pages,
      items,
      duplicates,
      duplicateOverride:
        r.duplicateOverrideAt && r.duplicateOverrideBy
          ? {
              byName: r.duplicateOverrideBy.name,
              at: r.duplicateOverrideAt.toISOString(),
              note: r.duplicateOverrideNote ?? '',
            }
          : null,
      warnings,
      summary: {
        lines: active.length,
        excluded: items.length - active.length,
        newMaterials: active.filter((i) => i.proposedMaterial !== null).length,
        needsAttention: active.filter((i) => i.issues.length > 0).length,
        blockers,
        ready: open && blockers.length === 0,
      },
      thresholds,
    };
  }
}
