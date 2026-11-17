import Decimal from 'decimal.js';

/**
 * Unit conversion (PRD §12, ARCHITECTURE §5.6). Only approved conversions are used:
 * rows from the conversion master, their inverses, and a material's own pack size.
 * Nothing is assumed, and nothing is rounded silently.
 */
export const UNIT_DIMENSIONS = ['COUNT', 'MASS', 'LENGTH', 'VOLUME', 'AREA'] as const;
export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export interface UnitInfo {
  id: string;
  decimalPlaces: number;
}

export interface ConversionRow {
  fromUnitId: string;
  toUnitId: string;
  /** qty_to = qty_from × factor */
  factor: string;
  /** null = applies to every material; otherwise only to that material. */
  materialId: string | null;
}

export interface MaterialUnitInfo {
  id: string;
  stockUnitId: string;
  packSize: string | null;
  packUnitId: string | null;
  isVariableWeight: boolean;
}

export interface ConversionContext {
  units: ReadonlyMap<string, UnitInfo>;
  conversions: readonly ConversionRow[];
  material?: MaterialUnitInfo;
  /**
   * false for issue and return (DECISIONS Q10): only general conversions and the pack size apply.
   * Material-specific rows (the bar-count ↔ weight kind) are for receipts. Default true.
   */
  allowMaterialSpecific?: boolean;
}

export type ConversionResult =
  | { ok: true; qty: Decimal; factor: Decimal }
  | { ok: false; reason: 'INCOMPATIBLE' | 'NOT_REPRESENTABLE' | 'UNKNOWN_UNIT' };

function rowFactor(
  rows: readonly ConversionRow[],
  from: string,
  to: string,
  materialId: string | null,
): Decimal | null {
  for (const r of rows) {
    if (r.materialId !== materialId) continue;
    if (r.fromUnitId === from && r.toUnitId === to) return new Decimal(r.factor);
    if (r.fromUnitId === to && r.toUnitId === from) return new Decimal(1).div(r.factor);
  }
  return null;
}

function findFactor(from: string, to: string, ctx: ConversionContext): Decimal | null {
  if (from === to) return new Decimal(1);
  const m = ctx.material;

  // 1. Material-specific approved conversion.
  if (m && ctx.allowMaterialSpecific !== false) {
    const specific = rowFactor(ctx.conversions, from, to, m.id);
    if (specific) return specific;
  }

  // 2. Pack size bridges the stock unit and the pack unit (500 bags × 50 kg). Never for
  //    variable-weight materials (PRD §12.4).
  if (m && !m.isVariableWeight && m.packSize && m.packUnitId) {
    const pack = new Decimal(m.packSize);
    const viaPack = (other: string): Decimal | null =>
      other === m.packUnitId
        ? new Decimal(1)
        : rowFactor(ctx.conversions, m.packUnitId!, other, null);
    if (from === m.stockUnitId) {
      const tail = viaPack(to); // stock → pack unit → to
      if (tail) return pack.mul(tail);
    }
    if (to === m.stockUnitId) {
      const tail = viaPack(from); // from → pack unit → stock
      if (tail) return new Decimal(1).div(pack.mul(tail));
    }
  }

  // 3. General approved conversion (MT ↔ KG).
  return rowFactor(ctx.conversions, from, to, null);
}

/** Converts `qty` between units, or says why it cannot. */
export function convert(
  qty: Decimal.Value,
  fromUnitId: string,
  toUnitId: string,
  ctx: ConversionContext,
): ConversionResult {
  const toUnit = ctx.units.get(toUnitId);
  if (!toUnit || !ctx.units.has(fromUnitId)) return { ok: false, reason: 'UNKNOWN_UNIT' };

  const factor = findFactor(fromUnitId, toUnitId, ctx);
  if (!factor) return { ok: false, reason: 'INCOMPATIBLE' };

  const result = new Decimal(qty).mul(factor);
  // 25 kg of cement is half a bag: that goes to review, it is never rounded (ARCHITECTURE §5.6).
  // Compared at 9 significant decimals so an inverse factor (1/1000) does not create false remainders.
  const rounded = result.toDecimalPlaces(toUnit.decimalPlaces);
  if (!result.toDecimalPlaces(9).equals(rounded)) return { ok: false, reason: 'NOT_REPRESENTABLE' };
  return { ok: true, qty: rounded, factor };
}

/** True when `qty` is a plain non-negative decimal with at most `decimalPlaces` decimals. */
export function isValidQuantity(qty: string, decimalPlaces: number): boolean {
  if (!/^\d{1,15}(\.\d{1,3})?$/.test(qty)) return false;
  return new Decimal(qty).decimalPlaces() <= decimalPlaces;
}
