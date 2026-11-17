import {
  type CatalogUnit,
  DEFAULT_THRESHOLDS,
  Decimal,
  type ExtractedField,
  type ExtractionResult,
  fieldNeedsReview,
  normalise,
  normaliseDocumentNo,
  resolveUnit,
} from '@kavach/shared';
import { type ExpectedDocument, expectedNumber, expectedText } from '../extractors/expected-format';

/**
 * Accuracy scoring against manually verified ground truth (PRD §29.1, §29.2).
 * Each kind of field is measured on its own: "Do not rely on one overall AI accuracy percentage."
 */
export const METRICS = [
  'supplier',
  'invoiceNumber',
  'invoiceDate',
  'description',
  'quantity',
  'unit',
  'specification',
] as const;
export type Metric = (typeof METRICS)[number];

export interface Tally {
  correct: number;
  total: number;
}

export interface DocumentScore {
  file: string;
  /** Did the quality check agree with the answer key (pass, or ask for a better image)? */
  qualityCorrect: boolean;
  /** Lines the answer key has and the extraction returned. */
  linesExpected: number;
  linesExtracted: number;
  metrics: Record<Metric, Tally>;
  /** Fields the answer key marks uncertain that the extraction also flagged for review. */
  uncertaintyFlagged: Tally;
  /** Values returned where the document states none (PRD §12.4: nothing may be invented). */
  invented: { line: number; field: string; value: string }[];
  mistakes: string[];
}

const tally = (): Tally => ({ correct: 0, total: 0 });

/** The synthetic test documents mark their fictional suppliers "(Sample)": not part of the name. */
const plain = (s: string | null): string => normalise(s?.replace(/\(sample\)/gi, '') ?? null);

const sameText = (a: string | null, b: string | null): boolean => plain(a) === plain(b);

function sameNumber(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  try {
    return new Decimal(a).equals(new Decimal(b));
  } catch {
    return false;
  }
}

function sameUnit(a: string | null, b: string | null, units: readonly CatalogUnit[]): boolean {
  if (a === null || b === null) return a === b;
  const ua = resolveUnit(a, units);
  const ub = resolveUnit(b, units);
  if (ua || ub) return ua?.id === ub?.id;
  return sameText(a, b);
}

const LENGTH_UNITS = new Set(['M', 'MM', 'CM']);

/**
 * "12mm" = "12 MM"; "Fe 550D" = "FE550D"; "50 KG" = "50kg". A unit or qualifier that only one
 * side writes is not a difference ("600x600" = "600x600mm", "12 IN" = "12 inch",
 * "120" = "120 grit"): the numbers are what identify the spec. Different length units are.
 */
function sameSpec(a: string | null, b: string | null): boolean {
  const x = normalise(a).replace(/ /g, '');
  const y = normalise(b).replace(/ /g, '');
  if (x === y) return true;
  if (!x || !y) return false;
  const digits = (s: string) => s.replace(/[^0-9.X]/g, '').replace(/X+$/, '');
  const words = (s: string) => s.replace(/[0-9.]/g, '').replace(/X/g, '');
  if (digits(x) !== digits(y) || digits(x) === '') return false;
  const [wx, wy] = [words(x), words(y)];
  if (wx === '' || wy === '') return true;
  if (LENGTH_UNITS.has(wx) && LENGTH_UNITS.has(wy)) return false;
  return wx.startsWith(wy) || wy.startsWith(wx);
}

const v = <T>(f: ExtractedField<T> | undefined): T | null => f?.value ?? null;

