import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type MaterialCategory,
  Prisma,
  type Unit,
  formatMaterialCode,
  nextSequenceValue,
} from '@kavach/db';
import {
  type CheckDuplicatesSchema,
  type CreateMaterialSchema,
  type DuplicateCandidateDto,
  type DuplicateCheckResult,
  type MaterialData,
  type MaterialDto,
  type MaterialListQuerySchema,
  type MaterialProfile,
  type Paginated,
  SPEC_KEYS,
  type UpdateMaterialSchema,
  assessDuplicate,
  isValidQuantity,
  normalise,
  profileMaterial,
} from '@kavach/shared';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestContext } from '../../common/context/request-context';
import { DomainError, invalid, notFound } from '../../common/errors/domain-error';
import { type Db, PrismaService } from '../../common/prisma/prisma.service';
import { findVisibleUnit } from '../units/units';

type CreateMaterial = z.output<typeof CreateMaterialSchema>;
type UpdateMaterial = z.output<typeof UpdateMaterialSchema>;
type CheckDuplicates = z.output<typeof CheckDuplicatesSchema>;
type ListQuery = z.output<typeof MaterialListQuerySchema>;

const INCLUDE = {
  category: true,
  subcategory: true,
  stockUnit: true,
  packUnit: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.MaterialInclude;

type MaterialRow = Prisma.MaterialGetPayload<{ include: typeof INCLUDE }>;

/** The fields that define a material, fully resolved (no `undefined`). */
interface MaterialFields {
  name: string;
  categoryId: string;
  subcategoryId: string | null;
  brand: string | null;
  specification: string | null;
  grade: string | null;
  size: string | null;
  stockUnitId: string;
  packSize: string | null;
  packUnitId: string | null;
  isVariableWeight: boolean;
  minimumStock: string | null;
  description: string | null;
}

interface Resolved {
  fields: MaterialFields;
  category: MaterialCategory;
  stockUnit: Unit;
  packUnit: Unit | null;
  profile: MaterialProfile;
  identityKey: string;
}

const VERDICT_ORDER = { EXACT: 0, POSSIBLE_DUPLICATE: 1, DIFFERENT_SPEC: 2 } as const;

const toDto = (m: MaterialRow): MaterialDto => ({
  id: m.id,
  code: m.code,
  name: m.name,
  categoryId: m.categoryId,
  categoryName: m.category.name,
  subcategoryId: m.subcategoryId,
  subcategoryName: m.subcategory?.name ?? null,
  brand: m.brand,
  specification: m.specification,
  grade: m.grade,
  size: m.size,
  stockUnitId: m.stockUnitId,
  stockUnitCode: m.stockUnit.code,
  packSize: m.packSize?.toString() ?? null,
  packUnitId: m.packUnitId,
  packUnitCode: m.packUnit?.code ?? null,
  isVariableWeight: m.isVariableWeight,
  minimumStock: m.minimumStock?.toString() ?? null,
  description: m.description,
  status: m.status,
  creationSource: m.creationSource,
  createdByName: m.createdBy.name,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
  version: m.version,
});

const fieldsOf = (m: MaterialRow): MaterialFields => ({
  name: m.name,
  categoryId: m.categoryId,
  subcategoryId: m.subcategoryId,
  brand: m.brand,
  specification: m.specification,
  grade: m.grade,
  size: m.size,
  stockUnitId: m.stockUnitId,
  packSize: m.packSize?.toString() ?? null,
  packUnitId: m.packUnitId,
  isVariableWeight: m.isVariableWeight,
  minimumStock: m.minimumStock?.toString() ?? null,
  description: m.description,
});

const fromInput = (d: MaterialData): MaterialFields => ({
  name: d.name,
  categoryId: d.categoryId,
  subcategoryId: d.subcategoryId ?? null,
  brand: d.brand ?? null,
  specification: d.specification ?? null,
  grade: d.grade ?? null,
  size: d.size ?? null,
  stockUnitId: d.stockUnitId,
  packSize: d.packSize ?? null,
  packUnitId: d.packUnitId ?? null,
  isVariableWeight: d.isVariableWeight ?? false,
  minimumStock: d.minimumStock ?? null,
  description: d.description ?? null,
});

const profileOfRow = (m: MaterialRow): MaterialProfile =>
  profileMaterial({
    name: m.name,
    categoryId: m.categoryId,
    categoryName: m.category.name,
    brand: m.brand,
    grade: m.grade,
    size: m.size,
    specification: m.specification,
    stockUnitId: m.stockUnitId,
    packSize: m.packSize?.toString() ?? null,
    packUnitId: m.packUnitId,
    packUnitCode: m.packUnit?.code ?? null,
  });

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

/**
 * Material Master (PRD §6). Manual creation is a Project Admin action (§6.4 method A);
 * Store Managers create materials only through Material In (Quick Receive, Confirm & Receive).
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: RequestContext, query: ListQuery): Promise<Paginated<MaterialDto>> {
    const where: Prisma.MaterialWhereInput = { projectId: ctx.projectId };
    if (query.status) where.status = query.status;
    if (query.categoryId) {
      where.AND = [{ OR: [{ categoryId: query.categoryId }, { subcategoryId: query.categoryId }] }];
    }
    if (query.q) {
      // Every word must appear in the normalised name, or the text is a Material ID.
      const words = normalise(query.q).split(' ').filter(Boolean);
      where.OR = [
        { AND: words.map((w) => ({ normalizedName: { contains: w } })) },
        { code: { contains: query.q.toUpperCase() } },
        { normalizedBrand: { contains: normalise(query.q) } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.db.material.count({ where }),
      this.prisma.db.material.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ name: 'asc' }, { code: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return { items: rows.map(toDto), total, page: query.page, pageSize: query.pageSize };
  }

  async get(ctx: RequestContext, id: string): Promise<MaterialDto> {
    return toDto(await this.load(this.prisma.db, ctx, id));
  }

  /** PRD §6.5: what already exists that looks like this material? */
  async checkDuplicates(
    ctx: RequestContext,
    input: CheckDuplicates,
  ): Promise<DuplicateCheckResult> {
    const { excludeId, ...data } = input;
    const resolved = await this.resolve(this.prisma.db, ctx, fromInput(data));
    return this.findDuplicates(this.prisma.db, ctx, resolved, excludeId);
  }

  async create(ctx: RequestContext, input: CreateMaterial): Promise<MaterialDto> {
    const { confirmNotDuplicate, ...data } = input;
    try {
      return await this.prisma.db.$transaction((tx) =>
        this.createInTransaction(tx, ctx, data, { source: 'MANUAL', confirmNotDuplicate }),
      );
    } catch (e) {
      // Two admins creating the same material at once: the unique identity key decides.
      if (isUniqueViolation(e)) {
        throw new DomainError('MATERIAL_ALREADY_EXISTS', 'This material already exists.', 409);
      }
      throw e;
    }
  }

  /**
   * Creates a material inside the caller's transaction. This is the one path every new material
   * takes: manual creation, Quick Receive and Confirm & Receive (PRD §6.4). The same validation,
   * identity key and duplicate check (PRD §6.5) apply to all three, and the material commits or
   * rolls back with whatever the caller is posting (CLAUDE.md invariant 9).
   */
  async createInTransaction(
    tx: Db,
    ctx: RequestContext,
    data: MaterialData,
    opts: {
      source: 'MANUAL' | 'AI_INVOICE' | 'QUICK_RECEIVE';
      confirmNotDuplicate: boolean;
      /** Extra audit context: the invoice line and what the AI proposed (PRD §18.3). */
      metadata?: Record<string, unknown>;
    },
  ): Promise<MaterialDto> {
    const resolved = await this.resolve(tx, ctx, fromInput(data));
    const duplicates = await this.findDuplicates(tx, ctx, resolved);
    this.assertNoDuplicate(duplicates, opts.confirmNotDuplicate);

    const code = formatMaterialCode(await nextSequenceValue(tx, ctx.projectId, 'MATERIAL'));
    const created = await tx.material.create({
      data: {
        ...this.columns(resolved),
        projectId: ctx.projectId,
        code,
        creationSource: opts.source,
        createdById: ctx.userId,
        specs: { create: this.specRows(resolved.profile) },
      },
      include: INCLUDE,
    });
    await this.audit.write(tx, ctx, {
      action: 'material.create',
      entityType: 'material',
      entityId: created.id,
      after: toDto(created),
      metadata: {
        source: opts.source,
        // Recorded when it was created despite a similar material (PRD §6.5).
        similarMaterialIds: duplicates.candidates.map((c) => c.material.id),
        confirmedNotDuplicate: duplicates.needsConfirmation,
        ...opts.metadata,
      },
    });
    return toDto(created);
  }

  /** The identity a material with these fields would have. Throws when the fields are not valid. */
  async identityKeyFor(tx: Db, ctx: RequestContext, data: MaterialData): Promise<string> {
    return (await this.resolve(tx, ctx, fromInput(data))).identityKey;
  }

  async update(ctx: RequestContext, id: string, input: UpdateMaterial): Promise<MaterialDto> {
    const { version, confirmNotDuplicate, ...changes } = input;
    try {
      return await this.prisma.db.$transaction(async (tx) => {
        const before = await this.load(tx, ctx, id);
        if (before.version !== version) throw this.stale();

        // Q22: Once a material has transactions, its identity fields are locked.
        const txnCount = await tx.materialTransaction.count({
          where: { projectId: ctx.projectId, materialId: id },
        });
        if (txnCount > 0) {
          const lockedFields = [
            'stockUnitId',
            'packSize',
            'packUnitId',
            'grade',
            'size',
            'specification',
          ] as const;
          for (const f of lockedFields) {
            if (changes[f] !== undefined) {
              const beforeRec = before as unknown as Record<string, unknown>;
              const changeRec = changes as unknown as Record<string, unknown>;
              const beforeVal = beforeRec[f]?.toString?.() ?? beforeRec[f] ?? null;
              const changeVal = changeRec[f]?.toString?.() ?? changeRec[f] ?? null;
              if (beforeVal !== changeVal) {
                throw new DomainError(
                  'MATERIAL_LOCKED',
                  `Material identity field '${f}' cannot be changed after the first transaction.`,
                  409,
                );
              }
            }
          }
        }

        const current = fieldsOf(before);
        const merged = { ...current };
        for (const [key, value] of Object.entries(changes)) {
          if (value !== undefined) Object.assign(merged, { [key]: value });
        }
        const resolved = await this.resolve(tx, ctx, merged);

        // Specifications are never changed silently (PRD §3.3): an identity change is checked
        // against the rest of the master exactly like a new material, and audited below.
        if (resolved.identityKey !== before.identityKey) {
          const duplicates = await this.findDuplicates(tx, ctx, resolved, id);
          this.assertNoDuplicate(duplicates, confirmNotDuplicate);
        }

        const updated = await tx.material.updateMany({
          where: { projectId: ctx.projectId, id, version },
          data: { ...this.columns(resolved), version: { increment: 1 } },
        });
        if (updated.count === 0) throw this.stale();
        await tx.materialSpecification.deleteMany({ where: { materialId: id } });
        await tx.materialSpecification.createMany({
          data: this.specRows(resolved.profile).map((s) => ({ ...s, materialId: id })),
        });

        const after = await this.load(tx, ctx, id);
        await this.audit.write(tx, ctx, {
          action: 'material.update',
          entityType: 'material',
          entityId: id,
          before: toDto(before),
          after: toDto(after),
          metadata: { identityChanged: resolved.identityKey !== before.identityKey },
        });
        return toDto(after);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new DomainError('MATERIAL_ALREADY_EXISTS', 'This material already exists.', 409);
      }
      throw e;
    }
  }

  /** Deactivation is an administrative action (PRD §3.3). Only allowed at zero stock (Q22). */
  async setStatus(
    ctx: RequestContext,
    id: string,
    status: 'ACTIVE' | 'INACTIVE',
  ): Promise<MaterialDto> {
    return this.prisma.db.$transaction(async (tx) => {
      const before = await this.load(tx, ctx, id);
      if (before.status === status) return toDto(before);

      if (status === 'INACTIVE') {
        const balances = await tx.stockBalance.findMany({
          where: { projectId: ctx.projectId, materialId: id },
        });
        for (const b of balances) {
          if (Number(b.availableQty) > 0 || Number(b.damagedQty) > 0 || Number(b.scrapQty) > 0) {
            throw new DomainError(
              'MATERIAL_HAS_STOCK',
              'Cannot deactivate a material with stock on hand.',
              409,
            );
          }
        }
      }

      await tx.material.updateMany({
        where: { projectId: ctx.projectId, id },
        data: {
          status,
          version: { increment: 1 },
          deactivatedById: status === 'INACTIVE' ? ctx.userId : null,
          deactivatedAt: status === 'INACTIVE' ? new Date() : null,
        },
      });
      const after = await this.load(tx, ctx, id);
      await this.audit.write(tx, ctx, {
        action: status === 'INACTIVE' ? 'material.deactivate' : 'material.activate',
        entityType: 'material',
        entityId: id,
        before: { status: before.status },
        after: { status: after.status },
      });
      return toDto(after);
    });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private stale(): DomainError {
    return new DomainError(
      'STALE_VERSION',
      'Someone else changed this material. Reload and try again.',
      409,
    );
  }

  private async load(db: Db, ctx: RequestContext, id: string): Promise<MaterialRow> {
    const row = await db.material.findFirst({
      where: { projectId: ctx.projectId, id },
      include: INCLUDE,
    });
    if (!row) throw notFound('Material');
    return row;
  }

  /** Validates every reference against this project and computes the material's identity. */
  private async resolve(db: Db, ctx: RequestContext, fields: MaterialFields): Promise<Resolved> {
    const category = await db.materialCategory.findFirst({
      where: { projectId: ctx.projectId, id: fields.categoryId },
    });
    if (!category) throw notFound('Category');
    if (category.parentId) throw invalid('Choose a main category, then a subcategory.');
    if (!category.isActive) throw invalid('This category is inactive.');

    if (fields.subcategoryId) {
      const sub = await db.materialCategory.findFirst({
        where: { projectId: ctx.projectId, id: fields.subcategoryId },
      });
      if (!sub) throw notFound('Subcategory');
      if (sub.parentId !== category.id)
        throw invalid('The subcategory belongs to another category.');
    }

    const stockUnit = await findVisibleUnit(db, ctx.projectId, fields.stockUnitId);
    if (!stockUnit) throw notFound('Unit');
    if (!stockUnit.isActive) throw invalid('This unit is inactive.');

    if ((fields.packSize === null) !== (fields.packUnitId === null)) {
      throw invalid('Enter both the pack size and its unit, or neither.');
    }
    let packUnit: Unit | null = null;
    if (fields.packUnitId && fields.packSize) {
      packUnit = await findVisibleUnit(db, ctx.projectId, fields.packUnitId);
      if (!packUnit) throw notFound('Pack unit');
      if (!packUnit.isActive) throw invalid('The pack unit is inactive.');
      if (packUnit.id === stockUnit.id)
        throw invalid('The pack unit must differ from the stock unit.');
      if (Number(fields.packSize) <= 0) throw invalid('The pack size must be greater than zero.');
      // A variable-weight material has no fixed pack (PRD §12.4).
      if (fields.isVariableWeight)
        throw invalid('A variable-weight material cannot have a pack size.');
    }
    if (fields.minimumStock && !isValidQuantity(fields.minimumStock, stockUnit.decimalPlaces)) {
      throw new DomainError(
        'UNIT_INCOMPATIBLE',
        `${stockUnit.name} are counted in whole numbers.`,
        400,
      );
    }

    const profile = profileMaterial({
      ...fields,
      categoryName: category.name,
      packUnitCode: packUnit?.code ?? null,
    });
    const identityKey = createHash('sha256').update(profile.identity).digest('hex');
    return { fields, category, stockUnit, packUnit, profile, identityKey };
  }

  private columns(r: Resolved) {
    const f = r.fields;
    return {
      name: f.name,
      normalizedName: normalise(f.name),
      categoryId: f.categoryId,
      subcategoryId: f.subcategoryId,
      brand: f.brand,
      normalizedBrand: f.brand ? normalise(f.brand) : null,
      specification: f.specification,
      grade: f.grade,
      size: f.size,
      stockUnitId: f.stockUnitId,
      packSize: f.packSize,
      packUnitId: f.packUnitId,
      isVariableWeight: f.isVariableWeight,
      minimumStock: f.minimumStock,
      description: f.description,
      identityKey: r.identityKey,
    };
  }

  private specRows(profile: MaterialProfile) {
    return SPEC_KEYS.flatMap((key) => {
      const value = profile.specs[key];
      return value ? [{ key, valueText: value, normalizedValue: value }] : [];
    });
  }

  private assertNoDuplicate(result: DuplicateCheckResult, confirmed: boolean): void {
    if (result.exact) {
      throw new DomainError(
        'MATERIAL_ALREADY_EXISTS',
        'This material already exists.',
        409,
        result,
      );
    }
    if (result.needsConfirmation && !confirmed) {
      throw new DomainError(
        'POSSIBLE_DUPLICATE',
        'A similar material already exists. Check it before creating a new one.',
        409,
        result,
      );
    }
  }

  private async findDuplicates(
    db: Db,
    ctx: RequestContext,
    proposed: Resolved,
    excludeId?: string,
  ): Promise<DuplicateCheckResult> {
    // Candidates: the same identity, or a name sharing a word with the proposal. The trigram
    // index serves the `contains` filters. Inactive materials count: they are still duplicates.
    const tokens = proposed.profile.coreTokens;
    const rows = await db.material.findMany({
      where: {
        projectId: ctx.projectId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        OR: [
          { identityKey: proposed.identityKey },
          ...tokens.map((t) => ({ normalizedName: { contains: t } })),
        ],
      },
      include: INCLUDE,
      take: 300,
    });

    const unitCode = new Map<string, string>([[proposed.stockUnit.id, proposed.stockUnit.code]]);
    const candidates: DuplicateCandidateDto[] = [];
    for (const row of rows) {
      const assessment = assessDuplicate(proposed.profile, profileOfRow(row));
      if (!assessment) continue;
      unitCode.set(row.stockUnitId, row.stockUnit.code);
      candidates.push({
        material: {
          id: row.id,
          code: row.code,
          name: row.name,
          brand: row.brand,
          grade: row.grade,
          size: row.size,
          stockUnitCode: row.stockUnit.code,
          status: row.status,
          packSize: row.packSize?.toString() ?? null,
          packUnitCode: row.packUnit?.code ?? null,
          categoryName: row.category.name,
        },
        verdict: assessment.verdict,
        nameScore: assessment.nameScore,
        conflicts: assessment.conflicts.map((c) => ({
          key: c.key,
          proposed: c.key === 'UNIT' ? (unitCode.get(c.a) ?? c.a) : c.a,
          existing: c.key === 'UNIT' ? (unitCode.get(c.b) ?? c.b) : c.b,
        })),
      });
    }
    candidates.sort(
      (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || b.nameScore - a.nameScore,
    );
    return {
      exact: candidates.some((c) => c.verdict === 'EXACT'),
      needsConfirmation: candidates.some((c) => c.verdict === 'POSSIBLE_DUPLICATE'),
      candidates: candidates.slice(0, 10),
    };
  }
}
