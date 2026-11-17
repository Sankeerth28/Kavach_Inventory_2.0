import type { ConfidenceThresholds } from './extraction';
import type { ConversionRow } from './units';

/**
 * Types shared by the matching engine (`packages/matching`), its catalog implementation over
 * Prisma (`packages/db`) and the API. The engine itself has no I/O: it reads the Material Master
 * through the `MaterialCatalog` port (ARCHITECTURE §3.3).
 */
export const MATCH_STATUSES = ['MATCHED', 'NEW_MATERIAL', 'REVIEW_REQUIRED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const MATCH_METHODS = [
  'SUPPLIER_MAPPING',
  'EXACT',
  'NORMALISED',
  'DB_SEARCH',
  'SEMANTIC',
  'AI_TIEBREAK',
  'MANUAL',
] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** A Material Master row as the matcher sees it. */
export interface CatalogMaterial {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName: string;
  brand: string | null;
  grade: string | null;
  size: string | null;
  specification: string | null;
  stockUnitId: string;
  stockUnitCode: string;
  packSize: string | null;
  packUnitId: string | null;
  packUnitCode: string | null;
  isVariableWeight: boolean;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MappingHit {
  mappingId: string;
  material: CatalogMaterial;
}

/** Read access to one project's Material Master and supplier mappings. */
export interface MaterialCatalog {
  /** A CONFIRMED mapping for this supplier and normalised description (PRD §9). */
  findSupplierMapping(
    supplierId: string,
    normalizedDescription: string,
  ): Promise<MappingHit | null>;
  /** Materials whose normalised name equals one of `names`. */
  findByNormalizedName(names: string[]): Promise<CatalogMaterial[]>;
  /** Materials whose normalised name contains any of `tokens`. */
  searchByTokens(tokens: string[], limit: number): Promise<CatalogMaterial[]>;
  /** Optional semantic search (PRD §22.3 step 5). Not provided in the MVP. */
  searchSemantic?(text: string, limit: number): Promise<CatalogMaterial[]>;
}

export interface CatalogUnit {
  id: string;
  code: string;
  name: string;
  symbol: string;
  aliases: string[];
  decimalPlaces: number;
}

export interface CatalogCategory {
  id: string;
  name: string;
}

/** One document line, as extracted or as edited by the user. */
export interface MatchLineInput {
  description: string;
  suggestedName: string | null;
  brand: string | null;
  category: string | null;
  specification: string | null;
  grade: string | null;
  size: string | null;
  /** As printed: "50 KG". */
  packSize: string | null;
  /** The document unit resolved against the unit master, or null when it is unknown. */
  unitId: string | null;
}

export interface MatchContext {
  supplierId: string | null;
  units: CatalogUnit[];
  conversions: ConversionRow[];
  categories: CatalogCategory[];
  thresholds: ConfidenceThresholds;
}

export interface MatchConflict {
  /** SIZE, GRADE, PACK, BRAND or UNIT. */
  key: string;
  /** What the document line says. */
  line: string;
  /** What the material says. */
  material: string;
}

export interface MatchCandidate {
  materialId: string;
  code: string;
  name: string;
  categoryName: string;
  stockUnitCode: string;
  score: number;
  method: MatchMethod;
  /** Any conflict disqualifies the candidate from automatic selection (PRD §8.2). */
  conflicts: MatchConflict[];
  /** Specs the material states and the line does not: the line may be a different variant. */
  missingSpecs: string[];
}

/** A new Material Master record prepared from a document line (PRD §7.3 step 6 B). A draft. */
export interface ProposedMaterial {
  name: string;
  categoryId: string | null;
  brand: string | null;
  specification: string | null;
  grade: string | null;
  size: string | null;
  stockUnitId: string | null;
  packSize: string | null;
  packUnitId: string | null;
  isVariableWeight: boolean;
  /** The user saw a similar existing material and says this one is different (PRD §6.5). */
  confirmNotDuplicate: boolean;
}

export interface MatchResult {
  status: MatchStatus;
  method: MatchMethod | null;
  score: number | null;
  /** Pre-selected material: only for MATCHED. */
  materialId: string | null;
  /** MATCHED in the 70–94% band: the user must tick the line (DECISIONS Q13). */
  requiresConfirmation: boolean;
  /** Best candidates, valid or not, best first. */
  candidates: MatchCandidate[];
  /** Why the best lookalike was not selected. */
  conflicts: MatchConflict[];
  /** Filled for NEW_MATERIAL. */
  proposal: ProposedMaterial | null;
  /** True when several valid candidates were too close to call without help. */
  ambiguous: boolean;
}

/** Asks an LLM to choose between close candidates. Returns a candidate id or null. */
export type TieBreaker = (
  line: MatchLineInput,
  candidates: MatchCandidate[],
) => Promise<{ materialId: string | null; confidence: number } | null>;
