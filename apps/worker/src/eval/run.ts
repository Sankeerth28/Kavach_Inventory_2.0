import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SYSTEM_UNITS } from '@kavach/db';
import { matchLine } from '@kavach/matching';
import {
  type CatalogMaterial,
  type CatalogUnit,
  DEFAULT_THRESHOLDS,
  ExtractionResultSchema,
  type MatchContext,
  type MaterialCatalog,
  type UploadMimeType,
  normalise,
  resolveUnit,
  sniffMimeType,
} from '@kavach/shared';
import { createExtractor, repoRoot } from '../config';
import { ExtractorError, type PageInput } from '../extractors/document-extractor';
import { ExpectedDocumentSchema } from '../extractors/expected-format';
import { assessImage, prepareImage } from '../pipeline/quality';
import { toMatchLine } from '../pipeline/process-invoice';
import {
  type DocumentScore,
  METRICS,
  type Tally,
  percent,
  scoreDocument,
  summarise,
} from './score';

/**
 * Accuracy eval (PRD §29): runs the quality check, the extractor and the matcher over a folder of
 * documents with answer keys and reports each kind of field separately (§29.2).
 *
 *   pnpm --filter @kavach/worker eval                      # the provider from .env
 *   pnpm --filter @kavach/worker eval -- --provider fixture
 *   pnpm --filter @kavach/worker eval -- --dir ../../my-docs --only ch-
 *
 * It needs no database and writes nothing but a JSON report under .local/eval/.
 * With a real provider it sends the documents in the folder to that provider and costs money:
 * run it on demand, not on every commit. With `--provider fixture` it only checks the harness.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CATEGORIES = [
  'Cement',
  'Steel',
  'Sand and Aggregate',
  'Bricks and Blocks',
  'Electrical',
  'Plumbing',
  'Tiles and Flooring',
  'Paint and Finishing',
  'Hardware',
  'Safety Equipment',
  'Tools and Equipment',
  'Other Materials',
];

/** A tiny Material Master, so the "review required" case (PRD §7.3 step 6 C) can be exercised. */
const SEED: CatalogMaterial[] = ['1 Inch', '1.5 Inch', '2 Inch'].map((size, i) => ({
  id: `seed-gi-${i}`,
  code: `MAT-00000${i + 1}`,
  name: `GI Fitting ${size}`,
  categoryId: 'Hardware',
  categoryName: 'Hardware',
  brand: null,
  grade: null,
  size: null,
  specification: null,
  stockUnitId: 'NOS',
  stockUnitCode: 'NOS',
  packSize: null,
  packUnitId: null,
  packUnitCode: null,
  isVariableWeight: false,
  status: 'ACTIVE',
}));

const catalog: MaterialCatalog = {
  findSupplierMapping: async () => null,
  findByNormalizedName: async (names) => SEED.filter((m) => names.includes(normalise(m.name))),
  searchByTokens: async (tokens) =>
    SEED.filter((m) => tokens.some((t) => normalise(m.name).includes(t))),
};

