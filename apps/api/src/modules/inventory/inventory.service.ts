import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Material,
  type MaterialTransaction,
  type Posting,
  Prisma,
  type Store,
  formatYearlyNumber,
  nextSequenceValue,
} from '@kavach/db';
import {
  type AdjustmentInput,
  type ConversionContext,
  type ConversionRow,
  type IssueInput,
  type MaterialUnitInfo,
  type PostingDto,
  type PostingType,
  type PostingWarning,
  type QuickReceiveInput,
  type ReceiptInput,
  type ReturnCondition,
  type ReturnInput,
  type ReverseInput,
  type StockBucket,
  type TransactionDto,
  type TxnType,
  type UnitInfo,
  MaterialInputSchema,
  convert,
  Decimal,
} from '@kavach/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { conflict, invalid, notFound } from '../../common/errors/domain-error';
import { DomainError } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { MaterialsService } from '../materials/materials.service';

type TransactionWithDetails = MaterialTransaction & {
  material: { code: string; name: string };
  store: { name: string };
  unit: { code: string };
  enteredUnit?: { code: string } | null;
  location?: { path: string } | null;
  contractor?: { name: string } | null;
  createdBy: { name: string };
  posting: { referenceNo: string; type: string; supplierName: string | null };
  reversedBy?: { id: string } | null;
  reverses?: { txnNo: string } | null;
};

type PostingWithDetails = Posting & {
  store: { name: string };
  createdBy: { name: string };
  transactions: TransactionWithDetails[];
  reversedBy?: { id: string; referenceNo: string } | null;
  reverses?: { id: string; referenceNo: string } | null;
};

