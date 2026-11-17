import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, formatYearlyNumber, nextSequenceValue } from '@kavach/db';
import {
  Decimal,
  type DuplicateInvoiceDetails,
  type LineIssue,
  MaterialInputSchema,
  type PostingDto,
  normalise,
} from '@kavach/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { DomainError, forbidden, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { MaterialsService } from '../materials/materials.service';
import { InventoryService } from './inventory.service';
import {
  ITEM_INCLUDE,
  type LineAssessment,
  assessLine,
  duplicateKeys,
  findDuplicateInvoices,
  loadLineMasters,
  proposalOf,
} from './invoice-lines';

export interface IncompleteReviewDetails {
  /** Problems with the header: supplier missing, nothing to receive. */
  header: string[];
  lines: { itemId: string; lineNo: number; issues: LineIssue[] }[];
}

const hash = (payload: unknown) =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const isUnique = (e: unknown): e is Prisma.PrismaClientKnownRequestError =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * CONFIRM & RECEIVE (PRD §10.2 screen 5, §31.1; ARCHITECTURE §5.4).
 *
 * The only place where a scanned document changes stock, and it runs only when a Store Manager
 * confirms. One database transaction:
 *
 *   1. validate all materials            5. update stock balances
 *   2. check duplicate invoices          6. save supplier mappings
 *   3. create approved new materials     7. keep the document reference
 *   4. create Material In transactions   8. record user and time   9. receipt reference
 *
 * If any step fails, nothing remains: no material, no ledger row, no mapping (CLAUDE.md
 * invariant 9, PRD §26 rule 18). The AI's output is only ever the starting value of the draft the
 * user reviewed; what is posted is what the user confirmed, validated again here.
 */
