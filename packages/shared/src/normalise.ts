/**
 * Text normalisation used for every `normalized_*` column and for material comparison
 * (ARCHITECTURE §4.2). Pure and deterministic: the same function runs in api, worker, web and mobile.
 */

/** Unit spellings that follow a number, mapped to one canonical token. Longest spellings first. */
const UNIT_CANON: ReadonlyArray<readonly [pattern: string, canon: string]> = [
  ['SQ ?MM', 'SQMM'],
  ['KILOGRAMS?|KGS?', 'KG'],
  ['GRAMS?|GMS?|G', 'G'],
  ['TONNES?|TONS?|MT', 'MT'],
  ['MILLIMETERS?|MILLIMETRES?|MM', 'MM'],
  ['CENTIMETERS?|CENTIMETRES?|CM', 'CM'],
  ['METERS?|METRES?|MTRS?|M', 'M'],
  ['INCH(?:ES)?', 'INCH'],
  ['FEET|FT', 'FT'],
  ['MILLILITERS?|MILLILITRES?|ML', 'ML'],
  ['LITERS?|LITRES?|LTRS?|L', 'L'],
  ['BAGS?', 'BAG'],
];

const UNIT_RULES = UNIT_CANON.map(
  ([pattern, canon]) =>
    [new RegExp(`(\\d) ?(?:${pattern})(?![\\p{L}\\p{N}])`, 'gu'), canon] as const,
);

/**
 * Upper-cases, applies NFKC, turns punctuation into spaces (a dot survives only inside a number),
 * and canonicalises unit and grade spellings: `50KG` / `50 kgs` → `50 KG`, `Fe-550 D` → `FE550D`,
 * `230x110x75mm` → `230 X 110 X 75 MM`.
 */
export function normalise(input: string | null | undefined): string {
  if (!input) return '';
  let s = input.normalize('NFKC').toUpperCase();
  s = s.replace(/[×*]/g, 'X');
  s = s.replace(/[^\p{L}\p{N}.]+/gu, ' ');
  s = s.replace(/(?<!\d)\.|\.(?!\d)/g, ' ');
  // Dimension separators: 230X110X75 → 230 X 110 X 75
  s = s.replace(/(\d) ?X ?(?=\d)/g, '$1 X ');
  // Steel grades: FE 550 D → FE550D
  s = s.replace(/(?<![\p{L}\p{N}])FE ?(\d{3})(?: ?(SD|D|S))?(?![\p{L}\p{N}])/gu, 'FE$1$2');
  for (const [re, canon] of UNIT_RULES) {
    s = s.replace(re, `$1 ${canon}`);
  }
  return s.replace(/\s+/g, ' ').trim();
}

/** `12.0` → `12`, `2.50` → `2.5`, `012` → `12`. Input must be a plain decimal string. */
export function canonicalNumber(n: string): string {
  let s = n.replace(/^0+(?=\d)/, '');
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}

/** Normalised login identifier: lower-cased e-mail. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalised phone: digits only, with a leading country code 91 or 0 removed from 11–12 digit numbers. */
export function normalisePhone(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
