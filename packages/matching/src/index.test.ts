import type {
  CatalogMaterial,
  MatchContext,
  MatchLineInput,
  MaterialCatalog,
} from '@kavach/shared';
import { DEFAULT_THRESHOLDS, normalise } from '@kavach/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildProposal, conflictsWith, matchLine } from './index';

const U = { BAG: 'u-bag', KG: 'u-kg', MT: 'u-mt', NOS: 'u-nos', M: 'u-m', CFT: 'u-cft' };

const ctx: MatchContext = {
  supplierId: 'sup-1',
  thresholds: DEFAULT_THRESHOLDS,
  units: [
    {
      id: U.BAG,
      code: 'BAG',
      name: 'Bags',
      symbol: 'bag',
      aliases: ['BAGS', 'BGS', 'BG'],
      decimalPlaces: 0,
    },
    { id: U.KG, code: 'KG', name: 'Kilograms', symbol: 'kg', aliases: ['KGS'], decimalPlaces: 3 },
    {
      id: U.MT,
      code: 'MT',
      name: 'Metric Tonnes',
      symbol: 'MT',
      aliases: ['TON', 'TONS'],
      decimalPlaces: 3,
    },
    { id: U.NOS, code: 'NOS', name: 'Numbers', symbol: 'nos', aliases: ['NO'], decimalPlaces: 0 },
    { id: U.M, code: 'M', name: 'Meters', symbol: 'm', aliases: ['MTR'], decimalPlaces: 3 },
    { id: U.CFT, code: 'CFT', name: 'Cubic Feet', symbol: 'cft', aliases: [], decimalPlaces: 3 },
  ],
  conversions: [{ fromUnitId: U.MT, toUnitId: U.KG, factor: '1000', materialId: null }],
  categories: [
    { id: 'c-cement', name: 'Cement' },
    { id: 'c-steel', name: 'Steel' },
    { id: 'c-plumbing', name: 'Plumbing' },
    { id: 'c-hardware', name: 'Hardware' },
  ],
};

let seq = 0;
function material(over: Partial<CatalogMaterial> & { name: string }): CatalogMaterial {
  seq += 1;
  return {
    id: `m-${seq}`,
    code: `MAT-${String(seq).padStart(6, '0')}`,
    categoryId: 'c-hardware',
    categoryName: 'Hardware',
    brand: null,
    grade: null,
    size: null,
    specification: null,
    stockUnitId: U.NOS,
    stockUnitCode: 'NOS',
    packSize: null,
    packUnitId: null,
    packUnitCode: null,
    isVariableWeight: false,
    status: 'ACTIVE',
    ...over,
  };
}

function catalogOf(
  materials: CatalogMaterial[],
  mappings: Record<string, CatalogMaterial> = {},
): MaterialCatalog {
  return {
    findSupplierMapping: async (supplierId, norm) => {
      const m = mappings[`${supplierId}:${norm}`];
      return m ? { mappingId: 'map-1', material: m } : null;
    },
    findByNormalizedName: async (names) =>
      materials.filter((m) => names.includes(normalise(m.name))),
    searchByTokens: async (tokens) =>
      materials.filter((m) => tokens.some((t) => normalise(m.name).includes(t))),
  };
}

function line(over: Partial<MatchLineInput> & { description: string }): MatchLineInput {
  return {
    suggestedName: null,
    brand: null,
    category: null,
    specification: null,
    grade: null,
    size: null,
    packSize: null,
    unitId: null,
    ...over,
  };
}

const cement = material({
  name: 'OPC Cement 53 Grade',
  categoryId: 'c-cement',
  categoryName: 'Cement',
  stockUnitId: U.BAG,
  stockUnitCode: 'BAG',
});
const tmt12 = material({
  name: 'TMT Steel 12mm',
  categoryId: 'c-steel',
  categoryName: 'Steel',
  grade: 'Fe 550',
  stockUnitId: U.MT,
  stockUnitCode: 'MT',
});
const tmt16 = material({
  name: 'TMT Steel 16mm',
  categoryId: 'c-steel',
  categoryName: 'Steel',
  grade: 'Fe 550',
  stockUnitId: U.MT,
  stockUnitCode: 'MT',
});
const gi = ['1 Inch', '1.5 Inch', '2 Inch'].map((size) => material({ name: `GI Fitting ${size}` }));

