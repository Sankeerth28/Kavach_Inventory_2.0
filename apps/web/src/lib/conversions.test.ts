import { convert } from '@kavach/shared';
import { describe, expect, it } from 'vitest';

describe('Unit Conversion Display & Previews (PRD §12, Decisions Q10)', () => {
  const units = new Map([
    ['u-kg', { id: 'u-kg', decimalPlaces: 2 }],
    ['u-mt', { id: 'u-mt', decimalPlaces: 3 }],
    ['u-bag', { id: 'u-bag', decimalPlaces: 0 }],
    ['u-pcs', { id: 'u-pcs', decimalPlaces: 0 }],
  ]);

  const conversions = [
    // 1 MT = 1000 kg
    { fromUnitId: 'u-mt', toUnitId: 'u-kg', factor: '1000', materialId: null },
    // Material-specific: 1 bar = 12 kg (allowed on receipt, forbidden on issue/return under Q10)
    { fromUnitId: 'u-pcs', toUnitId: 'u-kg', factor: '12', materialId: 'm-steel' },
  ];

  it('converts 2500 kg to 2.5 MT for display preview', () => {
    const res = convert('2500', 'u-kg', 'u-mt', {
      units,
      conversions,
      allowMaterialSpecific: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qty.toString()).toBe('2.5');
    }
  });

  it('converts 100 kg to 2 bags of 50 kg cement via pack size', () => {
    const cement = {
      id: 'm-cement',
      stockUnitId: 'u-bag',
      packSize: '50',
      packUnitId: 'u-kg',
      isVariableWeight: false,
    };

    const res = convert('100', 'u-kg', 'u-bag', {
      units,
      conversions,
      material: cement,
      allowMaterialSpecific: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.qty.toString()).toBe('2');
    }
  });

  it('rejects non-integer count units (e.g. 25 kg = 0.5 bags)', () => {
    const cement = {
      id: 'm-cement',
      stockUnitId: 'u-bag',
      packSize: '50',
      packUnitId: 'u-kg',
      isVariableWeight: false,
    };

    const res = convert('25', 'u-kg', 'u-bag', {
      units,
      conversions,
      material: cement,
      allowMaterialSpecific: false,
    });
    // Decimal places for bags is 0, so 0.5 bags cannot be represented
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('NOT_REPRESENTABLE');
    }
  });

  it('forbids bar-count to weight conversion on issue (Q10)', () => {
    const steel = {
      id: 'm-steel',
      stockUnitId: 'u-mt',
      packSize: null,
      packUnitId: null,
      isVariableWeight: false,
    };

    // When allowMaterialSpecific is false (issue/return), material-specific row is ignored
    const res = convert('10', 'u-pcs', 'u-mt', {
      units,
      conversions,
      material: steel,
      allowMaterialSpecific: false,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('INCOMPATIBLE');
    }
  });
});