export function scoreDocument(
  expected: ExpectedDocument,
  actual: ExtractionResult,
  units: readonly CatalogUnit[],
): DocumentScore {
  const metrics = Object.fromEntries(METRICS.map((m) => [m, tally()])) as Record<Metric, Tally>;
  const mistakes: string[] = [];
  const invented: DocumentScore['invented'] = [];
  const uncertaintyFlagged = tally();

  const check = (metric: Metric, ok: boolean, what: string, want: unknown, got: unknown) => {
    metrics[metric].total += 1;
    if (ok) metrics[metric].correct += 1;
    else mistakes.push(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  const wantPass = expected.expected_quality_check === 'PASS';
  const qualityCorrect = actual.quality.readable === wantPass;
  if (!qualityCorrect) {
    mistakes.push(
      `quality: expected ${expected.expected_quality_check}, got readable=${actual.quality.readable}`,
    );
  }
  const base = {
    file: expected._meta.file,
    qualityCorrect,
    linesExpected: wantPass ? expected.items.length : 0,
    linesExtracted: actual.lines.length,
    metrics,
    uncertaintyFlagged,
    invented,
    mistakes,
  };
  // An unreadable document is judged on the quality check alone.
  if (!wantPass) return base;

  const h = expected.header;
  check(
    'supplier',
    sameText(expectedText(h.supplier_name), v(actual.header.supplierName)),
    'supplier',
    h.supplier_name,
    v(actual.header.supplierName),
  );
  check(
    'invoiceNumber',
    normaliseDocumentNo(expectedText(h.invoice_number)) ===
      normaliseDocumentNo(v(actual.header.invoiceNo)),
    'invoice number',
    h.invoice_number,
    v(actual.header.invoiceNo),
  );
  check(
    'invoiceDate',
    expectedText(h.invoice_date) === v(actual.header.invoiceDate),
    'invoice date',
    h.invoice_date,
    v(actual.header.invoiceDate),
  );

  expected.items.forEach((item, i) => {
    const line = actual.lines[i];
    const at = `line ${i + 1}`;
    if (!line) {
      // A lost line counts against every line-level metric.
      for (const m of ['description', 'quantity', 'unit', 'specification'] as const)
        metrics[m].total += 1;
      mistakes.push(`${at}: missing ("${item.invoice_description}")`);
      return;
    }
    check(
      'description',
      sameText(item.invoice_description, v(line.description)),
      `${at} description`,
      item.invoice_description,
      v(line.description),
    );
    check(
      'quantity',
      sameNumber(expectedNumber(item.quantity), v(line.quantity)),
      `${at} quantity`,
      item.quantity,
      v(line.quantity),
    );
    check(
      'unit',
      sameUnit(expectedText(item.unit), v(line.unit), units),
      `${at} unit`,
      item.unit,
      v(line.unit),
    );

    const specs = [
      ['grade', expectedText(item.grade), v(line.grade)],
      ['size', expectedText(item.size), v(line.size)],
      ['packSize', expectedText(item.pack_size), v(line.packSize)],
    ] as const;
    check(
      'specification',
      specs.every(([, want, got]) => sameSpec(want, got)),
      `${at} specification`,
      Object.fromEntries(specs.map(([k, want]) => [k, want])),
      Object.fromEntries(specs.map(([k, , got]) => [k, got])),
    );
    for (const [field, want, got] of specs) {
      if (want === null && got !== null) invented.push({ line: i + 1, field, value: got });
    }

    const fieldOf: Record<string, ExtractedField<unknown> | undefined> = {
      quantity: line.quantity,
      unit: line.unit,
      grade: line.grade,
      size: line.size,
      pack_size: line.packSize,
      suggested_name: line.suggestedName,
    };
    for (const name of item.uncertain_fields ?? []) {
      const f = fieldOf[name];
      if (!f) continue;
      uncertaintyFlagged.total += 1;
      // Flagged = the user would be shown it: unreadable, low confidence, left empty, or (for a
      // unit) not in the unit master, which the review screen always stops on.
      const unknownUnit = name === 'unit' && resolveUnit(v(line.unit), units) === null;
      if (fieldNeedsReview(f, DEFAULT_THRESHOLDS) || f.value === null || unknownUnit) {
        uncertaintyFlagged.correct += 1;
      } else {
        mistakes.push(`${at}: "${name}" should have been flagged as uncertain`);
      }
    }
  });
  if (actual.lines.length > expected.items.length) {
    mistakes.push(
      `${actual.lines.length - expected.items.length} extra line(s) that are not on the document`,
    );
  }
  return base;
}

export interface Summary {
  documents: number;
  quality: Tally;
  linesExpected: number;
  linesExtracted: number;
  metrics: Record<Metric, Tally>;
  uncertaintyFlagged: Tally;
  invented: number;
}

export function summarise(scores: readonly DocumentScore[]): Summary {
  const metrics = Object.fromEntries(METRICS.map((m) => [m, tally()])) as Record<Metric, Tally>;
  const quality = tally();
  const uncertaintyFlagged = tally();
  let linesExpected = 0;
  let linesExtracted = 0;
  let invented = 0;
  for (const s of scores) {
    quality.total += 1;
    if (s.qualityCorrect) quality.correct += 1;
    linesExpected += s.linesExpected;
    linesExtracted += s.linesExtracted;
    invented += s.invented.length;
    uncertaintyFlagged.correct += s.uncertaintyFlagged.correct;
    uncertaintyFlagged.total += s.uncertaintyFlagged.total;
    for (const m of METRICS) {
      metrics[m].correct += s.metrics[m].correct;
      metrics[m].total += s.metrics[m].total;
    }
  }
  return {
    documents: scores.length,
    quality,
    linesExpected,
    linesExtracted,
    metrics,
    uncertaintyFlagged,
    invented,
  };
}

export const percent = (t: Tally): string =>
  t.total === 0 ? 'n/a' : `${((100 * t.correct) / t.total).toFixed(1)}% (${t.correct}/${t.total})`;
