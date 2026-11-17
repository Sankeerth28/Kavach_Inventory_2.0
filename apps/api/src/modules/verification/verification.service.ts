import { Injectable } from '@nestjs/common';
import { Prisma, type StockVerification, formatYearlyNumber, nextSequenceValue } from '@kavach/db';
import {
  type Paginated,
  type RejectVerificationInput,
  type ReviewVerificationInput,
  type SubmitVerificationInput,
  type VerificationDto,
  type VerificationListQuery,
  Decimal,
} from '@kavach/shared';
import { AuditService } from '../../common/audit/audit.service';
import { type RequestContext, assertStoreAccess } from '../../common/context/request-context';
import { conflict, notFound } from '../../common/errors/domain-error';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

type VerificationWithRelations = StockVerification & {
  store: { name: string };
  material: { code: string; name: string; stockUnit: { code: string } };
  submittedBy: { name: string };
  reviewedBy?: { name: string } | null;
  adjustment?: { posting?: { referenceNo: string } | null } | null;
};

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toDto(v: VerificationWithRelations, currentQty: string): VerificationDto {
    return {
      id: v.id,
      storeId: v.storeId,
      storeName: v.store.name,
      materialId: v.materialId,
      materialCode: v.material.code,
      materialName: v.material.name,
      unitCode: v.material.stockUnit.code,
      systemQty: v.systemQty.toString(),
      physicalQty: v.physicalQty.toString(),
      differenceQty: v.differenceQty.toString(),
      reason: v.reason,
      status: v.status,
      submittedByName: v.submittedBy.name,
      submittedAt: v.submittedAt.toISOString(),
      reviewedByName: v.reviewedBy ? v.reviewedBy.name : null,
      reviewedAt: v.reviewedAt ? v.reviewedAt.toISOString() : null,
      reviewNote: v.reviewNote,
      currentQty,
      movedSinceCount: !new Decimal(currentQty).equals(v.systemQty.toString()),
      adjustmentReferenceNo: v.adjustment?.posting?.referenceNo ?? null,
    };
  }

  async list(
    ctx: RequestContext,
    query: VerificationListQuery,
  ): Promise<Paginated<VerificationDto>> {
    if (query.storeId) {
      assertStoreAccess(ctx, query.storeId);
    }

    const where: Prisma.StockVerificationWhereInput = {
      projectId: ctx.projectId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.storeId
        ? { storeId: query.storeId }
        : ctx.storeIds === 'ALL'
          ? {}
          : { storeId: { in: [...ctx.storeIds] } }),
    };

    const total = await this.prisma.db.stockVerification.count({ where });

    const rows = await this.prisma.db.stockVerification.findMany({
      where,
      include: {
        store: true,
        material: { include: { stockUnit: true } },
        submittedBy: true,
        reviewedBy: true,
        adjustment: { include: { posting: true } },
      },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: { submittedAt: 'desc' },
    });

    const balances = await this.prisma.db.stockBalance.findMany({
      where: {
        projectId: ctx.projectId,
        materialId: { in: rows.map((r) => r.materialId) },
        storeId: { in: rows.map((r) => r.storeId) },
      },
    });

    const balMap = new Map<string, string>();
    for (const b of balances) {
      balMap.set(`${b.storeId}:${b.materialId}`, b.availableQty.toString());
    }

    return {
      items: rows.map((r) => this.toDto(r, balMap.get(`${r.storeId}:${r.materialId}`) ?? '0')),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async submit(ctx: RequestContext, input: SubmitVerificationInput): Promise<VerificationDto> {
    assertStoreAccess(ctx, input.storeId);

    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, projectId: ctx.projectId },
    });
    if (!store) throw notFound('Store');
    if (!store.isActive) throw conflict('Store is inactive.');

    const material = await this.prisma.db.material.findFirst({
      where: { id: input.materialId, projectId: ctx.projectId },
      include: { stockUnit: true },
    });
    if (!material) throw notFound('Material');
    if (material.status !== 'ACTIVE') throw conflict('Material is inactive.');

    return this.prisma.db.$transaction(async (tx) => {
      // Q17: One open count per store/material/bucket
      const openKey = `${input.storeId}:${input.materialId}:AVAILABLE`;

      const existingOpen = await tx.stockVerification.findFirst({
        where: { projectId: ctx.projectId, openKey },
      });
      if (existingOpen) {
        throw new DomainError(
          'VERIFICATION_OPEN_EXISTS',
          'A physical count is already pending review for this material.',
          409,
        );
      }

      // Read current system quantity under lock
      await tx.$executeRawUnsafe(`
        INSERT INTO stock_balances (project_id, store_id, material_id, available_qty, damaged_qty, scrap_qty, version)
        VALUES ('${ctx.projectId}'::uuid, '${input.storeId}'::uuid, '${input.materialId}'::uuid, 0, 0, 0, 0)
        ON CONFLICT (store_id, material_id) DO NOTHING
      `);

      const [balance] = await tx.$queryRaw<
        { available_qty: Decimal | string; last_transaction_seq: bigint | string | null }[]
      >`
        SELECT available_qty, last_transaction_seq
        FROM stock_balances
        WHERE store_id = ${input.storeId}::uuid AND material_id = ${input.materialId}::uuid
        FOR UPDATE
      `;

      const systemQty = new Decimal(balance?.available_qty?.toString() ?? '0');
      const physicalQty = new Decimal(input.physicalQuantity);
      const differenceQty = physicalQty.minus(systemQty);

      const verification = await tx.stockVerification.create({
        data: {
          projectId: ctx.projectId,
          storeId: input.storeId,
          materialId: input.materialId,
          bucket: 'AVAILABLE',
          systemQty: systemQty.toString(),
          systemSeq: balance?.last_transaction_seq ? BigInt(balance.last_transaction_seq) : null,
          physicalQty: physicalQty.toString(),
          differenceQty: differenceQty.toString(),
          reason: input.reason,
          status: 'SUBMITTED',
          openKey,
          submittedById: ctx.userId,
        },
        include: {
          store: true,
          material: { include: { stockUnit: true } },
          submittedBy: true,
          reviewedBy: true,
          adjustment: { include: { posting: true } },
        },
      });

      await this.audit.write(tx, ctx, {
        action: 'verification.submit',
        entityType: 'stock_verification',
        entityId: verification.id,
        after: {
          physicalQty: physicalQty.toString(),
          systemQty: systemQty.toString(),
          difference: differenceQty.toString(),
        },
      });

      return this.toDto(verification, systemQty.toString());
    });
  }

  async approve(
    ctx: RequestContext,
    id: string,
    input: ReviewVerificationInput,
  ): Promise<VerificationDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const v = await tx.stockVerification.findFirst({
        where: { id, projectId: ctx.projectId },
        include: {
          store: true,
          material: { include: { stockUnit: true } },
          submittedBy: true,
        },
      });

      if (!v) throw notFound('Verification');
      if (v.status !== 'SUBMITTED') {
        throw new DomainError('VERIFICATION_NOT_OPEN', 'Verification is not pending review.', 409);
      }

      const diff = new Decimal(v.differenceQty.toString());

      let adjustmentPostingRef: string | null = null;

      if (!diff.equals(0)) {
        // Lock balance
        const [balRow] = await tx.$queryRaw<{ available_qty: Decimal | string }[]>`
          SELECT available_qty FROM stock_balances
          WHERE store_id = ${v.storeId}::uuid AND material_id = ${v.materialId}::uuid
          FOR UPDATE
        `;

        const currentAvailable = new Decimal(balRow?.available_qty?.toString() ?? '0');
        const newAvailable = currentAvailable.plus(diff);
        if (newAvailable.lt(0)) {
          throw new DomainError(
            'INSUFFICIENT_STOCK',
            'Approving this verification would make available stock negative.',
            409,
          );
        }

        const year = new Date().getFullYear();
        const postingSeq = await nextSequenceValue(tx, ctx.projectId, 'ADJUSTMENT', year, 1);
        const referenceNo = formatYearlyNumber('ADJ', year, postingSeq);
        const txnSeq = await nextSequenceValue(tx, ctx.projectId, 'TRANSACTION', year, 1);
        const txnNo = formatYearlyNumber('TXN', year, txnSeq);

        adjustmentPostingRef = referenceNo;

        const posting = await tx.posting.create({
          data: {
            projectId: ctx.projectId,
            storeId: v.storeId,
            type: 'ADJUSTMENT',
            referenceNo,
            idempotencyKey: `ver-appr-${v.id}`,
            requestHash: `ver-appr-${v.id}`,
            notes: input.note ? `${v.reason} — ${input.note}` : v.reason,
            createdById: ctx.userId,
          },
        });

        await tx.materialTransaction.create({
          data: {
            projectId: ctx.projectId,
            storeId: v.storeId,
            materialId: v.materialId,
            postingId: posting.id,
            lineNo: 1,
            txnNo,
            type: 'STOCK_ADJUSTMENT',
            bucket: v.bucket,
            quantity: diff.toString(),
            unitId: v.material.stockUnitId,
            balanceAfter: newAvailable.toString(),
            notes: input.note,
            createdById: ctx.userId,
          },
        });

        await tx.stockAdjustment.create({
          data: {
            projectId: ctx.projectId,
            storeId: v.storeId,
            materialId: v.materialId,
            kind: 'COUNT_CORRECTION',
            bucket: v.bucket,
            quantityDelta: diff.toString(),
            reason: v.reason,
            verificationId: v.id,
            postingId: posting.id,
            approvedById: ctx.userId,
          },
        });

        await tx.stockBalance.updateMany({
          where: { projectId: ctx.projectId, storeId: v.storeId, materialId: v.materialId },
          data: {
            availableQty: newAvailable.toString(),
            version: { increment: 1 },
          },
        });
      }

      await tx.stockVerification.updateMany({
        where: { id, projectId: ctx.projectId },
        data: {
          status: 'APPROVED',
          openKey: null,
          reviewedById: ctx.userId,
          reviewedAt: new Date(),
          reviewNote: input.note,
        },
      });

      const updated = await tx.stockVerification.findFirstOrThrow({
        where: { id, projectId: ctx.projectId },
        include: {
          store: true,
          material: { include: { stockUnit: true } },
          submittedBy: true,
          reviewedBy: true,
          adjustment: { include: { posting: true } },
        },
      });

      await this.audit.write(tx, ctx, {
        action: 'verification.approve',
        entityType: 'stock_verification',
        entityId: id,
        after: { status: 'APPROVED', adjustmentReferenceNo: adjustmentPostingRef },
      });

      const currentBalance = await tx.stockBalance.findFirst({
        where: { projectId: ctx.projectId, storeId: v.storeId, materialId: v.materialId },
      });

      return this.toDto(updated, currentBalance?.availableQty?.toString() ?? '0');
    });
  }

  async reject(
    ctx: RequestContext,
    id: string,
    input: RejectVerificationInput,
  ): Promise<VerificationDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const v = await tx.stockVerification.findFirst({
        where: { id, projectId: ctx.projectId },
        include: {
          store: true,
          material: { include: { stockUnit: true } },
          submittedBy: true,
        },
      });

      if (!v) throw notFound('Verification');
      if (v.status !== 'SUBMITTED') {
        throw new DomainError('VERIFICATION_NOT_OPEN', 'Verification is not pending review.', 409);
      }

      await tx.stockVerification.updateMany({
        where: { id, projectId: ctx.projectId },
        data: {
          status: 'REJECTED',
          openKey: null,
          reviewedById: ctx.userId,
          reviewedAt: new Date(),
          reviewNote: input.note,
        },
      });

      const updated = await tx.stockVerification.findFirstOrThrow({
        where: { id, projectId: ctx.projectId },
        include: {
          store: true,
          material: { include: { stockUnit: true } },
          submittedBy: true,
          reviewedBy: true,
          adjustment: { include: { posting: true } },
        },
      });

      await this.audit.write(tx, ctx, {
        action: 'verification.reject',
        entityType: 'stock_verification',
        entityId: id,
        after: { status: 'REJECTED', note: input.note },
      });

      const currentBalance = await tx.stockBalance.findFirst({
        where: { projectId: ctx.projectId, storeId: v.storeId, materialId: v.materialId },
      });

      return this.toDto(updated, currentBalance?.availableQty?.toString() ?? '0');
    });
  }
}
