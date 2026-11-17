import type {
  CatalogCategory,
  CatalogMaterial,
  CatalogUnit,
  ConversionRow,
  MaterialCatalog,
} from '@kavach/shared';
import type { Prisma } from '@prisma/client';

/**
 * The matching engine's view of one project's Material Master, over Prisma
 * (ARCHITECTURE §3.3 `MaterialCatalog`). Read-only. Used by the worker (first match) and the api
 * (re-match after a user edit). Every query names the project (CLAUDE.md invariant 6).
 */
type Reader = Pick<
  Prisma.TransactionClient,
  'material' | 'supplierMaterialMapping' | 'unit' | 'unitConversion' | 'materialCategory'
>;

const MATERIAL_INCLUDE = {
  category: { select: { name: true } },
  stockUnit: { select: { code: true } },
  packUnit: { select: { code: true } },
} satisfies Prisma.MaterialInclude;

type MaterialRow = Prisma.MaterialGetPayload<{ include: typeof MATERIAL_INCLUDE }>;

export function toCatalogMaterial(m: MaterialRow): CatalogMaterial {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    categoryId: m.categoryId,
    categoryName: m.category.name,
    brand: m.brand,
    grade: m.grade,
    size: m.size,
    specification: m.specification,
    stockUnitId: m.stockUnitId,
    stockUnitCode: m.stockUnit.code,
    packSize: m.packSize?.toString() ?? null,
    packUnitId: m.packUnitId,
    packUnitCode: m.packUnit?.code ?? null,
    isVariableWeight: m.isVariableWeight,
    status: m.status,
  };
}

export function createMaterialCatalog(db: Reader, projectId: string): MaterialCatalog {
  return {
    async findSupplierMapping(supplierId, normalizedDescription) {
      const row = await db.supplierMaterialMapping.findFirst({
        where: { projectId, supplierId, normalizedDescription, status: 'CONFIRMED' },
        include: { material: { include: MATERIAL_INCLUDE } },
      });
      return row ? { mappingId: row.id, material: toCatalogMaterial(row.material) } : null;
    },

    async findByNormalizedName(names) {
      if (names.length === 0) return [];
      const rows = await db.material.findMany({
        where: { projectId, normalizedName: { in: names } },
        include: MATERIAL_INCLUDE,
        take: 50,
      });
      return rows.map(toCatalogMaterial);
    },

    async searchByTokens(tokens, limit) {
      if (tokens.length === 0) return [];
      // Served by the trigram index on normalized_name.
      const rows = await db.material.findMany({
        where: {
          projectId,
          status: 'ACTIVE',
          OR: tokens.map((t) => ({ normalizedName: { contains: t } })),
        },
        include: MATERIAL_INCLUDE,
        take: limit,
      });
      return rows.map(toCatalogMaterial);
    },
  };
}

export interface MatchingMasters {
  units: CatalogUnit[];
  conversions: ConversionRow[];
  categories: CatalogCategory[];
}

/** Units, approved conversions and main categories a project's matcher needs. */
export async function loadMatchingMasters(db: Reader, projectId: string): Promise<MatchingMasters> {
  const [units, conversions, categories] = await Promise.all([
    db.unit.findMany({ where: { OR: [{ projectId: null }, { projectId }], isActive: true } }),
    db.unitConversion.findMany({
      where: { OR: [{ projectId: null }, { projectId }], isActive: true },
    }),
    db.materialCategory.findMany({
      where: { projectId, isActive: true, parentId: null },
      orderBy: { sortOrder: 'asc' },
    }),
  ]);
  return {
    units: units.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      symbol: u.symbol,
      aliases: u.aliases,
      decimalPlaces: u.decimalPlaces,
    })),
    conversions: conversions.map((c) => ({
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      factor: c.factor.toString(),
      materialId: c.materialId,
    })),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
  };
}
