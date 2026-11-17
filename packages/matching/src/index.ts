import {
  type CatalogMaterial,
  type ConversionContext,
  type MatchCandidate,
  type MatchConflict,
  type MatchContext,
  type MatchLineInput,
  type MatchMethod,
  type MatchResult,
  type MaterialCatalog,
  type ProposedMaterial,
  SIMILAR_NAME_THRESHOLD,
  type SpecSet,
  type TieBreaker,
  compareSpecs,
  convert,
  nameSimilarity,
  normalise,
  parsePackSize,
  profileMaterial,
} from '@kavach/shared';

/**
 * Material matching engine (PRD §7.3 steps 5–6, §8.2, §22.3; ARCHITECTURE §7.3).
 *
 * Order: supplier mapping → exact name → normalised name → database search → (semantic, when the
 * catalog offers it) → AI tie-break between close candidates → propose a new material.
 * The LLM is asked only when earlier steps leave several valid candidates too close to call.
 *
 * Hard validation runs on every candidate at every step, supplier mappings included: a size,
 * grade, pack, brand or unit conflict disqualifies the candidate from selection whatever its
 * score (PRD §8.2: a 99% match with the wrong diameter is still rejected).
 *
 * Pure logic: the Material Master is read through the `MaterialCatalog` port.
 */

/** Candidates this close to the best one make the line ambiguous. */
export const AMBIGUITY_MARGIN = 0.05;
/** A match that leaves one of the material's specs unstated is never "high confidence". */
export const MISSING_SPEC_CAP = 0.85;
/** An AI tie-break is a suggestion: the user always confirms it. */
export const TIEBREAK_CAP = 0.94;
const MAX_CANDIDATES = 5;
const SEARCH_LIMIT = 60;

interface LineView {
  tokens: string[];
  suggestedTokens: string[];
  specs: SpecSet;
  brand: string;
}

function packOf(line: MatchLineInput, ctx: MatchContext) {
  return parsePackSize(line.packSize, ctx.units);
}

/** The line seen "as if" it were a material of the candidate's category, so the same words drop out. */
function viewLine(line: MatchLineInput, ctx: MatchContext, categoryName: string | null): LineView {
  const pack = packOf(line, ctx);
  const base = {
    categoryId: '',
    categoryName,
    brand: line.brand,
    grade: line.grade,
    size: line.size,
    stockUnitId: '',
    packSize: pack?.size ?? null,
    packUnitCode: pack?.unit.code ?? null,
  };
  const fromDescription = profileMaterial({ ...base, name: line.description });
  const suggested = line.suggestedName
    ? profileMaterial({
        ...base,
        name: line.suggestedName,
        grade: null,
        size: null,
        packSize: null,
      })
    : null;
  return {
    tokens: fromDescription.coreTokens,
    suggestedTokens: suggested?.coreTokens ?? [],
    // Specs come from what the document says, never from the model's suggested name.
    specs: fromDescription.specs,
    brand: fromDescription.brand,
  };
}

function profileOf(m: CatalogMaterial) {
  return profileMaterial({
    name: m.name,
    categoryId: m.categoryId,
    categoryName: m.categoryName,
    brand: m.brand,
    grade: m.grade,
    size: m.size,
    specification: m.specification,
    stockUnitId: m.stockUnitId,
    packSize: m.packSize,
    packUnitId: m.packUnitId,
    packUnitCode: m.packUnitCode,
  });
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((t) => set.has(t));
}

function unitConflict(
  line: MatchLineInput,
  m: CatalogMaterial,
  ctx: MatchContext,
): MatchConflict | null {
  if (!line.unitId || line.unitId === m.stockUnitId) return null;
  const conversion: ConversionContext = {
    units: new Map(ctx.units.map((u) => [u.id, { id: u.id, decimalPlaces: u.decimalPlaces }])),
    conversions: ctx.conversions,
    material: {
      id: m.id,
      stockUnitId: m.stockUnitId,
      packSize: m.packSize,
      packUnitId: m.packUnitId,
      isVariableWeight: m.isVariableWeight,
    },
    // Receipts may use a material's own approved conversions (DECISIONS Q10).
    allowMaterialSpecific: true,
  };
  const result = convert('1', line.unitId, m.stockUnitId, conversion);
  // "Not representable" depends on the quantity (25 kg of a 50 kg bag); it is checked at review.
  if (result.ok || result.reason === 'NOT_REPRESENTABLE') return null;
  const lineUnit = ctx.units.find((u) => u.id === line.unitId)?.code ?? '?';
  return { key: 'UNIT', line: lineUnit, material: m.stockUnitCode };
}

