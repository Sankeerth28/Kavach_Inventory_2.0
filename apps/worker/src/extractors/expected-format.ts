import type { ExtractedField, ExtractionResult } from '@kavach/shared';
import { z } from 'zod';

/**
 * The answer-key format of `test-docs/*.expected.json` (PRD §29.1 "manually verified expected
 * results as ground truth"). Used by the accuracy eval and by the offline fixture extractor.
 */
const nullable = <T extends z.ZodType>(t: T) => t.nullable().optional();
const numberish = nullable(z.union([z.number(), z.string()]));

export const ExpectedDocumentSchema = z.object({
  _meta: z.object({
    file: z.string(),
    document_type: z.string(),
    purpose: z.string().optional(),
  }),
  expected_quality_check: z.enum(['PASS', 'FAIL_RECAPTURE']),
  expected_duplicate_of: z.string().optional(),
  header: z.object({
    supplier_name: nullable(z.string()),
    supplier_address: nullable(z.string()),
    gstin: nullable(z.string()),
    invoice_number: nullable(z.string()),
    invoice_date: nullable(z.string()),
    challan_number: nullable(z.string()),
    invoice_total: numberish,
  }),
  items: z.array(
    z.object({
      invoice_description: z.string(),
      suggested_name: nullable(z.string()),
      category: nullable(z.string()),
      brand: nullable(z.string()),
      specification: nullable(z.string()),
      grade: nullable(z.string()),
      size: nullable(z.string()),
      pack_size: nullable(z.string()),
      quantity: numberish,
      unit: nullable(z.string()),
      unit_price: numberish,
      line_total: numberish,
      hsn_code: nullable(z.string()),
      expected_match_hint: z.string().optional(),
      uncertain_fields: z.array(z.string()).optional(),
    }),
  ),
});
export type ExpectedDocument = z.infer<typeof ExpectedDocumentSchema>;

/** "Fe550D (not written)" in an answer key means the document does not say it: the truth is null. */
export function expectedText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (/\(not written\)/i.test(v)) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

export function expectedNumber(v: number | string | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  // Answer keys hold small decimals; print without float noise.
  return String(Math.round(n * 10000) / 10000);
}

const f = <T>(value: T | null, uncertain = false): ExtractedField<T> =>
  value === null
    ? { value: null, confidence: 0, legible: true }
    : { value, confidence: uncertain ? 0.5 : 0.98, legible: !uncertain };

/** Turns an answer key into the extractor's output format: what a perfect reading would return. */
export function expectedToExtraction(doc: ExpectedDocument): ExtractionResult {
  const type = doc._meta.document_type;
  const fail = doc.expected_quality_check === 'FAIL_RECAPTURE';
  const invoiceNo = expectedText(doc.header.invoice_number);
  const challanNo = expectedText(doc.header.challan_number);
  return {
    documentType: type.includes('challan')
      ? invoiceNo
        ? 'INVOICE_WITH_CHALLAN'
        : 'CHALLAN'
      : type === 'invoice'
        ? 'INVOICE'
        : 'UNKNOWN',
    handwritten: type.includes('challan'),
    quality: fail
      ? {
          readable: false,
          issues: ['BLURRY', 'POOR_LIGHTING'],
          note: 'The photo is too blurred and dark to read. Retake it in better light.',
        }
      : { readable: true, issues: [], note: null },
    header: {
      supplierName: f(expectedText(doc.header.supplier_name)),
      supplierAddress: f(expectedText(doc.header.supplier_address)),
      gstin: f(expectedText(doc.header.gstin)),
      invoiceNo: f(invoiceNo),
      invoiceDate: f(expectedText(doc.header.invoice_date)),
      challanNo: f(challanNo),
      invoiceTotal: f(expectedNumber(doc.header.invoice_total)),
      taxDetails: f<string>(null),
    },
    lines: fail
      ? []
      : doc.items.map((it, i) => {
          const unsure = new Set(it.uncertain_fields ?? []);
          return {
            lineNo: i + 1,
            page: 1,
            description: f(it.invoice_description),
            suggestedName: f(expectedText(it.suggested_name), unsure.has('suggested_name')),
            brand: f(expectedText(it.brand)),
            category: f(expectedText(it.category)),
            specification: f(expectedText(it.specification)),
            grade: f(expectedText(it.grade), unsure.has('grade')),
            size: f(expectedText(it.size), unsure.has('size')),
            packSize: f(expectedText(it.pack_size), unsure.has('pack_size')),
            quantity: f(expectedNumber(it.quantity), unsure.has('quantity')),
            unit: f(expectedText(it.unit), unsure.has('unit')),
            unitPrice: f(expectedNumber(it.unit_price)),
            lineTotal: f(expectedNumber(it.line_total)),
            hsn: f(expectedText(it.hsn_code)),
          };
        }),
  };
}
