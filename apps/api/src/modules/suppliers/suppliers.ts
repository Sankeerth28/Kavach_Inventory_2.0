import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Prisma } from '@kavach/db';
import {
  type CreateSupplierSchema,
  CreateSupplierSchema as CreateSchema,
  type DisableMappingInput,
  DisableMappingSchema,
  type MappingListQuery,
  MappingListQuerySchema,
  type Paginated,
  type SupplierDto,
  SupplierListQuerySchema,
  type SupplierMappingDto,
  UpdateSupplierSchema,
  normalise,
} from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { RequirePermission } from '../../common/auth/access.decorators';
import { Ctx, type RequestContext } from '../../common/context/request-context';
import { DomainError, conflict, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { IdPipe } from '../../common/validation/id.pipe';
import { zod } from '../../common/validation/zod.pipe';

type CreateSupplier = z.output<typeof CreateSupplierSchema>;
type UpdateSupplier = z.output<typeof UpdateSupplierSchema>;
type ListQuery = z.output<typeof SupplierListQuerySchema>;

const INCLUDE = {
  aliases: { select: { alias: true }, orderBy: { alias: 'asc' } },
  _count: { select: { mappings: { where: { status: 'CONFIRMED' } } } },
} satisfies Prisma.SupplierInclude;

type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof INCLUDE }>;

const toDto = (s: SupplierRow): SupplierDto => ({
  id: s.id,
  name: s.name,
  gstin: s.gstin,
  address: s.address,
  phone: s.phone,
  isActive: s.isActive,
  aliases: s.aliases.map((a) => a.alias),
  mappingCount: s._count.mappings,
});

const MAPPING_INCLUDE = {
  supplier: { select: { name: true } },
  material: { select: { code: true, name: true } },
  confirmedBy: { select: { name: true } },
} satisfies Prisma.SupplierMaterialMappingInclude;

type MappingRow = Prisma.SupplierMaterialMappingGetPayload<{ include: typeof MAPPING_INCLUDE }>;

const toMappingDto = (m: MappingRow): SupplierMappingDto => ({
  id: m.id,
  supplierId: m.supplierId,
  supplierName: m.supplier.name,
  description: m.description,
  materialId: m.materialId,
  materialCode: m.material.code,
  materialName: m.material.name,
  status: m.status,
  confirmedByName: m.confirmedBy.name,
  confirmedAt: m.confirmedAt.toISOString(),
  timesUsed: m.timesUsed,
  lastUsedAt: m.lastUsedAt.toISOString(),
  disabledReason: m.disabledReason,
});

/**
 * Supplier master and the learned supplier → material mappings (PRD §4 module 9, §9).
 * Suppliers belong to one project and are managed by the Project Admin (DECISIONS Q7). A Store
 * Manager creates one only while receiving a document, inside Confirm & Receive.
 *
 * Mappings are never created here: they are saved only from a user-confirmed receipt
 * (PRD §26 rule 17). The admin can look at them and disable a wrong one.
 */
