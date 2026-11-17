import {
  PERMISSION_CODES,
  PERMISSION_DEFS,
  ROLE_CODES,
  ROLE_NAMES,
  permissionsForRole,
} from '@kavach/shared';
import type { PrismaClient, UnitDimension } from '@prisma/client';

/**
 * System data every installation needs (ARCHITECTURE §4.5): the two fixed roles and their
 * permissions (PRD §3), the unit master (PRD §12.2) and the standard approved conversions.
 * Idempotent: safe to run on every deploy.
 */
interface SystemUnit {
  code: string;
  name: string;
  symbol: string;
  dimension: UnitDimension;
  /** 0 = whole numbers only (DECISIONS Q12). */
  decimalPlaces: number;
  aliases: string[];
}

export const SYSTEM_UNITS: readonly SystemUnit[] = [
  {
    code: 'BAG',
    name: 'Bags',
    symbol: 'bag',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['BAGS', 'BGS', 'BG'],
  },
  {
    code: 'KG',
    name: 'Kilograms',
    symbol: 'kg',
    dimension: 'MASS',
    decimalPlaces: 3,
    aliases: ['KGS', 'KILOGRAM', 'KILOGRAMS'],
  },
  {
    code: 'G',
    name: 'Grams',
    symbol: 'g',
    dimension: 'MASS',
    decimalPlaces: 3,
    aliases: ['GM', 'GMS', 'GRAM', 'GRAMS'],
  },
  {
    code: 'MT',
    name: 'Metric Tonnes',
    symbol: 'MT',
    dimension: 'MASS',
    decimalPlaces: 3,
    aliases: ['TON', 'TONS', 'TONNE', 'TONNES', 'T'],
  },
  {
    code: 'NOS',
    name: 'Numbers',
    symbol: 'nos',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['NO', 'NUMBER', 'NUMBERS', 'EA', 'EACH'],
  },
  {
    code: 'PCS',
    name: 'Pieces',
    symbol: 'pcs',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['PC', 'PIECE', 'PIECES'],
  },
  {
    code: 'M',
    name: 'Meters',
    symbol: 'm',
    dimension: 'LENGTH',
    decimalPlaces: 3,
    aliases: ['MTR', 'MTRS', 'METER', 'METERS', 'METRE', 'METRES'],
  },
  {
    code: 'FT',
    name: 'Feet',
    symbol: 'ft',
    dimension: 'LENGTH',
    decimalPlaces: 3,
    aliases: ['FEET', 'FOOT'],
  },
  {
    code: 'RFT',
    name: 'Running Feet',
    symbol: 'rft',
    dimension: 'LENGTH',
    decimalPlaces: 3,
    aliases: ['RUNNING FEET', 'RUNNING FT', 'R FT'],
  },
  {
    code: 'L',
    name: 'Litres',
    symbol: 'L',
    dimension: 'VOLUME',
    decimalPlaces: 3,
    aliases: ['LTR', 'LTRS', 'LITRE', 'LITRES', 'LITER', 'LITERS'],
  },
  {
    code: 'ROLL',
    name: 'Rolls',
    symbol: 'roll',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['ROLLS'],
  },
  {
    code: 'BOX',
    name: 'Boxes',
    symbol: 'box',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['BOXES', 'BX'],
  },
  {
    code: 'BUNDLE',
    name: 'Bundles',
    symbol: 'bundle',
    dimension: 'COUNT',
    decimalPlaces: 0,
    aliases: ['BUNDLES', 'BDL', 'BNDL'],
  },
  {
    code: 'CFT',
    name: 'Cubic Feet',
    symbol: 'cft',
    dimension: 'VOLUME',
    decimalPlaces: 3,
    aliases: ['CUBIC FEET', 'CU FT', 'CUFT'],
  },
  {
    code: 'CUM',
    name: 'Cubic Meters',
    symbol: 'm³',
    dimension: 'VOLUME',
    decimalPlaces: 3,
    aliases: ['CUBIC METER', 'CUBIC METERS', 'CUBIC METRE', 'CU M', 'M3', 'CBM'],
  },
];

/** Exact, physical conversions only. qty_to = qty_from × factor. */
export const SYSTEM_CONVERSIONS: ReadonlyArray<
  readonly [from: string, to: string, factor: string]
> = [
  ['MT', 'KG', '1000'],
  ['KG', 'G', '1000'],
  ['M', 'FT', '3.28084'],
  ['M', 'RFT', '3.28084'],
  ['RFT', 'FT', '1'],
  ['CUM', 'CFT', '35.314667'],
  ['CUM', 'L', '1000'],
];

export async function syncSystemData(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Roles and permissions mirror the constant map in packages/shared.
    for (const code of ROLE_CODES) {
      await tx.role.upsert({
        where: { code },
        update: { name: ROLE_NAMES[code], isSystem: true },
        create: { code, name: ROLE_NAMES[code], isSystem: true },
      });
    }
    for (const code of PERMISSION_CODES) {
      const { module, description } = PERMISSION_DEFS[code];
      await tx.permission.upsert({
        where: { code },
        update: { module, description },
        create: { code, module, description },
      });
    }
    await tx.permission.deleteMany({ where: { code: { notIn: PERMISSION_CODES } } });

    const permissions = await tx.permission.findMany();
    const permissionId = new Map(permissions.map((p) => [p.code, p.id]));
    for (const code of ROLE_CODES) {
      const role = await tx.role.findUniqueOrThrow({ where: { code } });
      const wanted = permissionsForRole(code).map((c) => permissionId.get(c)!);
      await tx.rolePermission.deleteMany({
        where: { roleId: role.id, permissionId: { notIn: wanted } },
      });
      await tx.rolePermission.createMany({
        data: wanted.map((id) => ({ roleId: role.id, permissionId: id })),
        skipDuplicates: true,
      });
    }

    // System units: project_id NULL.
    const unitId = new Map<string, string>();
    for (const u of SYSTEM_UNITS) {
      const existing = await tx.unit.findFirst({ where: { projectId: null, code: u.code } });
      const data = {
        name: u.name,
        symbol: u.symbol,
        dimension: u.dimension,
        decimalPlaces: u.decimalPlaces,
        aliases: u.aliases,
      };
      const row = existing
        ? await tx.unit.update({ where: { id: existing.id }, data })
        : await tx.unit.create({ data: { ...data, code: u.code, projectId: null } });
      unitId.set(u.code, row.id);
    }

    for (const [from, to, factor] of SYSTEM_CONVERSIONS) {
      const fromUnitId = unitId.get(from)!;
      const toUnitId = unitId.get(to)!;
      const existing = await tx.unitConversion.findFirst({
        where: { projectId: null, materialId: null, fromUnitId, toUnitId },
      });
      if (existing)
        await tx.unitConversion.update({ where: { id: existing.id }, data: { factor } });
      else
        await tx.unitConversion.create({ data: { projectId: null, fromUnitId, toUnitId, factor } });
    }
  });
}