function hashPayload(payload: unknown): string {
  const canonical = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(canonical);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
      sorted[key] = canonical((obj as Record<string, unknown>)[key]);
    }
    return sorted;
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly materials: MaterialsService,
  ) {}

  async buildConversionContext(
    tx: Db,
    projectId: string,
    material?: MaterialUnitInfo,
    allowMaterialSpecific = true,
  ): Promise<ConversionContext> {
    const units = await tx.unit.findMany({
      where: { OR: [{ projectId: null }, { projectId }] },
    });
    const conversions = await tx.unitConversion.findMany({
      where: {
        OR: [{ projectId: null }, { projectId }],
        isActive: true,
      },
    });

    const unitsMap = new Map<string, UnitInfo>(
      units.map((u) => [u.id, { id: u.id, decimalPlaces: u.decimalPlaces }]),
    );

    const conversionRows: ConversionRow[] = conversions.map((c) => ({
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      factor: c.factor.toString(),
      materialId: c.materialId,
    }));

    return {
      units: unitsMap,
      conversions: conversionRows,
      material,
      allowMaterialSpecific,
    };
  }

  private toTransactionDto(t: TransactionWithDetails): TransactionDto {
    return {
      id: t.id,
      txnNo: t.txnNo,
      postingId: t.postingId,
      postingReferenceNo: t.posting.referenceNo,
      postingType: t.posting.type as PostingType,
      type: t.type as TxnType,
      bucket: t.bucket as StockBucket,
      quantity: t.quantity.toString(),
      unitCode: t.unit.code,
      balanceAfter: t.balanceAfter.toString(),
      enteredQuantity: t.enteredQty ? t.enteredQty.toString() : null,
      enteredUnitCode: t.enteredUnit ? t.enteredUnit.code : null,
      materialId: t.materialId,
      materialCode: t.material.code,
      materialName: t.material.name,
      storeId: t.storeId,
      storeName: t.store.name,
      locationPath: t.location ? t.location.path : null,
      contractorName: t.contractor ? t.contractor.name : null,
      supplierName: t.posting.supplierName ?? null,
      returnCondition: (t.returnCondition as ReturnCondition) ?? null,
      status: t.reversedBy ? 'REVERSED' : 'POSTED',
      reversesTxnNo: t.reverses ? t.reverses.txnNo : null,
      notes: t.notes,
      createdByName: t.createdBy.name,
      createdAt: t.createdAt.toISOString(),
    };
  }

  toPostingDto(p: PostingWithDetails): PostingDto {
    return {
      id: p.id,
      referenceNo: p.referenceNo,
      type: p.type as PostingType,
      storeId: p.storeId,
      storeName: p.store.name,
      supplierName: p.supplierName,
      externalRef: p.externalRef,
      notes: p.notes,
      postedByName: p.createdBy.name,
      postedAt: p.postedAt.toISOString(),
      status: p.reversedBy ? 'REVERSED' : 'POSTED',
      reversedBy: p.reversedBy
        ? { id: p.reversedBy.id, referenceNo: p.reversedBy.referenceNo }
        : null,
      reverses: p.reverses ? { id: p.reverses.id, referenceNo: p.reverses.referenceNo } : null,
      lines: p.transactions.map((t) => this.toTransactionDto(t)),
      warnings: (p.warnings as unknown as PostingWarning[]) ?? [],
      createdMaterialId: p.createdMaterialId,
      invoiceId: p.invoiceId,
      supplierId: p.supplierId,
    };
  }

  async getPosting(ctx: RequestContext, id: string, db: Db = this.prisma.db): Promise<PostingDto> {
    const posting = await db.posting.findFirst({
      where: { id, projectId: ctx.projectId },
      include: {
        store: true,
        createdBy: true,
        reversedBy: true,
        reverses: true,
        transactions: {
          include: {
            material: true,
            store: true,
            unit: true,
            enteredUnit: true,
            location: true,
            contractor: true,
            createdBy: true,
            posting: true,
            reversedBy: true,
            reverses: true,
          },
          orderBy: { lineNo: 'asc' },
        },
      },
    });

    if (!posting) throw notFound('Posting');
    return this.toPostingDto(posting as PostingWithDetails);
  }

  async executeWithIdempotency(
    ctx: RequestContext,
    idempotencyKey: string,
    hash: string,
    fn: () => Promise<PostingDto>,
  ): Promise<PostingDto> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        for (let attempt = 0; attempt < 10; attempt++) {
          const winner = await this.prisma.db.posting.findUnique({
            where: { projectId_idempotencyKey: { projectId: ctx.projectId, idempotencyKey } },
            include: {
              store: true,
              createdBy: true,
              reversedBy: true,
              reverses: true,
              transactions: {
                include: {
                  material: true,
                  store: true,
                  unit: true,
                  enteredUnit: true,
                  location: true,
                  contractor: true,
                  createdBy: true,
                  posting: true,
                  reversedBy: true,
                  reverses: true,
                },
                orderBy: { lineNo: 'asc' },
              },
            },
          });
          if (winner) {
            if (winner.requestHash === hash) {
              return this.toPostingDto(winner as PostingWithDetails);
            }
            throw new DomainError(
              'IDEMPOTENCY_KEY_REUSED',
              'Idempotency-Key reused with different request payload.',
              422,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      throw e;
    }
  }

  /** Multi-line manual receipt */
  async postReceipt(
    ctx: RequestContext,
    input: ReceiptInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    assertStoreAccess(ctx, input.storeId);
    const hash = hashPayload(input);

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        // 1. Idempotency
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        // 2. Validate store
        await this.validateStore(tx, ctx.projectId, input.storeId);

        // 3. Process lines
        interface PreparedLine {
          material: Material;
          acceptedQty: Decimal | null;
          damagedQty: Decimal | null;
          enteredQtyStr: string;
          enteredUnitId: string | null;
          notes: string | null;
        }

        const preparedLines: PreparedLine[] = [];
        const materialIds = new Set<string>();

        for (const line of input.lines) {
          materialIds.add(line.materialId);
          const material = await tx.material.findFirst({
            where: { id: line.materialId, projectId: ctx.projectId },
          });
          if (!material) throw notFound(`Material ${line.materialId}`);
          if (material.status !== 'ACTIVE') {
            throw new DomainError(
              'MATERIAL_INACTIVE',
              `Material ${material.name} is inactive.`,
              409,
            );
          }

          const unitCtx = await this.buildConversionContext(
            tx,
            ctx.projectId,
            {
              id: material.id,
              stockUnitId: material.stockUnitId,
              packSize: material.packSize ? material.packSize.toString() : null,
              packUnitId: material.packUnitId,
              isVariableWeight: material.isVariableWeight,
            },
            true,
          );

          let acceptedConverted: Decimal | null = null;
          if (line.acceptedQuantity) {
            const fromUnit = line.unitId ?? material.stockUnitId;
            const res = convert(line.acceptedQuantity, fromUnit, material.stockUnitId, unitCtx);
            if (!res.ok) {
              throw new DomainError(
                'UNIT_INCOMPATIBLE',
                `Incompatible unit for ${material.name}: ${res.reason}`,
                400,
              );
            }
            acceptedConverted = res.qty;
          }

          let damagedConverted: Decimal | null = null;
          if (line.damagedQuantity) {
            const fromUnit = line.unitId ?? material.stockUnitId;
            const res = convert(line.damagedQuantity, fromUnit, material.stockUnitId, unitCtx);
            if (!res.ok) {
              throw new DomainError(
                'UNIT_INCOMPATIBLE',
                `Incompatible unit for ${material.name}: ${res.reason}`,
                400,
              );
            }
            damagedConverted = res.qty;
          }

          preparedLines.push({
            material,
            acceptedQty: acceptedConverted,
            damagedQty: damagedConverted,
            enteredQtyStr: line.acceptedQuantity ?? line.damagedQuantity!,
            enteredUnitId: line.unitId ?? null,
            notes: line.notes ?? null,
          });
        }

        // 4. Lock balances in deterministic order
        const balances = await this.lockBalances(tx, ctx.projectId, input.storeId, [
          ...materialIds,
        ]);

        // 5. Sequence numbers
        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'RECEIPT', year, 1);
        const referenceNo = formatYearlyNumber('RCV', year, postingSeq);

        let totalTxns = 0;
        for (const l of preparedLines) {
          if (l.acceptedQty && l.acceptedQty.gt(0)) totalTxns++;
          if (l.damagedQty && l.damagedQty.gt(0)) totalTxns++;
        }

        const txnSeqStart = await nextSequenceValue(
          tx,
          ctx.projectId,
          'TRANSACTION',
          year,
          totalTxns,
        );

        // 6. Create posting header
        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            type: 'RECEIPT_MANUAL',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            supplierName: input.supplierName,
            externalRef: input.externalRef,
            notes: input.notes,
            createdById: ctx.userId,
          },
        });

        // 7. Insert transactions and update balances
        let txnIndex = 0;
        let lineNo = 1;

        for (const pl of preparedLines) {
          const bal = balances.get(pl.material.id)!;

          if (pl.acceptedQty && pl.acceptedQty.gt(0)) {
            bal.availableQty = bal.availableQty.plus(pl.acceptedQty);
            const txnNo = formatYearlyNumber('TXN', year, txnSeqStart + BigInt(txnIndex++));

            await tx.materialTransaction.create({
              data: {
                projectId: ctx.projectId,
                storeId: input.storeId,
                materialId: pl.material.id,
                postingId: posting.id,
                lineNo: lineNo++,
                txnNo,
                type: 'MATERIAL_IN',
                bucket: 'AVAILABLE',
                quantity: pl.acceptedQty.toString(),
                unitId: pl.material.stockUnitId,
                balanceAfter: bal.availableQty.toString(),
                enteredQty: pl.enteredUnitId ? pl.enteredQtyStr : null,
                enteredUnitId: pl.enteredUnitId,
                notes: pl.notes,
                createdById: ctx.userId,
              },
            });
          }

          if (pl.damagedQty && pl.damagedQty.gt(0)) {
            bal.damagedQty = bal.damagedQty.plus(pl.damagedQty);
            const txnNo = formatYearlyNumber('TXN', year, txnSeqStart + BigInt(txnIndex++));

            await tx.materialTransaction.create({
              data: {
                projectId: ctx.projectId,
                storeId: input.storeId,
                materialId: pl.material.id,
                postingId: posting.id,
                lineNo: lineNo++,
                txnNo,
                type: 'MATERIAL_IN',
                bucket: 'DAMAGED',
                quantity: pl.damagedQty.toString(),
                unitId: pl.material.stockUnitId,
                balanceAfter: bal.damagedQty.toString(),
                enteredQty: pl.enteredUnitId ? pl.enteredQtyStr : null,
                enteredUnitId: pl.enteredUnitId,
                notes: pl.notes,
                createdById: ctx.userId,
              },
            });
          }
        }

        // Update balances in DB
        for (const [matId, bal] of balances.entries()) {
          await tx.stockBalance.updateMany({
            where: { projectId: ctx.projectId, storeId: input.storeId, materialId: matId },
            data: {
              availableQty: bal.availableQty.toString(),
              damagedQty: bal.damagedQty.toString(),
              version: { increment: 1 },
            },
          });
        }

        await this.audit.write(tx, ctx, {
          action: 'posting.receipt',
          entityType: 'posting',
          entityId: posting.id,
          after: { referenceNo, linesCount: preparedLines.length },
        });

        return this.getPosting(ctx, posting.id, tx);
      }),
    );
  }

  /** Quick Receive: single item receipt, can create material inline */
  async postQuickReceive(
    ctx: RequestContext,
    input: QuickReceiveInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    assertStoreAccess(ctx, input.storeId);
    const hash = hashPayload(input);

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        await this.validateStore(tx, ctx.projectId, input.storeId);

        let materialId = input.materialId;
        let createdMaterialId: string | null = null;

        if (input.newMaterial) {
          // Same validation, identity key and duplicate check as every other new material (PRD §6.5).
          const { confirmNotDuplicate, ...data } = MaterialInputSchema.extend({
            confirmNotDuplicate: z.boolean().default(false),
          }).parse(input.newMaterial);
          const created = await this.materials.createInTransaction(tx, ctx, data, {
            source: 'QUICK_RECEIVE',
            confirmNotDuplicate,
          });
          materialId = created.id;
          createdMaterialId = created.id;
        }

        const material = await tx.material.findFirst({
          where: { id: materialId!, projectId: ctx.projectId },
        });
        if (!material) throw notFound('Material');
        if (material.status !== 'ACTIVE') {
          throw new DomainError('MATERIAL_INACTIVE', `Material ${material.name} is inactive.`, 409);
        }

        const unitCtx = await this.buildConversionContext(
          tx,
          ctx.projectId,
          {
            id: material.id,
            stockUnitId: material.stockUnitId,
            packSize: material.packSize ? material.packSize.toString() : null,
            packUnitId: material.packUnitId,
            isVariableWeight: material.isVariableWeight,
          },
          true,
        );

        const fromUnit = input.unitId ?? material.stockUnitId;
        const convRes = convert(input.quantity, fromUnit, material.stockUnitId, unitCtx);
        if (!convRes.ok) {
          throw new DomainError('UNIT_INCOMPATIBLE', `Incompatible unit: ${convRes.reason}`, 400);
        }
        const quantityInStockUnit = convRes.qty;

        const balances = await this.lockBalances(tx, ctx.projectId, input.storeId, [material.id]);
        const bal = balances.get(material.id)!;

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'RECEIPT', year, 1);
        const referenceNo = formatYearlyNumber('RCV', year, postingSeq);
        const txnSeq = await nextSequenceValue(tx, ctx.projectId, 'TRANSACTION', year, 1);
        const txnNo = formatYearlyNumber('TXN', year, txnSeq);

        // Warning check: reference reused (DECISIONS Q33)
        const warnings: PostingWarning[] = [];
        if (input.externalRef) {
          const reused = await tx.posting.findFirst({
            where: { projectId: ctx.projectId, externalRef: input.externalRef },
          });
          if (reused) {
            warnings.push({
              code: 'REFERENCE_REUSED',
              message: `Reference number ${input.externalRef} was already used on posting ${reused.referenceNo}.`,
            });
          }
        }

        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            type: 'RECEIPT_QUICK',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            supplierName: input.supplierName,
            externalRef: input.externalRef,
            createdMaterialId,
            notes: input.notes,
            warnings:
              warnings.length > 0 ? (warnings as unknown as Prisma.InputJsonValue) : undefined,
            createdById: ctx.userId,
          },
        });

        bal.availableQty = bal.availableQty.plus(quantityInStockUnit);

        await tx.materialTransaction.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            materialId: material.id,
            postingId: posting.id,
            lineNo: 1,
            txnNo,
            type: 'MATERIAL_IN',
            bucket: 'AVAILABLE',
            quantity: quantityInStockUnit.toString(),
            unitId: material.stockUnitId,
            balanceAfter: bal.availableQty.toString(),
            enteredQty: input.unitId ? input.quantity : null,
            enteredUnitId: input.unitId ?? null,
            createdById: ctx.userId,
          },
        });

        await tx.stockBalance.updateMany({
          where: { projectId: ctx.projectId, storeId: input.storeId, materialId: material.id },
          data: {
            availableQty: bal.availableQty.toString(),
            version: { increment: 1 },
          },
        });

        await this.audit.write(tx, ctx, {
          action: 'posting.quick_receive',
          entityType: 'posting',
          entityId: posting.id,
          after: { referenceNo, materialId: material.id, quantity: quantityInStockUnit.toString() },
        });

        return this.getPosting(ctx, posting.id, tx);
      }),
    );
  }

  /** Material Out: issue stock to location/contractor */
  async postIssue(
    ctx: RequestContext,
    input: IssueInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    assertStoreAccess(ctx, input.storeId);
    const hash = hashPayload(input);

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        await this.validateStore(tx, ctx.projectId, input.storeId);

        // Validate destination location
        const location = await tx.location.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
        });
        if (!location) throw notFound('Location');
        if (!location.isActive) throw conflict('Location is inactive.');

        if (input.contractorId) {
          const contractor = await tx.contractor.findFirst({
            where: { id: input.contractorId, projectId: ctx.projectId },
          });
          if (!contractor) throw notFound('Contractor');
        }

        interface PreparedIssueLine {
          material: Material;
          qtyInStockUnit: Decimal;
          enteredQty: string;
          enteredUnitId: string | null;
        }

        const prepared: PreparedIssueLine[] = [];
        const materialIds = new Set<string>();

        for (const line of input.lines) {
          materialIds.add(line.materialId);
          const material = await tx.material.findFirst({
            where: { id: line.materialId, projectId: ctx.projectId },
          });
          if (!material) throw notFound(`Material ${line.materialId}`);
          if (material.status !== 'ACTIVE') {
            throw new DomainError(
              'MATERIAL_INACTIVE',
              `Material ${material.name} is inactive.`,
              409,
            );
          }

          // Q10: allowMaterialSpecific is FALSE for issue
          const unitCtx = await this.buildConversionContext(
            tx,
            ctx.projectId,
            {
              id: material.id,
              stockUnitId: material.stockUnitId,
              packSize: material.packSize ? material.packSize.toString() : null,
              packUnitId: material.packUnitId,
              isVariableWeight: material.isVariableWeight,
            },
            false,
          );

          const fromUnit = line.unitId ?? material.stockUnitId;
          const convRes = convert(line.quantity, fromUnit, material.stockUnitId, unitCtx);
          if (!convRes.ok) {
            throw new DomainError(
              'UNIT_INCOMPATIBLE',
              `Incompatible unit for ${material.name}: ${convRes.reason}`,
              400,
            );
          }

          prepared.push({
            material,
            qtyInStockUnit: convRes.qty,
            enteredQty: line.quantity,
            enteredUnitId: line.unitId ?? null,
          });
        }

        // Lock balances
        const balances = await this.lockBalances(tx, ctx.projectId, input.storeId, [
          ...materialIds,
        ]);

        // Verify sufficient stock for all lines
        const projected = new Map<string, Decimal>();
        for (const [id, bal] of balances.entries()) {
          projected.set(id, bal.availableQty);
        }

        for (const line of prepared) {
          const current = projected.get(line.material.id)!;
          const next = current.minus(line.qtyInStockUnit);
          if (next.lt(0)) {
            throw new DomainError(
              'INSUFFICIENT_STOCK',
              `Insufficient stock for ${line.material.name}.`,
              409,
              {
                materialId: line.material.id,
                materialName: line.material.name,
                bucket: 'AVAILABLE',
                available: current.toString(),
                requested: line.qtyInStockUnit.toString(),
                unitCode: '',
              },
            );
          }
          projected.set(line.material.id, next);
        }

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'ISSUE', year, 1);
        const referenceNo = formatYearlyNumber('ISS', year, postingSeq);
        const txnSeqStart = await nextSequenceValue(
          tx,
          ctx.projectId,
          'TRANSACTION',
          year,
          prepared.length,
        );

        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            type: 'ISSUE',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            notes: input.notes,
            createdById: ctx.userId,
          },
        });

        let lineNo = 1;
        for (let i = 0; i < prepared.length; i++) {
          const pl = prepared[i]!;
          const bal = balances.get(pl.material.id)!;
          bal.availableQty = bal.availableQty.minus(pl.qtyInStockUnit);
          const txnNo = formatYearlyNumber('TXN', year, txnSeqStart + BigInt(i));

          await tx.materialTransaction.create({
            data: {
              projectId: ctx.projectId,
              storeId: input.storeId,
              materialId: pl.material.id,
              postingId: posting.id,
              lineNo: lineNo++,
              txnNo,
              type: 'MATERIAL_OUT',
              bucket: 'AVAILABLE',
              quantity: pl.qtyInStockUnit.negated().toString(), // Negative quantity
              unitId: pl.material.stockUnitId,
              balanceAfter: bal.availableQty.toString(),
              enteredQty: pl.enteredUnitId ? pl.enteredQty : null,
              enteredUnitId: pl.enteredUnitId,
              locationId: input.locationId,
              contractorId: input.contractorId ?? null,
              createdById: ctx.userId,
            },
          });
        }

        for (const [matId, bal] of balances.entries()) {
          await tx.stockBalance.updateMany({
            where: { projectId: ctx.projectId, storeId: input.storeId, materialId: matId },
            data: {
              availableQty: bal.availableQty.toString(),
              version: { increment: 1 },
            },
          });
        }

        await this.audit.write(tx, ctx, {
          action: 'posting.issue',
          entityType: 'posting',
          entityId: posting.id,
          after: { referenceNo, locationId: input.locationId, linesCount: prepared.length },
        });

        return this.getPosting(ctx, posting.id, tx);
      }),
    );
  }

  /** Material Return: return stock from location */
  async postReturn(
    ctx: RequestContext,
    input: ReturnInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    assertStoreAccess(ctx, input.storeId);
    const hash = hashPayload(input);

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        await this.validateStore(tx, ctx.projectId, input.storeId);

        const location = await tx.location.findFirst({
          where: { id: input.locationId, projectId: ctx.projectId },
        });
        if (!location) throw notFound('Location');

        interface PreparedReturnLine {
          material: Material;
          qtyInStockUnit: Decimal;
          condition: 'GOOD' | 'DAMAGED' | 'SCRAP';
          bucket: 'AVAILABLE' | 'DAMAGED' | 'SCRAP';
          enteredQty: string;
          enteredUnitId: string | null;
        }

        const prepared: PreparedReturnLine[] = [];
        const materialIds = new Set<string>();

        for (const line of input.lines) {
          materialIds.add(line.materialId);
          const material = await tx.material.findFirst({
            where: { id: line.materialId, projectId: ctx.projectId },
          });
          if (!material) throw notFound(`Material ${line.materialId}`);
          if (material.status !== 'ACTIVE') {
            throw new DomainError(
              'MATERIAL_INACTIVE',
              `Material ${material.name} is inactive.`,
              409,
            );
          }

          const unitCtx = await this.buildConversionContext(
            tx,
            ctx.projectId,
            {
              id: material.id,
              stockUnitId: material.stockUnitId,
              packSize: material.packSize ? material.packSize.toString() : null,
              packUnitId: material.packUnitId,
              isVariableWeight: material.isVariableWeight,
            },
            false,
          );

          const fromUnit = line.unitId ?? material.stockUnitId;
          const convRes = convert(line.quantity, fromUnit, material.stockUnitId, unitCtx);
          if (!convRes.ok) {
            throw new DomainError('UNIT_INCOMPATIBLE', `Incompatible unit: ${convRes.reason}`, 400);
          }

          const bucket = line.condition === 'GOOD' ? 'AVAILABLE' : line.condition;
          prepared.push({
            material,
            qtyInStockUnit: convRes.qty,
            condition: line.condition,
            bucket,
            enteredQty: line.quantity,
            enteredUnitId: line.unitId ?? null,
          });
        }

        const balances = await this.lockBalances(tx, ctx.projectId, input.storeId, [
          ...materialIds,
        ]);

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'RETURN', year, 1);
        const referenceNo = formatYearlyNumber('RET', year, postingSeq);
        const txnSeqStart = await nextSequenceValue(
          tx,
          ctx.projectId,
          'TRANSACTION',
          year,
          prepared.length,
        );

        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            type: 'RETURN',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            notes: input.notes,
            createdById: ctx.userId,
          },
        });

        let lineNo = 1;
        for (let i = 0; i < prepared.length; i++) {
          const pl = prepared[i]!;
          const bal = balances.get(pl.material.id)!;

          if (pl.bucket === 'AVAILABLE') {
            bal.availableQty = bal.availableQty.plus(pl.qtyInStockUnit);
          } else if (pl.bucket === 'DAMAGED') {
            bal.damagedQty = bal.damagedQty.plus(pl.qtyInStockUnit);
          } else {
            bal.scrapQty = bal.scrapQty.plus(pl.qtyInStockUnit);
          }

          const currentBucketBal =
            pl.bucket === 'AVAILABLE'
              ? bal.availableQty
              : pl.bucket === 'DAMAGED'
                ? bal.damagedQty
                : bal.scrapQty;

          const txnNo = formatYearlyNumber('TXN', year, txnSeqStart + BigInt(i));

          await tx.materialTransaction.create({
            data: {
              projectId: ctx.projectId,
              storeId: input.storeId,
              materialId: pl.material.id,
              postingId: posting.id,
              lineNo: lineNo++,
              txnNo,
              type: 'MATERIAL_RETURN',
              bucket: pl.bucket,
              quantity: pl.qtyInStockUnit.toString(), // Positive
              unitId: pl.material.stockUnitId,
              balanceAfter: currentBucketBal.toString(),
              enteredQty: pl.enteredUnitId ? pl.enteredQty : null,
              enteredUnitId: pl.enteredUnitId,
              locationId: input.locationId,
              contractorId: input.contractorId ?? null,
              returnCondition: pl.condition,
              createdById: ctx.userId,
            },
          });
        }

        for (const [matId, bal] of balances.entries()) {
          await tx.stockBalance.updateMany({
            where: { projectId: ctx.projectId, storeId: input.storeId, materialId: matId },
            data: {
              availableQty: bal.availableQty.toString(),
              damagedQty: bal.damagedQty.toString(),
              scrapQty: bal.scrapQty.toString(),
              version: { increment: 1 },
            },
          });
        }

        await this.audit.write(tx, ctx, {
          action: 'posting.return',
          entityType: 'posting',
          entityId: posting.id,
          after: { referenceNo, locationId: input.locationId, linesCount: prepared.length },
        });

        return this.getPosting(ctx, posting.id, tx);
      }),
    );
  }

  /** Direct stock adjustment (Admin only) */
  async postAdjustment(
    ctx: RequestContext,
    input: AdjustmentInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    const hash = hashPayload(input);

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        await this.validateStore(tx, ctx.projectId, input.storeId);

        const material = await tx.material.findFirst({
          where: { id: input.materialId, projectId: ctx.projectId },
        });
        if (!material) throw notFound('Material');

        const balances = await this.lockBalances(tx, ctx.projectId, input.storeId, [material.id]);
        const bal = balances.get(material.id)!;

        const delta = new Decimal(input.quantity);
        if (delta.equals(0)) throw invalid('Adjustment quantity must not be zero.');

        // Check balance does not drop below zero
        let newBalance: Decimal;
        if (input.bucket === 'AVAILABLE') {
          newBalance = bal.availableQty.plus(delta);
          if (newBalance.lt(0)) {
            throw new DomainError(
              'INSUFFICIENT_STOCK',
              'Adjustment would make available stock negative.',
              409,
            );
          }
          bal.availableQty = newBalance;
        } else if (input.bucket === 'DAMAGED') {
          newBalance = bal.damagedQty.plus(delta);
          if (newBalance.lt(0)) {
            throw new DomainError(
              'INSUFFICIENT_STOCK',
              'Adjustment would make damaged stock negative.',
              409,
            );
          }
          bal.damagedQty = newBalance;
        } else {
          newBalance = bal.scrapQty.plus(delta);
          if (newBalance.lt(0)) {
            throw new DomainError(
              'INSUFFICIENT_STOCK',
              'Adjustment would make scrap stock negative.',
              409,
            );
          }
          bal.scrapQty = newBalance;
        }

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'ADJUSTMENT', year, 1);
        const referenceNo = formatYearlyNumber('ADJ', year, postingSeq);
        const txnSeq = await nextSequenceValue(tx, ctx.projectId, 'TRANSACTION', year, 1);
        const txnNo = formatYearlyNumber('TXN', year, txnSeq);

        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            type: 'ADJUSTMENT',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            notes: input.reason,
            createdById: ctx.userId,
          },
        });

        await tx.materialTransaction.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            materialId: material.id,
            postingId: posting.id,
            lineNo: 1,
            txnNo,
            type: 'STOCK_ADJUSTMENT',
            bucket: input.bucket,
            quantity: delta.toString(),
            unitId: material.stockUnitId,
            balanceAfter: newBalance.toString(),
            notes: input.reason,
            createdById: ctx.userId,
          },
        });

        await tx.stockAdjustment.create({
          data: {
            projectId: ctx.projectId,
            storeId: input.storeId,
            materialId: material.id,
            kind: input.kind,
            bucket: input.bucket,
            quantityDelta: delta.toString(),
            reason: input.reason,
            postingId: posting.id,
            approvedById: ctx.userId,
          },
        });

        await tx.stockBalance.updateMany({
          where: { projectId: ctx.projectId, storeId: input.storeId, materialId: material.id },
          data: {
            availableQty: bal.availableQty.toString(),
            damagedQty: bal.damagedQty.toString(),
            scrapQty: bal.scrapQty.toString(),
            version: { increment: 1 },
          },
        });

        await this.audit.write(tx, ctx, {
          action: 'posting.adjustment',
          entityType: 'posting',
          entityId: posting.id,
          after: { referenceNo, kind: input.kind, delta: delta.toString() },
        });

        return this.getPosting(ctx, posting.id, tx);
      }),
    );
  }

  /** Reverse an entire posting (Admin only) */
  async reversePosting(
    ctx: RequestContext,
    postingId: string,
    input: ReverseInput,
    idempotencyKey: string,
  ): Promise<PostingDto> {
    const hash = hashPayload({ postingId, ...input });

    return this.executeWithIdempotency(ctx, idempotencyKey, hash, () =>
      this.prisma.db.$transaction(async (tx) => {
        const existing = await this.findIdempotentPosting(tx, ctx.projectId, idempotencyKey, hash);
        if (existing) return existing;

        const original = await tx.posting.findFirst({
          where: { id: postingId, projectId: ctx.projectId },
          include: {
            transactions: true,
            reversedBy: true,
          },
        });

        if (!original) throw notFound('Posting');
        if (original.type === 'REVERSAL') {
          throw new DomainError('NOT_REVERSIBLE', 'Cannot reverse a reversal posting.', 409);
        }
        if (original.reversedBy) {
          throw new DomainError('ALREADY_REVERSED', 'This posting was already reversed.', 409);
        }

        // Check if already reversed in DB
        const priorReversal = await tx.posting.findFirst({
          where: { reversesPostingId: original.id, projectId: ctx.projectId },
        });
        if (priorReversal) {
          throw new DomainError('ALREADY_REVERSED', 'This posting was already reversed.', 409);
        }

        const materialIds = [...new Set(original.transactions.map((t) => t.materialId))];
        const balances = await this.lockBalances(tx, ctx.projectId, original.storeId, materialIds);

        // Check that reversing won't drive any bucket negative
        for (const t of original.transactions) {
          const bal = balances.get(t.materialId)!;
          const negated = new Decimal(t.quantity.toString()).negated();

          if (t.bucket === 'AVAILABLE') {
            const next = bal.availableQty.plus(negated);
            if (next.lt(0)) {
              throw new DomainError(
                'INSUFFICIENT_STOCK',
                'Reversal would drive available stock negative.',
                409,
              );
            }
            bal.availableQty = next;
          } else if (t.bucket === 'DAMAGED') {
            const next = bal.damagedQty.plus(negated);
            if (next.lt(0)) {
              throw new DomainError(
                'INSUFFICIENT_STOCK',
                'Reversal would drive damaged stock negative.',
                409,
              );
            }
            bal.damagedQty = next;
          } else {
            const next = bal.scrapQty.plus(negated);
            if (next.lt(0)) {
              throw new DomainError(
                'INSUFFICIENT_STOCK',
                'Reversal would drive scrap stock negative.',
                409,
              );
            }
            bal.scrapQty = next;
          }
        }

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'REVERSAL', year, 1);
        const referenceNo = formatYearlyNumber('REV', year, postingSeq);
        const txnSeqStart = await nextSequenceValue(
          tx,
          ctx.projectId,
          'TRANSACTION',
          year,
          original.transactions.length,
        );

        const reversalPosting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: original.storeId,
            type: 'REVERSAL',
            referenceNo,
            idempotencyKey,
            requestHash: hash,
            reversesPostingId: original.id,
            notes: input.reason,
            createdById: ctx.userId,
          },
        });

        let lineNo = 1;
        for (let i = 0; i < original.transactions.length; i++) {
          const origTxn = original.transactions[i]!;
          const bal = balances.get(origTxn.materialId)!;
          const negated = new Decimal(origTxn.quantity.toString()).negated();
          const txnNo = formatYearlyNumber('TXN', year, txnSeqStart + BigInt(i));

          const currentBucketBal =
            origTxn.bucket === 'AVAILABLE'
              ? bal.availableQty
              : origTxn.bucket === 'DAMAGED'
                ? bal.damagedQty
                : bal.scrapQty;

          await tx.materialTransaction.create({
            data: {
              projectId: ctx.projectId,
              storeId: original.storeId,
              materialId: origTxn.materialId,
              postingId: reversalPosting.id,
              lineNo: lineNo++,
              txnNo,
              type: 'REVERSAL',
              bucket: origTxn.bucket,
              quantity: negated.toString(),
              unitId: origTxn.unitId,
              balanceAfter: currentBucketBal.toString(),
              reversesTransactionId: origTxn.id,
              locationId: origTxn.locationId,
              contractorId: origTxn.contractorId,
              notes: input.reason,
              createdById: ctx.userId,
            },
          });
        }

        for (const [matId, bal] of balances.entries()) {
          await tx.stockBalance.updateMany({
            where: { projectId: ctx.projectId, storeId: original.storeId, materialId: matId },
            data: {
              availableQty: bal.availableQty.toString(),
              damagedQty: bal.damagedQty.toString(),
              scrapQty: bal.scrapQty.toString(),
              version: { increment: 1 },
            },
          });
        }

        // DECISIONS Q15: reversing an invoice receipt frees the invoice to be received again. Its
        // duplicate keys are cleared in the same transaction, so a new upload is not blocked.
        if (original.invoiceId) {
          await tx.invoice.updateMany({
            where: { projectId: ctx.projectId, id: original.invoiceId, status: 'POSTED' },
            data: {
              status: 'REVERSED',
              dupHeaderKey: null,
              dupFingerprintKey: null,
              dupChallanKey: null,
              version: { increment: 1 },
            },
          });
        }

        await this.audit.write(tx, ctx, {
          action: 'posting.reverse',
          entityType: 'posting',
          entityId: reversalPosting.id,
          after: { referenceNo, reversedPostingId: original.id, reason: input.reason },
        });

        return this.getPosting(ctx, reversalPosting.id, tx);
      }),
    );
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  async findIdempotentPosting(
    tx: Db,
    projectId: string,
    idempotencyKey: string,
    currentHash: string,
  ): Promise<PostingDto | null> {
    const existing = await tx.posting.findUnique({
      where: { projectId_idempotencyKey: { projectId, idempotencyKey } },
      include: {
        store: true,
        createdBy: true,
        reversedBy: true,
        reverses: true,
        transactions: {
          include: {
            material: true,
            store: true,
            unit: true,
            enteredUnit: true,
            location: true,
            contractor: true,
            createdBy: true,
            posting: true,
            reversedBy: true,
            reverses: true,
          },
          orderBy: { lineNo: 'asc' },
        },
      },
    });

    if (!existing) return null;

    if (existing.requestHash === currentHash) {
      return this.toPostingDto(existing as PostingWithDetails);
    }

    throw new DomainError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency-Key reused with different request payload.',
      422,
    );
  }

  async validateStore(tx: Db, projectId: string, storeId: string): Promise<Store> {
    const store = await tx.store.findFirst({
      where: { id: storeId, projectId },
    });
    if (!store) throw notFound('Store');
    if (!store.isActive) throw conflict('Store is inactive.');
    return store;
  }

  async lockBalances(
    tx: Db,
    projectId: string,
    storeId: string,
    materialIds: string[],
  ): Promise<Map<string, { availableQty: Decimal; damagedQty: Decimal; scrapQty: Decimal }>> {
    const sortedIds = [...new Set(materialIds)].sort();

    // Ensure rows exist
    for (const mId of sortedIds) {
      await tx.$executeRawUnsafe(`
        INSERT INTO stock_balances (project_id, store_id, material_id, available_qty, damaged_qty, scrap_qty, version)
        VALUES ('${projectId}'::uuid, '${storeId}'::uuid, '${mId}'::uuid, 0, 0, 0, 0)
        ON CONFLICT (store_id, material_id) DO NOTHING
      `);
    }

    // Lock in deterministic order
    const lockedRows = await tx.$queryRaw<
      {
        material_id: string;
        available_qty: Decimal | string;
        damaged_qty: Decimal | string;
        scrap_qty: Decimal | string;
      }[]
    >`
      SELECT material_id, available_qty, damaged_qty, scrap_qty
      FROM stock_balances
      WHERE store_id = ${storeId}::uuid AND material_id = ANY(${sortedIds}::uuid[])
      ORDER BY material_id FOR UPDATE
    `;

    const map = new Map<
      string,
      { availableQty: Decimal; damagedQty: Decimal; scrapQty: Decimal }
    >();
    for (const r of lockedRows) {
      map.set(r.material_id, {
        availableQty: new Decimal(r.available_qty.toString()),
        damagedQty: new Decimal(r.damaged_qty.toString()),
        scrapQty: new Decimal(r.scrap_qty.toString()),
      });
    }

    return map;
  }
}