describe('matchLine (PRD §7.3 steps 5–6)', () => {
  it('matches the PRD example: ULTRATECH OPC 53 50KG → OPC Cement 53 Grade', async () => {
    const r = await matchLine(
      line({
        description: 'ULTRATECH OPC 53 GRADE 50KG',
        brand: 'UltraTech',
        grade: '53',
        packSize: '50 KG',
        unitId: U.BAG,
      }),
      ctx,
      catalogOf([cement, tmt12]),
    );
    expect(r.status).toBe('MATCHED');
    expect(r.materialId).toBe(cement.id);
    expect(r.method).toBe('NORMALISED');
    expect(r.requiresConfirmation).toBe(false);
  });

  it('an exact name wins outright', async () => {
    const r = await matchLine(
      line({ description: 'opc cement 53 grade', unitId: U.BAG }),
      ctx,
      catalogOf([cement]),
    );
    expect(r).toMatchObject({
      status: 'MATCHED',
      method: 'EXACT',
      score: 1,
      requiresConfirmation: false,
    });
  });

  it('never merges steel sizes: 12 mm on the document does not match the 16 mm material', async () => {
    const r = await matchLine(
      line({ description: 'TMT FE550 12MM', grade: 'Fe 550', size: '12 mm', unitId: U.MT }),
      ctx,
      catalogOf([tmt16]),
    );
    expect(r.status).toBe('NEW_MATERIAL');
    expect(r.materialId).toBeNull();
    expect(r.conflicts).toEqual([{ key: 'SIZE', line: '12MM', material: '16MM' }]);
    // The lookalike is still shown, with its conflict.
    expect(r.candidates[0]).toMatchObject({ materialId: tmt16.id });
    expect(r.candidates[0]!.conflicts).toHaveLength(1);
  });

  it('picks the right size when both exist', async () => {
    const r = await matchLine(
      line({ description: 'TMT FE550 12MM', grade: 'Fe 550', size: '12 mm', unitId: U.MT }),
      ctx,
      catalogOf([tmt12, tmt16]),
    );
    expect(r.status).toBe('MATCHED');
    expect(r.materialId).toBe(tmt12.id);
  });

  it('sends GI FITTING HEAVY to review with the three sizes as candidates', async () => {
    const r = await matchLine(
      line({ description: 'GI FITTING HEAVY', unitId: U.NOS }),
      ctx,
      catalogOf(gi),
    );
    expect(r.status).toBe('REVIEW_REQUIRED');
    expect(r.materialId).toBeNull();
    expect(r.ambiguous).toBe(true);
    expect(r.candidates.map((c) => c.materialId).sort()).toEqual(gi.map((g) => g.id).sort());
  });

  it('asks the LLM only when candidates are too close, and treats its answer as a suggestion', async () => {
    const tieBreak = vi.fn(async () => ({ materialId: gi[1]!.id, confidence: 0.99 }));
    const ambiguous = await matchLine(
      line({ description: 'GI FITTING HEAVY', unitId: U.NOS }),
      ctx,
      catalogOf(gi),
      tieBreak,
    );
    expect(tieBreak).toHaveBeenCalledTimes(1);
    expect(ambiguous).toMatchObject({
      status: 'MATCHED',
      method: 'AI_TIEBREAK',
      materialId: gi[1]!.id,
      requiresConfirmation: true,
    });
    expect(ambiguous.score).toBeLessThan(DEFAULT_THRESHOLDS.auto);

    tieBreak.mockClear();
    await matchLine(
      line({ description: 'OPC Cement 53 Grade', unitId: U.BAG }),
      ctx,
      catalogOf([cement, ...gi]),
      tieBreak,
    );
    expect(tieBreak).not.toHaveBeenCalled();
  });

  it('ignores an LLM answer that is not one of the offered candidates', async () => {
    const r = await matchLine(
      line({ description: 'GI FITTING HEAVY', unitId: U.NOS }),
      ctx,
      catalogOf(gi),
      async () => ({ materialId: 'made-up-id', confidence: 1 }),
    );
    expect(r.status).toBe('REVIEW_REQUIRED');
  });

  it('a material that states a size the line does not is never a high-confidence match', async () => {
    const r = await matchLine(
      line({ description: 'TMT Steel', unitId: U.MT }),
      ctx,
      catalogOf([tmt12]),
    );
    expect(r.status).toBe('MATCHED');
    expect(r.requiresConfirmation).toBe(true);
    expect(r.candidates[0]!.missingSpecs).toContain('SIZE');
  });

  it('a unit that cannot be converted disqualifies the candidate', async () => {
    const r = await matchLine(
      line({ description: 'OPC Cement 53 Grade', unitId: U.CFT }),
      ctx,
      catalogOf([cement]),
    );
    expect(r.status).toBe('NEW_MATERIAL');
    expect(r.conflicts).toEqual([{ key: 'UNIT', line: 'CFT', material: 'BAG' }]);
  });

  it('an approved conversion is not a conflict (steel invoiced in KG, stocked in MT)', async () => {
    const r = await matchLine(
      line({ description: 'TMT Steel 12mm Fe 550', unitId: U.KG }),
      ctx,
      catalogOf([tmt12]),
    );
    expect(r.status).toBe('MATCHED');
  });

  it('a different brand goes to a new material; no brand on the material matches any brand', async () => {
    const acc = material({
      name: 'PPC Cement',
      brand: 'ACC',
      categoryId: 'c-cement',
      categoryName: 'Cement',
      stockUnitId: U.BAG,
      stockUnitCode: 'BAG',
    });
    const r = await matchLine(
      line({ description: 'ULTRATECH PPC 50KG', brand: 'UltraTech', unitId: U.BAG }),
      ctx,
      catalogOf([acc]),
    );
    expect(r.status).toBe('NEW_MATERIAL');
    expect(r.conflicts[0]).toMatchObject({ key: 'BRAND' });
  });

  it('proposes a new material when nothing is similar, without inventing a pack size', async () => {
    const r = await matchLine(
      line({
        description: 'Ultra OPC53 300 bg',
        suggestedName: 'OPC Cement 53 Grade',
        category: 'cement',
        grade: '53',
        unitId: U.BAG,
      }),
      ctx,
      catalogOf([tmt12]),
    );
    expect(r.status).toBe('NEW_MATERIAL');
    expect(r.proposal).toMatchObject({
      name: 'OPC Cement 53 Grade',
      categoryId: 'c-cement',
      stockUnitId: U.BAG,
      packSize: null,
      packUnitId: null,
    });
  });
});