@Injectable()
export class InvoiceReceiptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly materials: MaterialsService,
  ) {}

  async confirm(
    ctx: RequestContext,
    invoiceId: string,
    version: number,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    const requestHash = hash({ invoiceId, version });
    try {
      return await this.inventory.executeWithIdempotency(ctx, idempotencyKey, requestHash, () =>
        this.prisma.db.$transaction(
          (tx) => this.post(tx, ctx, invoiceId, version, idempotencyKey, requestHash),
          { timeout: 20_000 },
        ),
      );
    } catch (e) {
      // Two confirmations of the same document in a race: the unique duplicate keys decide.
      if (isUnique(e) && JSON.stringify(e.meta?.target ?? '').includes('dup_')) {
        throw new DomainError('DUPLICATE_INVOICE', 'This document was already received.', 409, {
          duplicates: [],
        } satisfies DuplicateInvoiceDetails);
      }
      if (isUnique(e) && JSON.stringify(e.meta?.target ?? '').includes('identity_key')) {
        throw new DomainError(
          'MATERIAL_ALREADY_EXISTS',
          'One of the new materials already exists. Reload and match the line to it.',
          409,
        );
      }
      throw e;
    }
  }

  private async post(
    tx: Db,
    ctx: RequestContext,
    invoiceId: string,
    version: number,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<PostingDto> {
    const replay = await this.inventory.findIdempotentPosting(
      tx,
      ctx.projectId,
      idempotencyKey,
      requestHash,
    );
    if (replay) return replay;

    // Lock the document: a second confirmation waits here and then sees it POSTED.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM invoices WHERE id = ${invoiceId}::uuid AND project_id = ${ctx.projectId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw notFound('Document');

    const invoice = await tx.invoice.findFirstOrThrow({
      where: { projectId: ctx.projectId, id: invoiceId },
      include: { items: { include: ITEM_INCLUDE, orderBy: { lineNo: 'asc' } } },
    });
    assertStoreAccess(ctx, invoice.storeId);
    if (invoice.status === 'POSTED') {
      throw new DomainError('INVOICE_NOT_EDITABLE', 'This document was already received.', 409);
    }
    if (invoice.status !== 'READY_FOR_REVIEW') {
      throw new DomainError(
        'INVOICE_NOT_EDITABLE',
        'This document is not ready to be received.',
        409,
      );
    }
    if (invoice.version !== version) {
      throw new DomainError(
        'STALE_VERSION',
        'The document changed. Reload and check it again.',
        409,
      );
    }
    await this.inventory.validateStore(tx, ctx.projectId, invoice.storeId);

    // ── 1. Validate every line ───────────────────────────────────────────────
    const masters = await loadLineMasters(tx, ctx.projectId);
    const lines = invoice.items.filter((i) => i.lineStatus !== 'EXCLUDED');
    const assessed = new Map<string, LineAssessment>();
    const incomplete: IncompleteReviewDetails = { header: [], lines: [] };
    for (const item of lines) {
      const a = assessLine(item, masters);
      assessed.set(item.id, a);
      if (a.issues.length > 0)
        incomplete.lines.push({ itemId: item.id, lineNo: item.lineNo, issues: a.issues });
    }
    if (lines.length === 0) incomplete.header.push('Add at least one material line.');
    const supplierName = invoice.supplierNameRaw?.trim() ?? '';
    if (!invoice.supplierId && supplierName.length < 2)
      incomplete.header.push('Enter the supplier.');
    const receivesSomething = lines.some((i) => {
      const s = assessed.get(i.id)!.stock;
      return s !== null && (s.accepted.gt(0) || s.damaged.gt(0));
    });
    if (lines.length > 0 && incomplete.lines.length === 0 && !receivesSomething) {
      incomplete.header.push(
        'Nothing is being received: every line is fully rejected. Discard the document instead.',
      );
    }
    if (incomplete.header.length > 0 || incomplete.lines.length > 0) {
      throw new DomainError(
        'REVIEW_INCOMPLETE',
        'Some lines still need your attention before the material can be received.',
        409,
        incomplete,
      );
    }

    // ── Supplier: the chosen one, a known one by GSTIN or name, or a new one (DECISIONS Q7) ──
    const supplier = await this.resolveSupplier(tx, ctx, invoice);

    // ── 2. Duplicate invoice check (PRD §13) ─────────────────────────────────
    const probe = {
      projectId: ctx.projectId,
      invoiceId: invoice.id,
      supplierId: supplier.id,
      normalizedInvoiceNo: invoice.normalizedInvoiceNo,
      invoiceDate: invoice.invoiceDate,
      normalizedChallanNo: invoice.normalizedChallanNo,
      documentFingerprint: invoice.documentFingerprint,
    };
    const overridden = invoice.duplicateOverrideAt !== null;
    if (!overridden) {
      const duplicates = await findDuplicateInvoices(tx, probe);
      if (duplicates.length > 0) {
        throw new DomainError(
          'DUPLICATE_INVOICE',
          'This looks like a document that was already received. Ask the Project Admin if it really is a different one.',
          409,
          { duplicates } satisfies DuplicateInvoiceDetails,
        );
      }
    }

    // ── 3. Create approved new Material Master records ───────────────────────
    const materialOf = new Map<string, { id: string; stockUnitId: string; created: boolean }>();
    const createdByIdentity = new Map<string, string>();
    for (const item of lines) {
      if (item.material) {
        materialOf.set(item.id, {
          id: item.material.id,
          stockUnitId: item.material.stockUnitId,
          created: false,
        });
        continue;
      }
      if (!ctx.permissions.has('material:create_via_receipt')) {
        throw forbidden('You cannot create new materials. Match the line to an existing material.');
      }
      const proposal = proposalOf(item)!;
      const { confirmNotDuplicate } = proposal;
      const data = MaterialInputSchema.parse({
        name: proposal.name,
        categoryId: proposal.categoryId,
        brand: proposal.brand,
        specification: proposal.specification,
        grade: proposal.grade,
        size: proposal.size,
        stockUnitId: proposal.stockUnitId,
        packSize: proposal.packSize,
        packUnitId: proposal.packUnitId,
        isVariableWeight: proposal.isVariableWeight,
      });
      // Two lines of one document may describe the same new material: it is created once.
      const identity = await this.materials.identityKeyFor(tx, ctx, data);
      let materialId = createdByIdentity.get(identity);
      if (!materialId) {
        try {
          const created = await this.materials.createInTransaction(tx, ctx, data, {
            source: 'AI_INVOICE',
            confirmNotDuplicate,
            metadata: {
              invoiceId: invoice.id,
              invoiceItemId: item.id,
              lineNo: item.lineNo,
              documentDescription: item.originalDescription,
              aiExtracted: item.extracted,
            },
          });
          materialId = created.id;
          createdByIdentity.set(identity, materialId);
        } catch (e) {
          if (
            e instanceof DomainError &&
            (e.code === 'MATERIAL_ALREADY_EXISTS' || e.code === 'POSSIBLE_DUPLICATE')
          ) {
            // Tell the screen which line it is, so it can offer the existing material.
            throw new DomainError(e.code, `Line ${item.lineNo}: ${e.message}`, e.status, {
              ...(e.details as object),
              itemId: item.id,
              lineNo: item.lineNo,
            });
          }
          throw e;
        }
      }
      materialOf.set(item.id, {
        id: materialId,
        stockUnitId: proposal.stockUnitId!,
        created: true,
      });
    }

    // ── 4–5. Ledger rows and balances, under row locks ───────────────────────
    const materialIds = [...new Set([...materialOf.values()].map((m) => m.id))];
    const balances = await this.inventory.lockBalances(
      tx,
      ctx.projectId,
      invoice.storeId,
      materialIds,
    );

    let rowCount = 0;
    for (const item of lines) {
      const s = assessed.get(item.id)!.stock!;
      if (s.accepted.gt(0)) rowCount += 1;
      if (s.damaged.gt(0)) rowCount += 1;
    }
    const year = new Date().getFullYear();
    const referenceNo = formatYearlyNumber(
      'RCV',
      year,
      await nextSequenceValue(tx, ctx.projectId, 'RECEIPT', year, 1),
    );
    const txnStart = await nextSequenceValue(tx, ctx.projectId, 'TRANSACTION', year, rowCount);

    const posting = await tx.posting.create({
      data: {
        projectId: ctx.projectId,
        storeId: invoice.storeId,
        type: 'RECEIPT_INVOICE',
        referenceNo,
        idempotencyKey,
        requestHash,
        // 7. The posting names the document, and the document keeps its stored pages.
        invoiceId: invoice.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        externalRef: invoice.invoiceNo ?? invoice.challanNo,
        notes: invoice.notes,
        createdById: ctx.userId,
      },
    });

    let lineNo = 0;
    let txnIndex = 0;
    for (const item of lines) {
      const s = assessed.get(item.id)!.stock!;
      const material = materialOf.get(item.id)!;
      const balance = balances.get(material.id)!;
      const entered = item.invoiceUnitId !== material.stockUnitId;
      const row = async (
        bucket: 'AVAILABLE' | 'DAMAGED',
        qty: Decimal,
        enteredQty: Prisma.Decimal | null,
      ) => {
        if (bucket === 'AVAILABLE') balance.availableQty = balance.availableQty.plus(qty);
        else balance.damagedQty = balance.damagedQty.plus(qty);
        lineNo += 1;
        await tx.materialTransaction.create({
          data: {
            projectId: ctx.projectId,
            storeId: invoice.storeId,
            materialId: material.id,
            postingId: posting.id,
            lineNo,
            txnNo: formatYearlyNumber('TXN', year, txnStart + BigInt(txnIndex)),
            type: 'MATERIAL_IN',
            bucket,
            quantity: qty.toString(),
            unitId: material.stockUnitId,
            balanceAfter: (bucket === 'AVAILABLE'
              ? balance.availableQty
              : balance.damagedQty
            ).toString(),
            // The quantity and unit as on the document, with the factor used (PRD §12.3).
            enteredQty: entered ? enteredQty : null,
            enteredUnitId: entered ? item.invoiceUnitId : null,
            conversionFactor: entered ? s.factor.toDecimalPlaces(12).toString() : null,
            invoiceItemId: item.id,
            notes: item.notes,
            createdById: ctx.userId,
          },
        });
        txnIndex += 1;
      };
      // Only accepted usable quantity increases available stock (PRD §10.2 screen 4). Damaged
      // stays on site in its own bucket; rejected and short quantities are never stocked (Q5).
      if (s.accepted.gt(0)) await row('AVAILABLE', s.accepted, item.acceptedQty);
      if (s.damaged.gt(0)) await row('DAMAGED', s.damaged, item.damagedQty);
    }
    for (const [materialId, b] of balances) {
      await tx.stockBalance.updateMany({
        where: { projectId: ctx.projectId, storeId: invoice.storeId, materialId },
        data: {
          availableQty: b.availableQty.toString(),
          damagedQty: b.damagedQty.toString(),
          version: { increment: 1 },
        },
      });
    }

    // ── 6. Supplier mappings: learned only from this confirmed decision (PRD §9, §26 rule 17) ──
    const now = new Date();
    const mapped = new Set<string>();
    for (const item of lines) {
      const description = normalise(item.originalDescription);
      const material = materialOf.get(item.id)!;
      const liveKey = `${supplier.id}:${description}`;
      if (!description || mapped.has(`${liveKey}:${material.id}`)) continue;
      mapped.add(`${liveKey}:${material.id}`);

      const existing = await tx.supplierMaterialMapping.findFirst({
        where: { projectId: ctx.projectId, liveKey },
      });
      if (existing?.materialId === material.id) {
        await tx.supplierMaterialMapping.updateMany({
          where: { projectId: ctx.projectId, id: existing.id },
          data: { timesUsed: { increment: 1 }, lastUsedAt: now },
        });
        continue;
      }
      if (existing) {
        // The user chose a different material for a description that was already mapped: the
        // old mapping is disabled and replaced, on the record (DECISIONS Q14).
        await tx.supplierMaterialMapping.updateMany({
          where: { projectId: ctx.projectId, id: existing.id },
          data: {
            status: 'DISABLED',
            liveKey: null,
            disabledReason: `Replaced on receipt ${referenceNo}: the description was matched to another material.`,
          },
        });
        await this.audit.write(tx, ctx, {
          action: 'supplier_mapping.replace',
          entityType: 'supplier_mapping',
          entityId: existing.id,
          before: { materialId: existing.materialId, status: 'CONFIRMED' },
          after: { materialId: material.id, status: 'DISABLED' },
          metadata: { invoiceId: invoice.id, invoiceItemId: item.id, referenceNo },
        });
      }
      const created = await tx.supplierMaterialMapping.create({
        data: {
          projectId: ctx.projectId,
          supplierId: supplier.id,
          description: item.originalDescription,
          normalizedDescription: description,
          materialId: material.id,
          liveKey,
          confirmedById: ctx.userId,
          confirmedAt: now,
          lastUsedAt: now,
          sourceInvoiceItemId: item.id,
        },
      });
      await this.audit.write(tx, ctx, {
        action: 'supplier_mapping.create',
        entityType: 'supplier_mapping',
        entityId: created.id,
        after: {
          supplierId: supplier.id,
          description: item.originalDescription,
          materialId: material.id,
        },
        metadata: { invoiceId: invoice.id, invoiceItemId: item.id, referenceNo },
      });
    }

    // ── 8. The document is received ──────────────────────────────────────────
    for (const item of lines) {
      const material = materialOf.get(item.id)!;
      await tx.invoiceItem.updateMany({
        where: { projectId: ctx.projectId, id: item.id },
        data: {
          createdMaterialId: material.created ? material.id : null,
          reviewedById: ctx.userId,
          reviewedAt: now,
        },
      });
    }
    await tx.invoice.updateMany({
      where: { projectId: ctx.projectId, id: invoice.id },
      data: {
        status: 'POSTED',
        postedAt: now,
        supplierId: supplier.id,
        version: { increment: 1 },
        // An overridden duplicate holds no keys: it must not block, or be blocked by, the original.
        ...(overridden ? {} : duplicateKeys({ ...probe, supplierId: supplier.id })),
      },
    });

    await this.audit.write(tx, ctx, {
      action: 'posting.receipt_invoice',
      entityType: 'posting',
      entityId: posting.id,
      after: {
        referenceNo,
        invoiceId: invoice.id,
        supplierId: supplier.id,
        invoiceNo: invoice.invoiceNo,
        challanNo: invoice.challanNo,
        lines: lines.length,
        newMaterials: [...materialOf.values()].filter((m) => m.created).length,
        duplicateOverride: overridden,
      },
      // What the AI read against what the user confirmed, per line (PRD §18.3).
      metadata: {
        lines: lines.map((item) => {
          const extracted = item.extracted as {
            quantity?: { value?: string | null };
            unit?: { value?: string | null };
          } | null;
          return {
            lineNo: item.lineNo,
            description: item.originalDescription,
            materialId: materialOf.get(item.id)!.id,
            newMaterial: materialOf.get(item.id)!.created,
            matchStatus: item.matchStatus,
            matchMethod: item.matchMethod,
            matchScore: item.matchScore?.toString() ?? null,
            aiQuantity: extracted?.quantity?.value ?? null,
            aiUnit: extracted?.unit?.value ?? null,
            invoiceQty: item.invoiceQty?.toString() ?? null,
            acceptedQty: item.acceptedQty?.toString() ?? null,
            damagedQty: item.damagedQty.toString(),
            rejectedQty: item.rejectedQty.toString(),
            shortQty: item.shortQty.toString(),
            discrepancyReason: item.discrepancyReason,
            manualEntry: item.isManualEntry,
          };
        }),
      },
    });

    // 9. The receipt reference.
    return this.inventory.getPosting(ctx, posting.id, tx);
  }

  private async resolveSupplier(
    tx: Db,
    ctx: RequestContext,
    invoice: {
      id: string;
      supplierId: string | null;
      supplierNameRaw: string | null;
      supplierGstinRaw: string | null;
      supplierAddressRaw: string | null;
    },
  ): Promise<{ id: string; name: string }> {
    const rawName = invoice.supplierNameRaw?.trim() ?? '';
    const normalized = normalise(rawName);
    const gstin =
      invoice.supplierGstinRaw && /^[0-9]{2}[A-Z0-9]{13}$/.test(invoice.supplierGstinRaw)
        ? invoice.supplierGstinRaw
        : null;

    let supplier = invoice.supplierId
      ? await tx.supplier.findFirst({ where: { projectId: ctx.projectId, id: invoice.supplierId } })
      : null;
    if (invoice.supplierId && !supplier) throw notFound('Supplier');
    if (supplier && !supplier.isActive) {
      throw new DomainError(
        'CONFLICT',
        `${supplier.name} is inactive. Choose another supplier.`,
        409,
      );
    }

    if (!supplier && gstin) {
      supplier = await tx.supplier.findFirst({
        where: { projectId: ctx.projectId, gstin, isActive: true },
      });
    }
    if (!supplier && normalized) {
      supplier =
        (await tx.supplier.findFirst({
          where: { projectId: ctx.projectId, normalizedName: normalized, isActive: true },
        })) ??
        (
          await tx.supplierAlias.findFirst({
            where: {
              projectId: ctx.projectId,
              normalizedAlias: normalized,
              supplier: { isActive: true },
            },
            include: { supplier: true },
          })
        )?.supplier ??
        null;
    }

    if (!supplier) {
      if (!ctx.permissions.has('supplier:create_via_receipt')) {
        throw forbidden('You cannot create a supplier. Choose an existing one.');
      }
      supplier = await tx.supplier.create({
        data: {
          projectId: ctx.projectId,
          name: rawName,
          normalizedName: normalized,
          gstin,
          address: invoice.supplierAddressRaw,
          createdById: ctx.userId,
        },
      });
      await this.audit.write(tx, ctx, {
        action: 'supplier.create',
        entityType: 'supplier',
        entityId: supplier.id,
        after: { name: supplier.name, gstin: supplier.gstin },
        metadata: { source: 'RECEIPT', invoiceId: invoice.id },
      });
      return supplier;
    }

    // The document spells the supplier differently: remember the spelling for next time.
    if (normalized && normalized !== supplier.normalizedName) {
      const taken = await tx.supplierAlias.findFirst({
        where: { projectId: ctx.projectId, normalizedAlias: normalized },
      });
      const isOtherSupplier = await tx.supplier.findFirst({
        where: { projectId: ctx.projectId, normalizedName: normalized },
      });
      if (!taken && !isOtherSupplier) {
        await tx.supplierAlias.create({
          data: {
            projectId: ctx.projectId,
            supplierId: supplier.id,
            alias: rawName,
            normalizedAlias: normalized,
            source: 'CONFIRMED_INVOICE',
            createdById: ctx.userId,
          },
        });
      }
    }
    return supplier;
  }
}
