import { describe, expect, it } from 'vitest';
import { type ConversionContext, type MaterialUnitInfo, convert, isValidQuantity } from './units';

const units = new Map(
  [
    ['BAG', 0],
    ['NOS', 0],
    ['KG', 3],
    ['G', 3],
    ['MT', 3],
  ].map(([id, decimalPlaces]) => [
    id as string,
    { id: id as string, decimalPlaces: decimalPlaces as number },
  ]),
);

const general = [
  { fromUnitId: 'MT', toUnitId: 'KG', factor: '1000', materialId: null },
  { fromUnitId: 'KG', toUnitId: 'G', factor: '1000', materialId: null },
];

const cement: MaterialUnitInfo = {
  id: 'cement',
  stockUnitId: 'BAG',
  packSize: '50',
  packUnitId: 'KG',
  isVariableWeight: false,
};
const steelBars: MaterialUnitInfo = {
  id: 'steel',
  stockUnitId: 'NOS',
  packSize: null,
  packUnitId: null,
  isVariableWeight: true,
};

const ctx = (material?: MaterialUnitInfo, extra: ConversionContext['conversions'] = []) => ({
  units,
  conversions: [...general, ...extra],
  material,
});

describe('convert (PRD §12)', () => {
  it('returns the same quantity for the same unit', () => {
    const r = convert('12.5', 'KG', 'KG', ctx());
    expect(r.ok && r.qty.toString()).toBe('12.5');
  });

  it('uses approved general conversions in both directions', () => {
    const a = convert('2.5', 'MT', 'KG', ctx());
    expect(a.ok && a.qty.toString()).toBe('2500');
    const b = convert('2500', 'KG', 'MT', ctx());
    expect(b.ok && b.qty.toString()).toBe('2.5');
  });

  it('uses the pack size: 500 bags × 50 kg = 25,000 kg (PRD §12.3)', () => {
    const r = convert('500', 'BAG', 'KG', ctx(cement));
    expect(r.ok && r.qty.toString()).toBe('25000');
  });

  it('bridges pack unit and a general conversion: 2 MT of cement = 40 bags', () => {
    const r = convert('2', 'MT', 'BAG', ctx(cement));
    expect(r.ok && r.qty.toString()).toBe('40');
  });

  it('refuses a fractional bag instead of rounding', () => {
    expect(convert('25', 'KG', 'BAG', ctx(cement))).toEqual({
      ok: false,
      reason: 'NOT_REPRESENTABLE',
    });
  });

  it('refuses units with no approved conversion', () => {
    expect(convert('10', 'BAG', 'KG', ctx())).toEqual({ ok: false, reason: 'INCOMPATIBLE' });
    expect(convert('10', 'NOS', 'KG', ctx(steelBars))).toEqual({
      ok: false,
      reason: 'INCOMPATIBLE',
    });
  });

  it('never applies a pack size to a variable-weight material (PRD §12.4)', () => {
    const variable = { ...cement, isVariableWeight: true };
    expect(convert('500', 'BAG', 'KG', ctx(variable))).toEqual({
      ok: false,
      reason: 'INCOMPATIBLE',
    });
  });

  it('uses a material-specific conversion only for that material', () => {
    const rows = [{ fromUnitId: 'NOS', toUnitId: 'KG', factor: '10.656', materialId: 'steel' }];
    const own = convert('100', 'NOS', 'KG', ctx(steelBars, rows));
    expect(own.ok && own.qty.toString()).toBe('1065.6');
    expect(convert('100', 'NOS', 'KG', ctx({ ...steelBars, id: 'other' }, rows))).toEqual({
      ok: false,
      reason: 'INCOMPATIBLE',
    });
  });

  it('issue and return never use a material-specific row, but still use the pack size (Q10)', () => {
    const rows = [{ fromUnitId: 'NOS', toUnitId: 'KG', factor: '10.656', materialId: 'steel' }];
    const issue = { ...ctx(steelBars, rows), allowMaterialSpecific: false };
    expect(convert('106.56', 'KG', 'NOS', issue)).toEqual({ ok: false, reason: 'INCOMPATIBLE' });

    const cementIssue = { ...ctx(cement), allowMaterialSpecific: false };
    const bags = convert('100', 'KG', 'BAG', cementIssue);
    expect(bags.ok && bags.qty.toString()).toBe('2');
    expect(convert('25', 'KG', 'BAG', cementIssue)).toEqual({
      ok: false,
      reason: 'NOT_REPRESENTABLE',
    });
    const mt = convert('2500', 'KG', 'MT', { ...ctx(), allowMaterialSpecific: false });
    expect(mt.ok && mt.qty.toString()).toBe('2.5');
  });

  it('rejects unknown units', () => {
    expect(convert('1', 'KG', 'XYZ', ctx())).toEqual({ ok: false, reason: 'UNKNOWN_UNIT' });
  });
});

describe('isValidQuantity', () => {
  it('enforces whole numbers for count units (Q12)', () => {
    expect(isValidQuantity('10', 0)).toBe(true);
    expect(isValidQuantity('10.5', 0)).toBe(false);
    expect(isValidQuantity('10.125', 3)).toBe(true);
    expect(isValidQuantity('10.1255', 3)).toBe(false);
    expect(isValidQuantity('-1', 3)).toBe(false);
    expect(isValidQuantity('1e3', 3)).toBe(false);
  });
});
