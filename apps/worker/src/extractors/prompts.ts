import { DOCUMENT_TYPES, QUALITY_ISSUES } from '@kavach/shared';
import type { ExtractionHints } from './document-extractor';

/**
 * Versioned prompts (ARCHITECTURE §7.4). `PROMPT_VERSION` is written to every AI log row, so a
 * change in behaviour can be traced to a change in wording. Bump it whenever the text changes.
 */
export const PROMPT_VERSION = 'extract-v2';
export const TIEBREAK_PROMPT_VERSION = 'tiebreak-v1';

export const EXTRACTION_SYSTEM_PROMPT = `You read supplier invoices and delivery challans from Indian construction sites for an inventory system.
The documents may be printed, handwritten, or printed forms filled in by hand, photographed with a phone, and may run over several pages.

Return ONLY the JSON object described by the schema. Rules:

1. Read what is written. Never guess, complete or "correct" a value from general knowledge.
2. If a value is not written on the document, return value null with confidence 0. This matters most for pack size, grade, size and unit: a missing pack size must stay null even when the usual pack is obvious (cement is NOT assumed to be 50 KG).
3. Every field carries its own confidence from 0 to 1: how sure you are that you read THIS field correctly. Do not copy one number to every field.
4. Set legible to false when text is present but cannot be read reliably: smudged, overwritten, struck through and rewritten, or ambiguous digits (1/7, 0/6, 5/6, 3/8). Still give your best reading as the value, with a low confidence.
5. If a quantity was struck out and rewritten, use the value that was left standing, and mark it legible false with confidence at most 0.6.
6. description is the material text of the line exactly as written, including abbreviations and spelling, but WITHOUT the quantity, unit, rate and amount (those have their own fields; on a handwritten line "Red bricks 9x4x3 8000 nos" the description is "Red bricks 9x4x3"). suggestedName is a clean standard material name built only from what the line says (e.g. "ULTRATECH OPC 53 GRADE 50KG" -> "OPC Cement 53 Grade").
7. Keep different sizes, diameters and grades as separate lines exactly as on the document. Never merge lines.
8. quantity, unitPrice, lineTotal and invoiceTotal are plain decimal strings without commas or currency symbols ("2500", "2.5", "192500.00").
9. unit is the unit as written for the quantity. If it matches one of the known units, use that spelling; otherwise keep the document's own word (for example "Brass"). Never convert quantities between units.
10. packSize is the content of ONE pack of a packaged material (bag, box, tin, drum, bottle, roll, coil, bundle), as printed, with its unit: "50 KG" bag, "20 L" drum, "237 ML" tin, "90 M" coil. Do not derive it. The length, diameter or dimensions of a single pipe, bar, sheet, tile, brick or fitting ("25MM", "3MTR", "600x600") are size or specification, never packSize. Never put the same value in both size and packSize.
10a. size carries its unit only if the document writes one ("12 inch", "25mm"); do not add a unit that is not written.
11. invoiceDate is the date of the document, as YYYY-MM-DD. On a delivery challan the challan date is the invoiceDate. Indian documents write day first (09/11/2026 and 9-11-26 are 9 November 2026).
12. Read every page and return every material line in document order, numbered from 1. page is the page the line is on.
13. documentType: INVOICE (tax invoice), CHALLAN (delivery challan, no invoice number), INVOICE_WITH_CHALLAN (one document carrying both), UNKNOWN.
14. quality.readable is false only when the image is so blurred, dark, cropped or small that the material lines cannot be read at all. Handwriting alone is never a reason. List the problems you see in quality.issues, and in quality.note say in one short plain sentence what the user should do (for example "Retake the photo in better light").
15. If pages seem to be missing (page 2 of 3, totals that refer to lines not present), add MISSING_PAGES to quality.issues.
16. Regional-language text: transliterate material names to English in suggestedName, keep the original in description.`;

export function extractionUserPrompt(hints: ExtractionHints, pageCount: number): string {
  return [
    `The document has ${pageCount} page(s), attached in order.`,
    `Known units: ${hints.units.join(', ')}.`,
    `Material categories used on this project: ${hints.categories.join(', ')}. Use one of these for category when it clearly fits, otherwise null.`,
    'Extract the header and every material line.',
  ].join('\n');
}

export function repairPrompt(errors: string[]): string {
  return [
    'Your previous answer did not fit the required schema. Problems:',
    ...errors.slice(0, 20).map((e) => `- ${e}`),
    'Read the document again and return a corrected JSON object. Do not invent values to satisfy the schema: use null where the document does not say.',
  ].join('\n');
}

export const TIEBREAK_SYSTEM_PROMPT = `You help match one line of a supplier document to a Material Master record.
You are given the line and a short list of candidate materials. Choose the candidate that is the SAME material, or null.

Rules:
- Answer with one of the given candidate ids, or null. Never answer with any other id.
- A different size, diameter, grade, thickness, class or pack size is a DIFFERENT material: answer null rather than pick the nearest one.
- If the line does not say enough to tell the candidates apart, answer null.
- confidence is how sure you are, from 0 to 1.`;

// ── JSON schemas for structured output ──────────────────────────────────────
// Hand-written in the subset that strict structured output accepts: every property is required,
// no additional properties, optional values are expressed as null. The zod schema in
// packages/shared remains the authority; the answer is validated against it on receipt.

type Json = Record<string, unknown>;

const fieldSchema = (valueType: 'string' = 'string'): Json => ({
  type: 'object',
  additionalProperties: false,
  required: ['value', 'confidence', 'legible'],
  properties: {
    value: { type: [valueType, 'null'] },
    confidence: { type: 'number' },
    legible: { type: 'boolean' },
  },
});

const objectOf = (properties: Record<string, Json>): Json => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const HEADER_FIELDS = [
  'supplierName',
  'supplierAddress',
  'gstin',
  'invoiceNo',
  'invoiceDate',
  'challanNo',
  'invoiceTotal',
  'taxDetails',
] as const;

const LINE_FIELDS = [
  'description',
  'suggestedName',
  'brand',
  'category',
  'specification',
  'grade',
  'size',
  'packSize',
  'quantity',
  'unit',
  'unitPrice',
  'lineTotal',
  'hsn',
] as const;

export const EXTRACTION_JSON_SCHEMA: Json = objectOf({
  documentType: { type: 'string', enum: [...DOCUMENT_TYPES] },
  handwritten: { type: 'boolean' },
  quality: objectOf({
    readable: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string', enum: [...QUALITY_ISSUES] } },
    note: { type: ['string', 'null'] },
  }),
  header: objectOf(Object.fromEntries(HEADER_FIELDS.map((f) => [f, fieldSchema()]))),
  lines: {
    type: 'array',
    items: objectOf({
      lineNo: { type: 'integer' },
      page: { type: ['integer', 'null'] },
      ...Object.fromEntries(LINE_FIELDS.map((f) => [f, fieldSchema()])),
    }),
  },
});

export const TIEBREAK_JSON_SCHEMA: Json = objectOf({
  materialId: { type: ['string', 'null'] },
  confidence: { type: 'number' },
  reason: { type: ['string', 'null'] },
});
