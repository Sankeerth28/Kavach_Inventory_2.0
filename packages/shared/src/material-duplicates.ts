import { normalise } from './normalise';
import { type SpecConflict, type SpecSet, compareSpecs, parseSpecs } from './specs';

/**
 * Duplicate material detection (PRD §6.5). Pure logic; the API supplies the candidate rows.
 *
 * Rules:
 * - Same identity → EXACT. Creation is blocked.
 * - Similar name and no conflicting attribute → POSSIBLE_DUPLICATE. The user must confirm.
 * - Similar name but a conflicting size, grade, pack, unit, brand or specification → DIFFERENT_SPEC.
 *   These are separate materials and are never merged on name similarity (TMT 12 mm vs 16 mm).
 */
export interface MaterialIdentityInput {
  name: string;
  categoryId: string;
  /** Used only to drop the category word from the name ("Cement" in "OPC Cement"). */
  categoryName?: string | null;
  brand?: string | null;
  grade?: string | null;
  size?: string | null;
  specification?: string | null;
  stockUnitId: string;
  packSize?: string | null;
  packUnitId?: string | null;
  packUnitCode?: string | null;
}

export type DuplicateVerdict = 'EXACT' | 'POSSIBLE_DUPLICATE' | 'DIFFERENT_SPEC';

export interface DuplicateAssessment {
  verdict: DuplicateVerdict;
  /** 0–1 similarity of the core names. */
  nameScore: number;
  conflicts: SpecConflict[];
}

export interface MaterialProfile {
  identity: string;
  coreTokens: string[];
  specs: SpecSet;
  brand: string;
  specification: string;
  stockUnitId: string;
}

/** Names scoring below this are unrelated and are not reported at all. */
export const SIMILAR_NAME_THRESHOLD = 0.6;

const NOISE = new Set(['GRADE', 'OF', 'AND', 'THE', 'FOR', 'WITH', 'TYPE', 'SIZE', 'NO', 'DIA']);

function singular(token: string): string {
  return token.length > 3 && token.endsWith('S') && !token.endsWith('SS')
    ? token.slice(0, -1)
    : token;
}

function tokens(text: string): string[] {
  return text
    .split(' ')
    .filter((t) => t.length > 0)
    .map(singular);
}

export function profileMaterial(input: MaterialIdentityInput): MaterialProfile {
  const { specs, coreName } = parseSpecs({
    name: input.name,
    grade: input.grade,
    size: input.size,
    packSize: input.packSize,
    packUnitCode: input.packUnitCode,
  });
  const brand = normalise(input.brand);
  const specification = normalise(input.specification);

  const all = tokens(coreName).filter((t) => !NOISE.has(t));
  const drop = new Set([...tokens(normalise(input.categoryName)), ...tokens(brand)]);
  const core = all.filter((t) => !drop.has(t));
  const coreTokens = [...new Set(core.length > 0 ? core : all)];

  // Identity: what makes two records the same material (DECISIONS Q9, Q11). The name takes part
  // without its size / grade / pack tokens, so "TMT Steel 12mm" equals "TMT Steel" + size "12 mm".
  const identity = [
    input.categoryId,
    tokens(coreName).join(' '),
    brand,
    specs.GRADE ?? '',
    specs.SIZE ?? '',
    specs.PACK ?? '',
    specification,
    input.stockUnitId,
  ].join('|');

  return { identity, coreTokens, specs, brand, specification, stockUnitId: input.stockUnitId };
}

/** 0–1. Mixes the overlap coefficient (handles extra words such as a brand in the name) with Jaccard. */
export function nameSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = a.filter((t) => setB.has(t)).length;
  if (shared === 0) return 0;
  const overlap = shared / Math.min(a.length, b.length);
  const jaccard = shared / (a.length + b.length - shared);
  return Math.round((0.6 * overlap + 0.4 * jaccard) * 1000) / 1000;
}

/** Compares a proposed material with one existing material. Returns null when they are unrelated. */
export function assessDuplicate(
  proposed: MaterialProfile,
  existing: MaterialProfile,
): DuplicateAssessment | null {
  if (proposed.identity === existing.identity) {
    return { verdict: 'EXACT', nameScore: 1, conflicts: [] };
  }
  const nameScore = nameSimilarity(proposed.coreTokens, existing.coreTokens);
  if (nameScore < SIMILAR_NAME_THRESHOLD) return null;

  const conflicts: SpecConflict[] = compareSpecs(proposed.specs, existing.specs);
  if (proposed.stockUnitId !== existing.stockUnitId) {
    conflicts.push({ key: 'UNIT', a: proposed.stockUnitId, b: existing.stockUnitId });
  }
  // A material with no brand matches any brand; two different brands are different materials (Q9).
  if (proposed.brand && existing.brand && proposed.brand !== existing.brand) {
    conflicts.push({ key: 'BRAND', a: proposed.brand, b: existing.brand });
  }
  if (
    proposed.specification &&
    existing.specification &&
    proposed.specification !== existing.specification
  ) {
    conflicts.push({ key: 'SPECIFICATION', a: proposed.specification, b: existing.specification });
  }
  return {
    verdict: conflicts.length > 0 ? 'DIFFERENT_SPEC' : 'POSSIBLE_DUPLICATE',
    nameScore,
    conflicts,
  };
}