@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: ListQuery): Promise<SupplierDto[]> {
    const where: Prisma.SupplierWhereInput = { projectId: ctx.projectId };
    if (!query.includeInactive) where.isActive = true;
    if (query.q) {
      const q = normalise(query.q);
      where.OR = [
        { normalizedName: { contains: q } },
        { gstin: { contains: query.q.toUpperCase() } },
        { aliases: { some: { normalizedAlias: { contains: q } } } },
      ];
    }
    const rows = await this.prisma.db.supplier.findMany({
      where,
      include: INCLUDE,
      orderBy: { name: 'asc' },
      take: 500,
    });
    return rows.map(toDto);
  }

  async create(ctx: RequestContext, input: CreateSupplier): Promise<SupplierDto> {
    return this.prisma.db.$transaction(async (tx) => {
      await this.assertUnique(tx, ctx, input.name, input.gstin ?? null);
      const created = await tx.supplier.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          normalizedName: normalise(input.name),
          gstin: input.gstin ?? null,
          address: input.address ?? null,
          phone: input.phone ?? null,
          createdById: ctx.userId,
        },
        include: INCLUDE,
      });
      await this.audit.write(tx, ctx, {
        action: 'supplier.create',
        entityType: 'supplier',
        entityId: created.id,
        after: toDto(created),
        metadata: { source: 'MANUAL' },
      });
      return toDto(created);
    });
  }

  async update(ctx: RequestContext, id: string, input: UpdateSupplier): Promise<SupplierDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.supplier.findFirst({
        where: { projectId: ctx.projectId, id },
        include: INCLUDE,
      });
      if (!before) throw notFound('Supplier');
      const name = input.name ?? before.name;
      const gstin = input.gstin === undefined ? before.gstin : input.gstin;
      if (name !== before.name || gstin !== before.gstin) {
        await this.assertUnique(tx, ctx, name, gstin, id);
      }
      await tx.supplier.updateMany({
        where: { projectId: ctx.projectId, id },
        data: {
          name,
          normalizedName: normalise(name),
          gstin,
          address: input.address === undefined ? undefined : input.address,
          phone: input.phone === undefined ? undefined : input.phone,
          isActive: input.isActive,
        },
      });
      const after = await tx.supplier.findFirstOrThrow({
        where: { projectId: ctx.projectId, id },
        include: INCLUDE,
      });
      await this.audit.write(tx, ctx, {
        action: 'supplier.update',
        entityType: 'supplier',
        entityId: id,
        before: toDto(before),
        after: toDto(after),
      });
      return toDto(after);
    });
  }

  async mappings(
    ctx: RequestContext,
    query: MappingListQuery,
  ): Promise<Paginated<SupplierMappingDto>> {
    const where: Prisma.SupplierMaterialMappingWhereInput = { projectId: ctx.projectId };
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.q) where.normalizedDescription = { contains: normalise(query.q) };
    const [total, rows] = await Promise.all([
      this.prisma.db.supplierMaterialMapping.count({ where }),
      this.prisma.db.supplierMaterialMapping.findMany({
        where,
        include: MAPPING_INCLUDE,
        orderBy: [{ status: 'asc' }, { lastUsedAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toMappingDto), total, page: query.page, pageSize: query.pageSize };
  }

  /** A wrong mapping is switched off. The next document with that description is matched afresh. */
  async disableMapping(
    ctx: RequestContext,
    id: string,
    reason: string,
  ): Promise<SupplierMappingDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await tx.supplierMaterialMapping.findFirst({
        where: { projectId: ctx.projectId, id },
      });
      if (!before) throw notFound('Mapping');
      if (before.status === 'DISABLED') throw conflict('This mapping is already disabled.');
      await tx.supplierMaterialMapping.updateMany({
        where: { projectId: ctx.projectId, id },
        data: { status: 'DISABLED', liveKey: null, disabledReason: reason },
      });
      await this.audit.write(tx, ctx, {
        action: 'supplier_mapping.disable',
        entityType: 'supplier_mapping',
        entityId: id,
        before: { status: before.status, materialId: before.materialId },
        after: { status: 'DISABLED', reason },
      });
      const after = await tx.supplierMaterialMapping.findFirstOrThrow({
        where: { projectId: ctx.projectId, id },
        include: MAPPING_INCLUDE,
      });
      return toMappingDto(after);
    });
  }

  private async assertUnique(
    db: Db,
    ctx: RequestContext,
    name: string,
    gstin: string | null,
    excludeId?: string,
  ): Promise<void> {
    const normalizedName = normalise(name);
    const clash = await db.supplier.findFirst({
      where: {
        projectId: ctx.projectId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [{ normalizedName }, ...(gstin ? [{ gstin }] : [])],
      },
    });
    if (clash) {
      throw new DomainError(
        'CONFLICT',
        clash.gstin && clash.gstin === gstin
          ? `${clash.name} already has this GSTIN.`
          : `A supplier named ${clash.name} already exists.`,
        409,
        { supplierId: clash.id },
      );
    }
    const alias = await db.supplierAlias.findFirst({
      where: {
        projectId: ctx.projectId,
        normalizedAlias: normalizedName,
        ...(excludeId ? { supplierId: { not: excludeId } } : {}),
      },
      include: { supplier: { select: { name: true } } },
    });
    if (alias) {
      throw new DomainError(
        'CONFLICT',
        `This name is already known as another spelling of ${alias.supplier.name}.`,
        409,
        {
          supplierId: alias.supplierId,
        },
      );
    }
  }
}

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('supplier:view')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(SupplierListQuerySchema)) query: ListQuery,
  ): Promise<SupplierDto[]> {
    return this.suppliers.list(ctx, query);
  }

  @Post()
  @RequirePermission('supplier:manage')
  create(
    @Ctx() ctx: RequestContext,
    @Body(zod(CreateSchema)) body: CreateSupplier,
  ): Promise<SupplierDto> {
    return this.suppliers.create(ctx, body);
  }

  @Patch(':id')
  @RequirePermission('supplier:manage')
  update(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(UpdateSupplierSchema)) body: UpdateSupplier,
  ): Promise<SupplierDto> {
    return this.suppliers.update(ctx, id, body);
  }
}

@Controller('supplier-mappings')
export class SupplierMappingsController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermission('supplier_mapping:manage')
  list(
    @Ctx() ctx: RequestContext,
    @Query(zod(MappingListQuerySchema)) query: MappingListQuery,
  ): Promise<Paginated<SupplierMappingDto>> {
    return this.suppliers.mappings(ctx, query);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermission('supplier_mapping:manage')
  disable(
    @Ctx() ctx: RequestContext,
    @Param('id', IdPipe) id: string,
    @Body(zod(DisableMappingSchema)) body: DisableMappingInput,
  ): Promise<SupplierMappingDto> {
    return this.suppliers.disableMapping(ctx, id, body.reason);
  }
}