/** Scores one material against the line and lists everything that speaks against it. */
export function assessCandidate(
  line: MatchLineInput,
  m: CatalogMaterial,
  ctx: MatchContext,
): MatchCandidate | null {
  const view = viewLine(line, ctx, m.categoryName);
  const profile = profileOf(m);

  const normDescription = normalise(line.description);
  const normSuggested = normalise(line.suggestedName);
  const normName = normalise(m.name);

  const nameScore = Math.max(
    nameSimilarity(view.tokens, profile.coreTokens),
    nameSimilarity(view.suggestedTokens, profile.coreTokens),
  );

  let method: MatchMethod;
  let score: number;
  if (normDescription === normName) {
    method = 'EXACT';
    score = 1;
  } else if (
    normSuggested === normName ||
    sameSet(view.tokens, profile.coreTokens) ||
    sameSet(view.suggestedTokens, profile.coreTokens)
  ) {
    method = 'NORMALISED';
    score = 0.97;
  } else {
    if (nameScore < SIMILAR_NAME_THRESHOLD) return null;
    method = 'DB_SEARCH';
    score = Math.min(nameScore, 0.94);
  }

  const conflicts: MatchConflict[] = compareSpecs(view.specs, profile.specs).map((c) => ({
    key: c.key,
    line: c.a,
    material: c.b,
  }));
  // A material with no brand matches any brand; two different brands are different materials (Q9).
  if (profile.brand && view.brand && profile.brand !== view.brand) {
    conflicts.push({ key: 'BRAND', line: view.brand, material: profile.brand });
  }
  const unit = unitConflict(line, m, ctx);
  if (unit) conflicts.push(unit);

  const missingSpecs: string[] = [];
  for (const key of Object.keys(profile.specs) as (keyof SpecSet)[]) {
    if (view.specs[key] === undefined) missingSpecs.push(key);
  }
  if (profile.brand && !view.brand && !normDescription.includes(profile.brand)) {
    missingSpecs.push('BRAND');
  }
  if (missingSpecs.length > 0 && method !== 'EXACT') score = Math.min(score, MISSING_SPEC_CAP);

  return {
    materialId: m.id,
    code: m.code,
    name: m.name,
    categoryName: m.categoryName,
    stockUnitCode: m.stockUnitCode,
    score: Math.round(score * 10000) / 10000,
    method,
    conflicts,
    missingSpecs,
  };
}

/** Prepares a new Material Master record from the line (PRD §7.3 step 6 B). Nothing is invented. */
export function buildProposal(line: MatchLineInput, ctx: MatchContext): ProposedMaterial {
  const wanted = normalise(line.category);
  const category = wanted
    ? (ctx.categories.find((c) => normalise(c.name) === wanted) ??
      ctx.categories.find((c) => {
        const n = normalise(c.name);
        return n.includes(wanted) || wanted.includes(n);
      }))
    : undefined;

  const pack = packOf(line, ctx);
  // A pack in the stock unit itself ("500 KG" of something stocked in KG) is not a pack size.
  const usePack = pack !== null && pack.unit.id !== line.unitId;

  return {
    name: (line.suggestedName ?? line.description).trim().slice(0, 160),
    categoryId: category?.id ?? null,
    brand: line.brand,
    specification: line.specification,
    grade: line.grade,
    size: line.size,
    stockUnitId: line.unitId,
    packSize: usePack ? pack.size : null,
    packUnitId: usePack ? pack.unit.id : null,
    isVariableWeight: false,
    confirmNotDuplicate: false,
  };
}

function searchTokens(line: MatchLineInput, ctx: MatchContext): string[] {
  const view = viewLine(line, ctx, null);
  const all = [...view.tokens, ...view.suggestedTokens];
  return [...new Set(all)].filter((t) => t.length >= 2 && !/^\d+(\.\d+)?$/.test(t)).slice(0, 8);
}

function byScore(a: MatchCandidate, b: MatchCandidate): number {
  return b.score - a.score || a.name.localeCompare(b.name);
}

