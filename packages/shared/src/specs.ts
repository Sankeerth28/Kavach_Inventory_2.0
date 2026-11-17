import { canonicalNumber, normalise } from './normalise';

/**
 * Structured attributes used for specification-conflict checks (PRD §6.5, §8.2; CLAUDE.md AI rules).
 * A conflict on any key means two materials are different, whatever their names look like.
 */
export const SPEC_KEYS = ['SIZE', 'GRADE', 'PACK'] as const;
export type SpecKey = (typeof SPEC_KEYS)[number];
export type SpecSet = Partial<Record<SpecKey, string>>;

export interface SpecSource {
  name: string;
  grade?: string | null;
  size?: string | null;
  packSize?: string | null;
  packUnitCode?: string | null;
}

export interface ParsedSpecs {
  specs: SpecSet;
  /** The normalised name with size, grade and pack tokens removed: what the material *is*. */
  coreName: string;
}

export interface SpecConflict {
  key: SpecKey | 'UNIT' | 'BRAND' | 'SPECIFICATION';
  a: string;
  b: string;
}

const NUM = '\\d+(?:\\.\\d+)?';
const B = '(?<![\\p{L}\\p{N}.])';
const E = '(?![\\p{L}\\p{N}])';

const SIZE_RE = new RegExp(`${B}((?:${NUM} X )*${NUM}) (SQMM|MM|CM|M|INCH|FT)${E}`, 'gu');
const PACK_RE = new RegExp(`${B}(${NUM}) (KG|G|L|ML)${E}`, 'gu');
const GRADE_RES: ReadonlyArray<{
  re: RegExp;
  token: (m: RegExpExecArray) => string;
  blank: number;
}> = [
  // FE550D (already canonicalised by normalise)
  { re: new RegExp(`${B}(FE\\d{3}(?:SD|D|S)?)${E}`, 'gu'), token: (m) => m[1]!, blank: 0 },
  // OPC 53, PPC 43: the cement type stays in the name, the number is the grade
  { re: new RegExp(`${B}(?:OPC|PPC|PSC) (\\d{2})${E}`, 'gu'), token: (m) => m[1]!, blank: 1 },
  { re: new RegExp(`${B}(\\d{2,3}) GRADE${E}`, 'gu'), token: (m) => m[1]!, blank: 0 },
  { re: new RegExp(`${B}GRADE (\\d{2,3})${E}`, 'gu'), token: (m) => m[1]!, blank: 0 },
  // Concrete / mortar mix: M20, M25
  { re: new RegExp(`${B}(M\\d{2})${E}`, 'gu'), token: (m) => m[1]!, blank: 0 },
  // Pipe classes: SDR 11, PN 10, CLASS 3, SCH 40
  {
    re: new RegExp(`${B}(SDR|PN|CLASS|SCH) ?(${NUM})${E}`, 'gu'),
    token: (m) => `${m[1]!}${canonicalNumber(m[2]!)}`,
    blank: 0,
  },
];

function sizeToken(dims: string, unit: string): string {
  const parts = dims
    .split(' X ')
    .map(canonicalNumber)
    .sort((x, y) => Number(x) - Number(y));
  return `${parts.join('X')}${unit}`;
}

function uniqueJoined(tokens: string[]): string | undefined {
  if (tokens.length === 0) return undefined;
  return [...new Set(tokens)].sort().join('|');
}

/** Collects matches of `re` in `text` and blanks the matched span (or one group of it). */
function harvest(
  text: string,
  re: RegExp,
  onMatch: (m: RegExpExecArray) => void,
  blankGroup = 0,
): string {
  let out = text;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    onMatch(m);
    const piece = m[blankGroup]!;
    const start = blankGroup === 0 ? m.index : m.index + m[0].lastIndexOf(piece);
    out = out.slice(0, start) + ' '.repeat(piece.length) + out.slice(start + piece.length);
  }
  return out;
}

function gradeTokens(text: string): { tokens: string[]; rest: string } {
  const tokens: string[] = [];
  let rest = text;
  for (const { re, token, blank } of GRADE_RES) {
    rest = harvest(rest, re, (m) => tokens.push(token(m)), blank);
  }
  return { tokens, rest };
}

/**
 * Derives the comparable spec set of a material from its name and its size / grade / pack fields.
 * Never guesses: a key is present only when the text states it.
 */
export function parseSpecs(src: SpecSource): ParsedSpecs {
  const sizes: string[] = [];
  const grades: string[] = [];
  const packs: string[] = [];

  // Name: pull out size, grade and pack tokens; what is left is the core name.
  let name = normalise(src.name);
  name = harvest(name, SIZE_RE, (m) => sizes.push(sizeToken(m[1]!, m[2]!)));
  // Packs before grades: in "OPC 53 GRADE 50 KG" the 50 belongs to the pack, not to "GRADE 50".
  name = harvest(name, PACK_RE, (m) => packs.push(`${canonicalNumber(m[1]!)}${m[2]!}`));
  const g = gradeTokens(name);
  grades.push(...g.tokens);
  const coreName = g.rest.replace(/\s+/g, ' ').trim();

  // Size field: "12mm", "230 x 110 x 75 mm"; a value with no unit is kept as written.
  const sizeField = normalise(src.size);
  if (sizeField) {
    const found: string[] = [];
    harvest(sizeField, SIZE_RE, (m) => found.push(sizeToken(m[1]!, m[2]!)));
    sizes.push(...(found.length > 0 ? found : [sizeField.replace(/ /g, '')]));
  }

  // Grade field: "Fe 550D", "53", "OPC 53", "M20".
  const gradeField = normalise(src.grade);
  if (gradeField) {
    const found = gradeTokens(gradeField).tokens;
    grades.push(
      ...(found.length > 0 ? found : [gradeField.replace(/GRADE/g, '').replace(/ /g, '')]),
    );
  }

  // Pack fields win over anything in the name: they are what the admin approved (PRD §12.4).
  let pack = uniqueJoined(packs);
  if (src.packSize && src.packUnitCode) {
    pack = `${canonicalNumber(src.packSize)}${normalise(src.packUnitCode).replace(/ /g, '')}`;
  }

  const specs: SpecSet = {};
  const size = uniqueJoined(sizes);
  const grade = uniqueJoined(grades.filter((t) => t.length > 0));
  if (size) specs.SIZE = size;
  if (grade) specs.GRADE = grade;
  if (pack) specs.PACK = pack;
  return { specs, coreName };
}

/** Keys stated on both sides with different values. A key missing on one side is not a conflict. */
export function compareSpecs(a: SpecSet, b: SpecSet): SpecConflict[] {
  const conflicts: SpecConflict[] = [];
  for (const key of SPEC_KEYS) {
    const av = a[key];
    const bv = b[key];
    if (av !== undefined && bv !== undefined && av !== bv) conflicts.push({ key, a: av, b: bv });
  }
  return conflicts;
}
