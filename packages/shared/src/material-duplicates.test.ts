import { describe, expect, it } from 'vitest';
import {
  type MaterialIdentityInput,
  assessDuplicate,
  profileMaterial,
} from './material-duplicates';
import { normalise } from './normalise';
import { compareSpecs, parseSpecs } from './specs';

const STEEL = 'cat-steel';
const CEMENT = 'cat-cement';
const MT = 'unit-mt';
const BAG = 'unit-bag';

function steel(name: string, extra: Partial<MaterialIdentityInput> = {}): MaterialIdentityInput {
  return { name, categoryId: STEEL, categoryName: 'Steel', stockUnitId: MT, ...extra };
}
function cement(name: string, extra: Partial<MaterialIdentityInput> = {}): MaterialIdentityInput {
  return { name, categoryId: CEMENT, categoryName: 'Cement', stockUnitId: BAG, ...extra };
}
const assess = (a: MaterialIdentityInput, b: MaterialIdentityInput) =>
  assessDuplicate(profileMaterial(a), profileMaterial(b));

describe('normalise', () => {
  it('canonicalises units, grades and punctuation', () => {
    expect(normalise('OPC Cement 53 Grade – 50KG')).toBe('OPC CEMENT 53 GRADE 50 KG');
    expect(normalise('ultratech opc-53, 50 kgs')).toBe('ULTRATECH OPC 53 50 KG');
    expect(normalise('TMT Fe-550 D 12mm')).toBe('TMT FE550D 12 MM');
    expect(normalise('Brick 230x110x75mm')).toBe('BRICK 230 X 110 X 75 MM');
    expect(normalise('Wire 2.5 sq.mm')).toBe('WIRE 2.5 SQMM');
    expect(normalise('  ')).toBe('');
  });
});

describe('parseSpecs', () => {
  it('reads size, grade and pack from the name', () => {
    expect(parseSpecs({ name: 'TMT Steel Fe550D 12mm' })).toEqual({
      specs: { SIZE: '12MM', GRADE: 'FE550D' },
      coreName: 'TMT STEEL',
    });
    expect(parseSpecs({ name: 'OPC Cement 53 Grade – 50 KG' }).specs).toEqual({
      GRADE: '53',
      PACK: '50KG',
    });
  });

  it('treats the size field and the name the same way', () => {
    expect(parseSpecs({ name: 'TMT Steel', size: '12 mm' }).specs.SIZE).toBe('12MM');
    expect(parseSpecs({ name: 'TMT Steel', size: '12.0mm' }).specs.SIZE).toBe('12MM');
  });

  it('does not invent attributes that are not written', () => {
    expect(parseSpecs({ name: 'River Sand' }).specs).toEqual({});
  });

  it('reports a conflict only when both sides state a different value', () => {
    expect(compareSpecs({ SIZE: '12MM' }, { SIZE: '16MM' })).toEqual([
      { key: 'SIZE', a: '12MM', b: '16MM' },
    ]);
    expect(compareSpecs({ SIZE: '12MM' }, {})).toEqual([]);
  });
});

describe('duplicate material detection (PRD §6.5)', () => {
  it('keeps TMT 12 mm, 16 mm and 20 mm separate', () => {
    const sizes = ['12mm', '16mm', '20mm'];
    for (const a of sizes) {
      for (const b of sizes) {
        if (a === b) continue;
        const result = assess(steel(`TMT Steel ${a}`), steel(`TMT Steel ${b}`));
        expect(result?.verdict).toBe('DIFFERENT_SPEC');
        expect(result?.conflicts.map((c) => c.key)).toContain('SIZE');
      }
    }
  });

  it('keeps them separate even when the names are otherwise identical', () => {
    const result = assess(
      steel('TMT Steel Bar Fe550D', { size: '12mm' }),
      steel('TMT Steel Bar Fe550D', { size: '16mm' }),
    );
    expect(result?.nameScore).toBe(1);
    expect(result?.verdict).toBe('DIFFERENT_SPEC');
  });

  it('treats a different grade as a different material', () => {
    expect(assess(steel('TMT Fe500 12mm'), steel('TMT Fe550D 12mm'))?.verdict).toBe(
      'DIFFERENT_SPEC',
    );
    expect(assess(cement('OPC 43 Grade 50kg'), cement('OPC 53 Grade 50kg'))?.verdict).toBe(
      'DIFFERENT_SPEC',
    );
  });

  it('treats a different pack size as a different material (Q11)', () => {
    const result = assess(
      cement('OPC 53', { packSize: '25', packUnitCode: 'KG' }),
      cement('OPC 53', { packSize: '50', packUnitCode: 'KG' }),
    );
    expect(result?.verdict).toBe('DIFFERENT_SPEC');
    expect(result?.conflicts.map((c) => c.key)).toEqual(['PACK']);
  });

  it('treats a different stock unit as a different material', () => {
    expect(assess(steel('TMT 12mm'), steel('TMT 12mm', { stockUnitId: 'unit-nos' }))?.verdict).toBe(
      'DIFFERENT_SPEC',
    );
  });

  it('matches the PRD example: ULTRATECH OPC 53 50KG is the existing OPC Cement 53 Grade', () => {
    const result = assess(cement('ULTRATECH OPC 53 50KG'), cement('OPC Cement 53 Grade – 50 KG'));
    expect(result?.verdict).toBe('POSSIBLE_DUPLICATE');
    expect(result?.conflicts).toEqual([]);
  });

  it('a material with no brand matches any brand; two brands differ (Q9)', () => {
    expect(assess(cement('OPC 53 50kg', { brand: 'ACC' }), cement('OPC 53 50kg'))?.verdict).toBe(
      'POSSIBLE_DUPLICATE',
    );
    expect(
      assess(cement('OPC 53 50kg', { brand: 'ACC' }), cement('OPC 53 50kg', { brand: 'Ultratech' }))
        ?.verdict,
    ).toBe('DIFFERENT_SPEC');
  });

  it('flags the same material written differently as an exact duplicate', () => {
    expect(assess(steel('TMT Steel 12mm'), steel('tmt  steel 12 MM'))?.verdict).toBe('EXACT');
    expect(assess(steel('TMT Steel 12mm'), steel('TMT Steel', { size: '12 mm' }))?.verdict).toBe(
      'EXACT',
    );
  });

  it('flags a similar name with the same spec as a possible duplicate', () => {
    expect(assess(steel('TMT Bar 12mm'), steel('TMT Steel 12mm'))?.verdict).toBe(
      'POSSIBLE_DUPLICATE',
    );
  });

  it('ignores unrelated materials', () => {
    expect(assess(steel('Binding Wire'), steel('TMT Steel 12mm'))).toBeNull();
    expect(assess(cement('White Cement 50kg'), steel('TMT Steel 12mm'))).toBeNull();
  });

  it('reads the pack, not a second grade, from "OPC 53 GRADE 50KG"', () => {
    const p = profileMaterial({
      name: 'ULTRATECH OPC 53 GRADE 50KG',
      categoryId: 'c',
      categoryName: 'Cement',
      brand: 'UltraTech',
      stockUnitId: 'bag',
    });
    expect(p.specs).toEqual({ GRADE: '53', PACK: '50KG' });
    expect(p.coreTokens).toEqual(['OPC']);
  });
});