export async function matchLine(
  line: MatchLineInput,
  ctx: MatchContext,
  catalog: MaterialCatalog,
  tieBreak?: TieBreaker,
): Promise<MatchResult> {
  const proposal = buildProposal(line, ctx);
  const base = { proposal, ambiguous: false };
  const normDescription = normalise(line.description);

  // 1. Confirmed supplier mapping (PRD §9.3). It is still validated: step 6 of §9.3.
  if (ctx.supplierId && normDescription) {
    const hit = await catalog.findSupplierMapping(ctx.supplierId, normDescription);
    if (hit && hit.material.status === 'ACTIVE') {
      const candidate: MatchCandidate = {
        materialId: hit.material.id,
        code: hit.material.code,
        name: hit.material.name,
        categoryName: hit.material.categoryName,
        stockUnitCode: hit.material.stockUnitCode,
        score: 1,
        method: 'SUPPLIER_MAPPING',
        conflicts: conflictsWith(line, hit.material, ctx),
        missingSpecs: [],
      };
      if (candidate.conflicts.length === 0) {
        return {
          ...base,
          status: 'MATCHED',
          method: 'SUPPLIER_MAPPING',
          score: 1,
          materialId: candidate.materialId,
          requiresConfirmation: false,
          candidates: [candidate],
          conflicts: [],
        };
      }
      return {
        ...base,
        status: 'REVIEW_REQUIRED',
        method: 'SUPPLIER_MAPPING',
        score: null,
        materialId: null,
        requiresConfirmation: true,
        candidates: [candidate],
        conflicts: candidate.conflicts,
      };
    }
  }

  // 2–4. Exact name, normalised name, database search. One query set, scored in memory.
  const names = [...new Set([normDescription, normalise(line.suggestedName)].filter(Boolean))];
  const tokens = searchTokens(line, ctx);
  const found = new Map<string, CatalogMaterial>();
  for (const m of names.length > 0 ? await catalog.findByNormalizedName(names) : [])
    found.set(m.id, m);
  for (const m of tokens.length > 0 ? await catalog.searchByTokens(tokens, SEARCH_LIMIT) : []) {
    found.set(m.id, m);
  }
  // 5. Semantic search, when the catalog provides it and nothing else was found.
  if (found.size === 0 && catalog.searchSemantic) {
    for (const m of await catalog.searchSemantic(line.description, 10)) found.set(m.id, m);
  }

  const assessed: MatchCandidate[] = [];
  for (const m of found.values()) {
    if (m.status !== 'ACTIVE') continue;
    const c = assessCandidate(line, m, ctx);
    if (c) assessed.push(c);
  }
  assessed.sort(byScore);
  const valid = assessed.filter((c) => c.conflicts.length === 0);
  const shown = [...valid, ...assessed.filter((c) => c.conflicts.length > 0)].slice(
    0,
    MAX_CANDIDATES,
  );

  // 7. Nothing valid: a new material. Lookalikes with a different spec are listed, never merged.
  if (valid.length === 0) {
    return {
      ...base,
      status: 'NEW_MATERIAL',
      method: null,
      score: null,
      materialId: null,
      requiresConfirmation: true,
      candidates: shown,
      conflicts: assessed[0]?.conflicts ?? [],
    };
  }

  const best = valid[0]!;
  const close = valid.filter((c) => best.score - c.score <= AMBIGUITY_MARGIN);
  const exactWins =
    best.method === 'EXACT' && close.filter((c) => c.method === 'EXACT').length === 1;

  if (close.length > 1 && !exactWins) {
    // 6. AI-assisted choice between the close candidates only.
    if (tieBreak) {
      const choice = await tieBreak(line, close);
      const chosen = choice?.materialId
        ? close.find((c) => c.materialId === choice.materialId)
        : null;
      if (chosen && choice && choice.confidence >= ctx.thresholds.confirm) {
        return {
          ...base,
          status: 'MATCHED',
          method: 'AI_TIEBREAK',
          score: Math.min(choice.confidence, TIEBREAK_CAP),
          materialId: chosen.materialId,
          requiresConfirmation: true,
          candidates: shown,
          conflicts: [],
          ambiguous: true,
        };
      }
    }
    return {
      ...base,
      status: 'REVIEW_REQUIRED',
      method: null,
      score: null,
      materialId: null,
      requiresConfirmation: true,
      candidates: shown,
      conflicts: [],
      ambiguous: true,
    };
  }

  if (best.score >= ctx.thresholds.confirm) {
    return {
      ...base,
      status: 'MATCHED',
      method: best.method,
      score: best.score,
      materialId: best.materialId,
      requiresConfirmation: best.score < ctx.thresholds.auto,
      candidates: shown,
      conflicts: [],
    };
  }

  return {
    ...base,
    status: 'REVIEW_REQUIRED',
    method: null,
    score: best.score,
    materialId: null,
    requiresConfirmation: true,
    candidates: shown,
    conflicts: [],
  };
}

function unitOnly(line: MatchLineInput, m: CatalogMaterial, ctx: MatchContext): MatchConflict[] {
  const unit = unitConflict(line, m, ctx);
  return unit ? [unit] : [];
}

/**
 * Conflicts between a line and the material the user picked by hand. Shown as a warning: the
 * user may decide the document is simply written differently, but never without seeing it.
 */
export function conflictsWith(
  line: MatchLineInput,
  m: CatalogMaterial,
  ctx: MatchContext,
): MatchConflict[] {
  const view = viewLine(line, ctx, m.categoryName);
  const profile = profileOf(m);
  const conflicts: MatchConflict[] = compareSpecs(view.specs, profile.specs).map((c) => ({
    key: c.key,
    line: c.a,
    material: c.b,
  }));
  if (profile.brand && view.brand && profile.brand !== view.brand) {
    conflicts.push({ key: 'BRAND', line: view.brand, material: profile.brand });
  }
  return [...conflicts, ...unitOnly(line, m, ctx)];
}