describe('supplier mappings (PRD §9)', () => {
  const key = `sup-1:${normalise('ULTR OPC53 50KG')}`;

  it('reuses a confirmed mapping first', async () => {
    const r = await matchLine(
      line({ description: 'ULTR OPC53 50KG', unitId: U.BAG }),
      ctx,
      catalogOf([cement, tmt12], { [key]: cement }),
    );
    expect(r).toMatchObject({
      status: 'MATCHED',
      method: 'SUPPLIER_MAPPING',
      score: 1,
      materialId: cement.id,
      requiresConfirmation: false,
    });
  });

  it('asks for review when the mapping now conflicts with the line (PRD §9.3 step 6)', async () => {
    const mapKey = `sup-1:${normalise('TMT FE550 12MM')}`;
    const r = await matchLine(
      line({ description: 'TMT FE550 12MM', size: '12 mm', unitId: U.MT }),
      ctx,
      catalogOf([tmt16], { [mapKey]: tmt16 }),
    );
    expect(r.status).toBe('REVIEW_REQUIRED');
    expect(r.materialId).toBeNull();
    expect(r.conflicts).toEqual([{ key: 'SIZE', line: '12MM', material: '16MM' }]);
  });

  it("does not use another supplier's mapping", async () => {
    const r = await matchLine(
      line({ description: 'ULTR OPC53 50KG', unitId: U.BAG }),
      { ...ctx, supplierId: 'sup-2' },
      catalogOf([tmt12], { [key]: cement }),
    );
    expect(r.method).not.toBe('SUPPLIER_MAPPING');
  });
});

describe('buildProposal and conflictsWith', () => {
  it('keeps a printed pack size and drops one that is just the stock unit', () => {
    const withPack = buildProposal(
      line({ description: 'PPC 50KG', packSize: '50 KG', unitId: U.BAG }),
      ctx,
    );
    expect(withPack).toMatchObject({ packSize: '50', packUnitId: U.KG });
    const noPack = buildProposal(
      line({ description: 'Binding wire', packSize: '25 KG', unitId: U.KG }),
      ctx,
    );
    expect(noPack).toMatchObject({ packSize: null, packUnitId: null });
  });

  it('leaves the unit empty when the document unit is not in the unit master (Brass)', () => {
    expect(
      buildProposal(line({ description: 'River sand', unitId: null }), ctx).stockUnitId,
    ).toBeNull();
  });

  it('reports conflicts for a manual choice', () => {
    expect(
      conflictsWith(line({ description: 'TMT 12mm', size: '12mm', unitId: U.MT }), tmt16, ctx),
    ).toEqual([{ key: 'SIZE', line: '12MM', material: '16MM' }]);
    expect(
      conflictsWith(line({ description: 'TMT 16mm', size: '16mm', unitId: U.MT }), tmt16, ctx),
    ).toEqual([]);
  });
});
