import { Injectable } from '@nestjs/common';
import { Prisma } from '@kavach/db';
import {
  type MovementTotals,
  type Paginated,
  type PostingType,
  type ReconciliationDto,
  type ReturnCondition,
  type StockBucket,
  type StockDetailDto,
  type StockListQuery,
  type StockRowDto,
  type StockStatus,
  type TransactionDto,
  type TxnType,
  Decimal,
} from '@kavach/shared';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { notFound } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, query: StockListQuery): Promise<Paginated<StockRowDto>> {
    if (query.storeId) {
      assertStoreAccess(ctx, query.storeId);
    }

    const visibleStoreIds =
      ctx.storeIds === 'ALL' ? undefined : query.storeId ? [query.storeId] : [...ctx.storeIds];

    const where: Prisma.MaterialWhereInput = {
      projectId: ctx.projectId,
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { code: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.db.material.count({ where });

    const materials = await this.prisma.db.material.findMany({
      where,
      include: {
        category: true,
        stockUnit: true,
        balances: {
          where: {
            projectId: ctx.projectId,
            ...(query.storeId ? { storeId: query.storeId } : {}),
          },
        },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { name: 'asc' },
    });

    // Also get all balances across all stores to compute projectAvailableQty
    const allBalances = await this.prisma.db.stockBalance.findMany({
      where: {
        projectId: ctx.projectId,
        materialId: { in: materials.map((m) => m.id) },
      },
    });

    const projectAvailMap = new Map<string, Decimal>();
    for (const b of allBalances) {
      const prev = projectAvailMap.get(b.materialId) ?? new Decimal(0);
      projectAvailMap.set(b.materialId, prev.plus(b.availableQty.toString()));
    }

    const items: StockRowDto[] = materials.map((m) => {
      // Sum balances according to query
      const visibleBalances = m.balances.filter(
        (b) => !visibleStoreIds || visibleStoreIds.includes(b.storeId),
      );

      let available = new Decimal(0);
      let damaged = new Decimal(0);
      let scrap = new Decimal(0);

      for (const b of visibleBalances) {
        available = available.plus(b.availableQty.toString());
        damaged = damaged.plus(b.damagedQty.toString());
        scrap = scrap.plus(b.scrapQty.toString());
      }

      const projectAvail = projectAvailMap.get(m.id) ?? new Decimal(0);

      let status: StockStatus = 'AVAILABLE';
      if (m.status === 'INACTIVE') {
        status = 'INACTIVE';
      } else if (projectAvail.lte(0)) {
        status = 'OUT';
      } else if (m.minimumStock && projectAvail.lte(m.minimumStock.toString())) {
        status = 'LOW';
      }

      return {
        materialId: m.id,
        materialCode: m.code,
        materialName: m.name,
        categoryName: m.category.name,
        brand: m.brand,
        grade: m.grade,
        size: m.size,
        unitCode: m.stockUnit.code,
        unitDecimalPlaces: m.stockUnit.decimalPlaces,
        availableQty: available.toString(),
        damagedQty: damaged.toString(),
        scrapQty: scrap.toString(),
        projectAvailableQty: projectAvail.toString(),
        minimumStock: m.minimumStock ? m.minimumStock.toString() : null,
        status,
      };
    });

    return {
      items: query.status ? items.filter((i) => i.status === query.status) : items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(ctx: RequestContext, materialId: string): Promise<StockDetailDto> {
    const material = await this.prisma.db.material.findFirst({
      where: { id: materialId, projectId: ctx.projectId },
      include: {
        category: true,
        stockUnit: true,
        balances: {
          where: { projectId: ctx.projectId },
          include: { store: true },
        },
      },
    });

    if (!material) throw notFound('Material');

    // Filter stores according to permissions
    const visibleBalances = material.balances.filter(
      (b) => ctx.storeIds === 'ALL' || ctx.storeIds.includes(b.storeId),
    );

    let totalAvailable = new Decimal(0);
    let totalDamaged = new Decimal(0);
    let totalScrap = new Decimal(0);

    const storeRows = visibleBalances.map((b) => {
      totalAvailable = totalAvailable.plus(b.availableQty.toString());
      totalDamaged = totalDamaged.plus(b.damagedQty.toString());
      totalScrap = totalScrap.plus(b.scrapQty.toString());

      return {
        storeId: b.storeId,
        storeName: b.store.name,
        availableQty: b.availableQty.toString(),
        damagedQty: b.damagedQty.toString(),
        scrapQty: b.scrapQty.toString(),
      };
    });

    // Project-wide total
    let projectAvailable = new Decimal(0);
    for (const b of material.balances) {
      projectAvailable = projectAvailable.plus(b.availableQty.toString());
    }

    let status: StockStatus = 'AVAILABLE';
    if (material.status === 'INACTIVE') {
      status = 'INACTIVE';
    } else if (projectAvailable.lte(0)) {
      status = 'OUT';
    } else if (material.minimumStock && projectAvailable.lte(material.minimumStock.toString())) {
      status = 'LOW';
    }

    // Transactions and §19.1 Movement Totals
    const txns = await this.prisma.db.materialTransaction.findMany({
      where: {
        projectId: ctx.projectId,
        materialId,
        ...(ctx.storeIds === 'ALL' ? {} : { storeId: { in: [...ctx.storeIds] } }),
      },
      include: {
        material: true,
        store: true,
        unit: true,
        enteredUnit: true,
        location: true,
        contractor: true,
        createdBy: true,
        posting: true,
        reverses: true,
        reversedBy: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const hasTransactions = txns.length > 0;

    // Movement totals: AVAILABLE stock only, reversals netted into the type they reverse
    let received = new Decimal(0);
    let issued = new Decimal(0);
    let reusableReturns = new Decimal(0);
    let adjustments = new Decimal(0);

    // Build map of original transactions to identify reversals
    const txnsById = new Map<string, (typeof txns)[0]>(txns.map((t) => [t.id, t]));

    for (const t of txns) {
      if (t.bucket !== 'AVAILABLE') continue;

      let effectiveType = t.type;
      const qty = new Decimal(t.quantity.toString());

      if (t.type === 'REVERSAL' && t.reversesTransactionId) {
        const orig = txnsById.get(t.reversesTransactionId);
        if (orig) {
          effectiveType = orig.type;
        }
      }

      if (effectiveType === 'MATERIAL_IN') {
        received = received.plus(qty);
      } else if (effectiveType === 'MATERIAL_OUT') {
        // Material out is negative quantity, so issued is positive sum of abs(qty)
        issued = issued.minus(qty);
      } else if (effectiveType === 'MATERIAL_RETURN') {
        // Reusable returns only
        if (t.returnCondition === 'GOOD' || (t.reverses && t.reverses.returnCondition === 'GOOD')) {
          reusableReturns = reusableReturns.plus(qty);
        }
      } else if (effectiveType === 'STOCK_ADJUSTMENT') {
        adjustments = adjustments.plus(qty);
      }
    }

    const totals: MovementTotals = {
      received: received.toString(),
      issued: issued.toString(),
      reusableReturns: reusableReturns.toString(),
      adjustments: adjustments.toString(),
    };

    const recent: TransactionDto[] = txns.slice(0, 10).map((t) => ({
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
    }));

    return {
      materialId: material.id,
      materialCode: material.code,
      materialName: material.name,
      categoryName: material.category.name,
      brand: material.brand,
      grade: material.grade,
      size: material.size,
      unitCode: material.stockUnit.code,
      unitDecimalPlaces: material.stockUnit.decimalPlaces,
      availableQty: totalAvailable.toString(),
      damagedQty: totalDamaged.toString(),
      scrapQty: totalScrap.toString(),
      projectAvailableQty: projectAvailable.toString(),
      minimumStock: material.minimumStock ? material.minimumStock.toString() : null,
      status,
      stores: storeRows,
      totals,
      recent,
      hasTransactions,
    };
  }

  /**
   * Every balance must equal the sum of its ledger rows (CLAUDE.md invariants 1 and 2).
   * One grouped query over the ledger, so the check stays usable as the ledger grows.
   */
  async reconcile(ctx: RequestContext): Promise<ReconciliationDto> {
    const [balances, sums] = await Promise.all([
      this.prisma.db.stockBalance.findMany({ where: { projectId: ctx.projectId } }),
      this.prisma.db.materialTransaction.groupBy({
        by: ['storeId', 'materialId', 'bucket'],
        where: { projectId: ctx.projectId },
        _sum: { quantity: true },
      }),
    ]);
    const ledger = new Map<string, Decimal>();
    for (const g of sums) {
      ledger.set(
        `${g.storeId}:${g.materialId}:${g.bucket}`,
        new Decimal((g._sum.quantity ?? 0).toString()),
      );
    }

    const mismatches: ReconciliationDto['mismatches'] = [];
    const seen = new Set<string>();
    for (const b of balances) {
      const held = { AVAILABLE: b.availableQty, DAMAGED: b.damagedQty, SCRAP: b.scrapQty } as const;
      for (const bucket of ['AVAILABLE', 'DAMAGED', 'SCRAP'] as const) {
        const key = `${b.storeId}:${b.materialId}:${bucket}`;
        seen.add(key);
        const ledgerSum = ledger.get(key) ?? new Decimal(0);
        if (!ledgerSum.equals(held[bucket].toString())) {
          mismatches.push({
            storeId: b.storeId,
            materialId: b.materialId,
            bucket,
            balance: held[bucket].toString(),
            ledgerSum: ledgerSum.toString(),
          });
        }
      }
    }
    // Ledger rows with no balance row at all would also be a broken projection.
    for (const [key, ledgerSum] of ledger) {
      if (seen.has(key) || ledgerSum.isZero()) continue;
      const [storeId, materialId, bucket] = key.split(':') as [string, string, StockBucket];
      mismatches.push({
        storeId,
        materialId,
        bucket,
        balance: '0',
        ledgerSum: ledgerSum.toString(),
      });
    }

    return { checkedBalances: balances.length * 3, mismatches };
  }
}
