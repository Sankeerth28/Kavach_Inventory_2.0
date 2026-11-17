import { Injectable } from '@nestjs/common';
import { Prisma } from '@kavach/db';
import type {
  Paginated,
  PostingType,
  ReturnCondition,
  StockBucket,
  TransactionDto,
  TransactionListQuery,
  TxnType,
} from '@kavach/shared';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext, query: TransactionListQuery): Promise<Paginated<TransactionDto>> {
    if (query.storeId) {
      assertStoreAccess(ctx, query.storeId);
    }

    const where: Prisma.MaterialTransactionWhereInput = {
      projectId: ctx.projectId,
      ...(query.storeId
        ? { storeId: query.storeId }
        : ctx.storeIds === 'ALL'
          ? {}
          : { storeId: { in: [...ctx.storeIds] } }),
      ...(query.materialId ? { materialId: query.materialId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { txnNo: { contains: query.q, mode: 'insensitive' } },
              { posting: { referenceNo: { contains: query.q, mode: 'insensitive' } } },
              { material: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const total = await this.prisma.db.materialTransaction.count({ where });

    const rows = await this.prisma.db.materialTransaction.findMany({
      where,
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
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { createdAt: 'desc' },
    });

    const items: TransactionDto[] = rows.map((t) => ({
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
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
