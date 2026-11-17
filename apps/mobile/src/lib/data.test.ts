import type { ConversionDto, MaterialDto, UnitDto } from '@kavach/shared';
import { expect, it, jest } from '@jest/globals';
import { isQuantity, toStockUnit, unitChoices } from './data';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

const unit = (id: string, decimalPlaces: number): UnitDto =>
  ({
    id,
    code: id.toUpperCase(),
    name: id,
    symbol: id,
    decimalPlaces,
    aliases: [],
    isActive: true,
    isSystem: true,
  }) as unknown as UnitDto;
const units = [unit('kg', 3), unit('mt', 3), unit('bag', 0), unit('nos', 0)];
const conversions: ConversionDto[] = [
  {
    id: 'c1',
    fromUnitId: 'mt',
    toUnitId: 'kg',
    factor: '1000',
    materialId: null,
    isActive: true,
    isSystem: true,
  },
];
const material = (over: Partial<MaterialDto> = {}): MaterialDto =>
  ({
    id: 'm1',
    code: 'MAT-000001',
    name: 'Binding wire',
    stockUnitId: 'kg',
    stockUnitCode: 'KG',
    packSize: null,
    packUnitId: null,
    packUnitCode: null,
    isVariableWeight: false,
    ...over,
  }) as MaterialDto;

it('accepts only positive decimal strings as quantities', () => {
  expect(isQuantity('12.5')).toBe(true);
  expect(isQuantity('0')).toBe(false);
  expect(isQuantity('1.2345')).toBe(false);
  expect(isQuantity('')).toBe(false);
});

it('leaves a quantity in the stock unit as it is', () => {
  expect(toStockUnit('25', null, material(), units, conversions, false)).toMatchObject({
    ok: true,
    qty: '25',
    text: null,
  });
});

it('converts through an approved conversion and says what it becomes', () => {
  expect(toStockUnit('1.5', 'mt', material(), units, conversions, false)).toMatchObject({
    ok: true,
    qty: '1500',
    text: '= 1500 KG',
  });
});

it('refuses a unit with no approved conversion instead of guessing', () => {
  const result = toStockUnit('10', 'bag', material(), units, conversions, false);
  expect(result.ok).toBe(false);
  expect(result.qty).toBeNull();
  expect(result.text).toContain('cannot be converted');
});

it('offers the stock unit first and only units with an approved path', () => {
  expect(unitChoices(material(), units, conversions, false).map((u) => u.id)).toEqual(['kg', 'mt']);
  expect(unitChoices(undefined, units, conversions, false)).toEqual([]);
});