async function main(): Promise<void> {
  try {
    process.loadEnvFile(path.join(repoRoot(), '.env'));
  } catch {
    // The environment may already be set.
  }
  const provider = arg('provider');
  if (provider) process.env.AI_PROVIDER = provider;
  const dir = path.resolve(arg('dir') ?? path.join(repoRoot(), 'test-docs'));
  const only = arg('only');
  const extractor = createExtractor();
  if (extractor.provider === 'none') {
    throw new Error('No AI provider configured. Set OPENAI_API_KEY, or pass --provider fixture.');
  }

  const units: CatalogUnit[] = SYSTEM_UNITS.map((u) => ({
    id: u.code,
    code: u.code,
    name: u.name,
    symbol: u.symbol,
    aliases: u.aliases,
    decimalPlaces: u.decimalPlaces,
  }));
  const ctx: MatchContext = {
    supplierId: null,
    units,
    conversions: [],
    categories: CATEGORIES.map((name) => ({ id: name, name })),
    thresholds: DEFAULT_THRESHOLDS,
  };
  const hints = { units: units.map((u) => u.name), categories: CATEGORIES };

  const keys = readdirSync(dir)
    .filter((n) => n.endsWith('.expected.json') && (!only || n.includes(only)))
    .sort();
  if (keys.length === 0) throw new Error(`No *.expected.json answer keys in ${dir}`);
  console.log(`Evaluating ${keys.length} document(s) from ${dir}`);
  console.log(
    `Provider: ${extractor.provider} / ${extractor.model} (prompt ${extractor.promptVersion})\n`,
  );

  const scores: DocumentScore[] = [];
  const outcome: Tally = { correct: 0, total: 0 };
  const failures: string[] = [];
  for (const key of keys) {
    const expected = ExpectedDocumentSchema.parse(
      JSON.parse(readFileSync(path.join(dir, key), 'utf8')),
    );
    const data = readFileSync(path.join(dir, expected._meta.file));
    const mimeType = sniffMimeType(data.subarray(0, 16)) as UploadMimeType | null;
    if (!mimeType) {
      failures.push(`${expected._meta.file}: not a JPG, PNG or PDF`);
      continue;
    }
    const wantPass = expected.expected_quality_check === 'PASS';

    // Step 1: the same quality check the pipeline runs before any AI call.
    const measured = mimeType === 'application/pdf' ? null : await assessImage(data);
    if (measured && !measured.ok) {
      const score = scoreDocument(
        expected,
        { ...EMPTY, quality: { readable: false, issues: measured.issues, note: null } },
        units,
      );
      scores.push(score);
      console.log(
        `${expected._meta.file.padEnd(14)} stopped by the quality check (${measured.issues.join(', ')}) — ${wantPass ? 'WRONG' : 'as expected'}`,
      );
      continue;
    }

    const page: PageInput = {
      pageNo: 1,
      mimeType: mimeType === 'application/pdf' ? mimeType : 'image/jpeg',
      pageCount: 1,
      data: mimeType === 'application/pdf' ? data : await prepareImage(data),
      sha256: createHash('sha256').update(data).digest('hex'),
    };
    const started = Date.now();
    try {
      const res = await extractor.extract([page], hints);
      const parsed = ExtractionResultSchema.safeParse(res.raw);
      if (!parsed.success) {
        failures.push(
          `${expected._meta.file}: output did not fit the schema (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message})`,
        );
        continue;
      }
      const score = scoreDocument(expected, parsed.data, units);
      scores.push(score);

      // Steps 5–6: matching outcome against the answer key's hint.
      for (const [i, item] of expected.items.entries()) {
        const line = parsed.data.lines[i];
        if (!line || !wantPass) continue;
        const unit = resolveUnit(line.unit.value, units);
        const result = await matchLine(toMatchLine(line, unit?.id ?? null), ctx, catalog);
        const want = item.expected_match_hint ?? 'NEW_OR_MATCHED';
        const ok =
          want === 'REVIEW_REQUIRED'
            ? result.status === 'REVIEW_REQUIRED'
            : result.status !== 'REVIEW_REQUIRED';
        outcome.total += 1;
        if (ok) outcome.correct += 1;
        else score.mistakes.push(`line ${i + 1} outcome: expected ${want}, got ${result.status}`);
      }
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `${expected._meta.file.padEnd(14)} ${score.linesExtracted}/${score.linesExpected} lines, ${score.mistakes.length} mistake(s), ${secs}s`,
      );
      for (const m of score.mistakes) console.log(`    - ${m}`);
    } catch (e) {
      failures.push(
        `${expected._meta.file}: ${e instanceof ExtractorError ? `${e.code} ${e.message}` : String(e)}`,
      );
    }
  }

  const s = summarise(scores);
  console.log('\n── Accuracy by field (PRD §29.2) ─────────────────────────');
  const labels: Record<(typeof METRICS)[number], string> = {
    supplier: '1. Supplier',
    invoiceNumber: '2. Invoice number',
    invoiceDate: '3. Invoice date',
    description: '4. Material description',
    quantity: '5. Quantity',
    unit: '6. Unit',
    specification: '7. Specification',
  };
  for (const m of METRICS) console.log(`${labels[m].padEnd(28)} ${percent(s.metrics[m])}`);
  console.log(
    `${'8–9. Match / new / review'.padEnd(28)} ${percent(outcome)}   (against a 3-material test master)`,
  );
  console.log(`${'Quality check'.padEnd(28)} ${percent(s.quality)}`);
  console.log(`${'Lines found'.padEnd(28)} ${s.linesExtracted} of ${s.linesExpected}`);
  console.log(`${'Uncertain fields flagged'.padEnd(28)} ${percent(s.uncertaintyFlagged)}`);
  console.log(`${'Invented values'.padEnd(28)} ${s.invented}   (must be 0: PRD §12.4)`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} document(s) could not be evaluated:`);
    for (const f of failures) console.log(`  - ${f}`);
  }

  const out = path.join(repoRoot(), '.local', 'eval');
  mkdirSync(out, { recursive: true });
  const file = path.join(
    out,
    `eval-${extractor.provider}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(
    file,
    JSON.stringify(
      {
        provider: extractor.provider,
        model: extractor.model,
        promptVersion: extractor.promptVersion,
        summary: s,
        matchOutcome: outcome,
        failures,
        documents: scores,
      },
      null,
      2,
    ),
  );
  console.log(`\nReport: ${file}`);
  if (extractor.provider === 'fixture') {
    console.log(
      'Note: the fixture provider answers from the answer keys. These numbers check the harness, not the AI.',
    );
  }
}

const emptyField = { value: null, confidence: 0, legible: true };
const EMPTY = {
  documentType: 'UNKNOWN' as const,
  handwritten: false,
  header: {
    supplierName: emptyField,
    supplierAddress: emptyField,
    gstin: emptyField,
    invoiceNo: emptyField,
    invoiceDate: emptyField,
    challanNo: emptyField,
    invoiceTotal: emptyField,
    taxDetails: emptyField,
  },
  lines: [],
};

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
