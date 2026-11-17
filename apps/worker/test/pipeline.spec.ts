import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type PrismaClient,
  createPrismaClient,
  createProject,
  formatMaterialCode,
  nextSequenceValue,
  withProjectScope,
} from '@kavach/db';
import {
  type ExtractionResult,
  type ProposedMaterial,
  normalise,
  profileMaterial,
  sniffMimeType,
} from '@kavach/shared';
import { LocalStorage, invoicePageKey } from '@kavach/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type DocumentExtractor,
  ExtractorError,
  type ExtractorResponse,
} from '../src/extractors/document-extractor';
import { FixtureExtractor } from '../src/extractors/fixture.extractor';
import {
  MAX_ATTEMPTS,
  type PipelineDeps,
  claimNext,
  processInvoice,
  reapStaleClaims,
} from '../src/pipeline/process-invoice';
import { purgeExpiredDocuments } from '../src/pipeline/retention';

const DOCS = path.resolve(__dirname, '../../../test-docs');

let raw: PrismaClient;
let db: PrismaClient;
let storage: LocalStorage;
let storageDir: string;
let fixture: FixtureExtractor;
let counter = 0;

interface Site {
  projectId: string;
  storeId: string;
  userId: string;
  unit: (code: string) => string;
  category: (name: string) => string;
}

async function site(): Promise<Site> {
  counter += 1;
  const tag = `${Date.now().toString(36)}${counter}`.toUpperCase();
  const project = await raw.$transaction((tx) =>
    createProject(tx, { code: `W${tag}`, name: `Worker test ${tag}` }),
  );
  const store = await raw.store.findFirstOrThrow({ where: { projectId: project.id } });
  const user = await raw.user.create({
    data: { name: 'Store Manager', email: `sm.${tag.toLowerCase()}@test.local`, passwordHash: 'x' },
  });
  const units = await raw.unit.findMany({ where: { projectId: null } });
  const categories = await raw.materialCategory.findMany({ where: { projectId: project.id } });
  return {
    projectId: project.id,
    storeId: store.id,
    userId: user.id,
    unit: (code) => units.find((u) => u.code === code)!.id,
    category: (name) => categories.find((c) => c.name === name)!.id,
  };
}

async function upload(s: Site, file: string, opts: { override?: boolean } = {}): Promise<string> {
  const data = await readFile(path.join(DOCS, file));
  const mimeType = sniffMimeType(data.subarray(0, 16))!;
  const sha256 = createHash('sha256').update(data).digest('hex');
  const invoice = await raw.invoice.create({
    data: {
      projectId: s.projectId,
      storeId: s.storeId,
      uploadedById: s.userId,
      status: 'QUEUED',
      qualityOverridden: opts.override ?? false,
      documentFingerprint: sha256,
    },
  });
  const key = invoicePageKey(s.projectId, invoice.id, 1, mimeType);
  await storage.put(key, data);
  await raw.invoicePage.create({
    data: {
      projectId: s.projectId,
      invoiceId: invoice.id,
      pageNo: 1,
      storageKey: key,
      mimeType,
      sizeBytes: data.length,
      sha256,
    },
  });
  return invoice.id;
}

async function addMaterial(
  s: Site,
  m: { name: string; category: string; unit: string; grade?: string; size?: string },
): Promise<string> {
  const categoryId = s.category(m.category);
  const stockUnitId = s.unit(m.unit);
  const profile = profileMaterial({
    name: m.name,
    categoryId,
    categoryName: m.category,
    grade: m.grade,
    size: m.size,
    stockUnitId,
  });
  const row = await raw.$transaction(async (tx) =>
    tx.material.create({
      data: {
        projectId: s.projectId,
        code: formatMaterialCode(await nextSequenceValue(tx, s.projectId, 'MATERIAL')),
        name: m.name,
        normalizedName: normalise(m.name),
        categoryId,
        grade: m.grade ?? null,
        size: m.size ?? null,
        stockUnitId,
        creationSource: 'MANUAL',
        identityKey: createHash('sha256').update(profile.identity).digest('hex'),
        createdById: s.userId,
      },
    }),
  );
  return row.id;
}

const deps = (extractor: DocumentExtractor = fixture): PipelineDeps => ({ db, storage, extractor });

async function run(invoiceId: string, extractor?: DocumentExtractor) {
  const claim = await claimNext(db, invoiceId);
  if (!claim) throw new Error('nothing to claim');
  return processInvoice(deps(extractor), claim);
}

const load = (id: string) =>
  raw.invoice.findUniqueOrThrow({
    where: { id },
    include: { items: { orderBy: { lineNo: 'asc' } }, aiLogs: true, pages: true },
  });

/** An extractor that answers from a script: errors are thrown, anything else is returned raw. */
function scripted(...answers: unknown[]): DocumentExtractor & { calls: number } {
  const state = {
    provider: 'scripted',
    model: 'scripted',
    promptVersion: 'test',
    calls: 0,
    async extract(): Promise<ExtractorResponse> {
      const next = answers[Math.min(state.calls, answers.length - 1)];
      state.calls += 1;
      if (next instanceof Error) throw next;
      return { raw: next, model: 'scripted', inputTokens: 10, outputTokens: 20 };
    },
    async resolveCandidates(): Promise<ExtractorResponse> {
      return {
        raw: { materialId: null, confidence: 0, reason: null },
        model: 'scripted',
        inputTokens: 1,
        outputTokens: 1,
      };
    },
  };
  return state;
}

beforeAll(async () => {
  raw = createPrismaClient();
  db = withProjectScope(raw) as unknown as PrismaClient;
  storageDir = await mkdtemp(path.join(os.tmpdir(), 'kavach-worker-'));
  storage = new LocalStorage(storageDir);
  fixture = new FixtureExtractor(DOCS);
});

afterAll(async () => {
  await raw.$disconnect();
  await rm(storageDir, { recursive: true, force: true });
});

describe('document pipeline (PRD §7.3, §10.2 screen 2)', () => {
  it('knows the sample documents', () => {
    expect(fixture.size).toBe(12);
  });

  it('reads a printed invoice into a draft: header, lines, per-field confidence, new-material proposals', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    expect(await run(id)).toBe('READY_FOR_REVIEW');

    const inv = await load(id);
    expect(inv).toMatchObject({
      status: 'READY_FOR_REVIEW',
      stage: 'DONE',
      documentType: 'INVOICE',
      supplierId: null,
      supplierNameRaw: 'Sai Krupa Cement Agencies (Sample)',
      supplierGstinRaw: '27ABCDE1234F1Z5',
      invoiceNo: 'SKC/26-27/1045',
      normalizedInvoiceNo: 'SKC26271045',
      challanNo: '1045',
      version: 1,
    });
    expect(inv.invoiceDate?.toISOString().slice(0, 10)).toBe('2026-11-09');
    expect(inv.invoiceTotal?.toString()).toBe('312110');
    expect(
      (inv.extractedHeader as { invoiceNo: { confidence: number } }).invoiceNo.confidence,
    ).toBeGreaterThan(0.9);

    expect(inv.items).toHaveLength(2);
    const [opc] = inv.items;
    expect(opc).toMatchObject({
      lineNo: 1,
      originalDescription: 'ULTRATECH OPC 53 GRADE 50KG',
      matchStatus: 'NEW_MATERIAL',
      materialId: null,
      invoiceUnitId: s.unit('BAG'),
      hsnCode: '2523',
      // A new material always waits for the user (PRD §7.3 step 6 B).
      lineStatus: 'PENDING',
    });
    expect(opc!.invoiceQty?.toString()).toBe('500');
    expect(opc!.acceptedQty?.toString()).toBe('500');
    expect(opc!.proposedMaterial as unknown as ProposedMaterial).toMatchObject({
      name: 'OPC Cement 53 Grade',
      categoryId: s.category('Cement'),
      brand: 'UltraTech',
      grade: '53',
      stockUnitId: s.unit('BAG'),
      packSize: '50',
      packUnitId: s.unit('KG'),
    });

    // One AI call, logged against the uploader (PRD §18.3, §3.2 "own AI activity").
    expect(inv.aiLogs).toHaveLength(1);
    expect(inv.aiLogs[0]).toMatchObject({
      stage: 'EXTRACTION',
      status: 'SUCCESS',
      provider: 'fixture',
      triggeredById: s.userId,
    });
  });

  it('never writes stock, materials or mappings (PRD §22.4, §24.1)', async () => {
    const s = await site();
    await run(await upload(s, 'inv-002.pdf'));
    const where = { projectId: s.projectId };
    expect(await raw.material.count({ where })).toBe(0);
    expect(await raw.materialTransaction.count({ where })).toBe(0);
    expect(await raw.posting.count({ where })).toBe(0);
    expect(await raw.stockBalance.count({ where })).toBe(0);
    expect(await raw.supplier.count({ where })).toBe(0);
    expect(await raw.supplierMaterialMapping.count({ where })).toBe(0);
  });

  it('matches existing materials and keeps steel sizes apart (PRD §6.5)', async () => {
    const s = await site();
    const cement = await addMaterial(s, {
      name: 'OPC Cement 53 Grade',
      category: 'Cement',
      unit: 'BAG',
    });
    const id = await upload(s, 'inv-001.pdf');
    await run(id);
    const inv = await load(id);
    expect(inv.items[0]).toMatchObject({
      matchStatus: 'MATCHED',
      materialId: cement,
      proposedMaterial: null,
      // High confidence and nothing uncertain: no per-line tick needed (DECISIONS Q13).
      lineStatus: 'CONFIRMED',
    });
    expect(Number(inv.items[0]!.matchScore)).toBeGreaterThanOrEqual(0.95);
    // PPC is not OPC.
    expect(inv.items[1]).toMatchObject({ matchStatus: 'NEW_MATERIAL', materialId: null });

    const steelSite = await site();
    const tmt12 = await addMaterial(steelSite, {
      name: 'TMT Steel 12mm',
      category: 'Steel',
      unit: 'MT',
    });
    const steelId = await upload(steelSite, 'inv-002.pdf');
    await run(steelId);
    const steel = await load(steelId);
    const matched = steel.items.filter((i) => i.materialId === tmt12);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.originalDescription).toMatch(/12\s*MM/i);
    // The 8, 16 and 20 mm lines are new materials, never the 12 mm one.
    for (const item of steel.items.filter((i) => /\b(8|16|20)\s*MM/i.test(i.originalDescription))) {
      expect(item.materialId).toBeNull();
      expect(item.matchStatus).toBe('NEW_MATERIAL');
    }
  });

  it('sends "GI FITTING HEAVY" to review when several sizes exist (PRD §7.3 step 6 C)', async () => {
    const s = await site();
    for (const size of ['1 Inch', '1.5 Inch', '2 Inch']) {
      await addMaterial(s, { name: `GI Fitting ${size}`, category: 'Plumbing', unit: 'NOS' });
    }
    const id = await upload(s, 'inv-006.jpg');
    expect(await run(id)).toBe('READY_FOR_REVIEW');
    const inv = await load(id);
    const gi = inv.items.find((i) => /GI FITTING/i.test(i.originalDescription))!;
    expect(gi).toMatchObject({
      matchStatus: 'REVIEW_REQUIRED',
      materialId: null,
      lineStatus: 'PENDING',
    });
    expect((gi.candidates as unknown[]).length).toBe(3);
    // The ambiguous line asked for a tie-break; the offline extractor declined, so it stays in review.
    expect(inv.aiLogs.filter((l) => l.stage === 'MATCH_TIEBREAK')).toHaveLength(1);
    // The photo passed the quality check and its measurements were stored.
    expect(inv.pages[0]!.widthPx).toBeGreaterThan(1000);
  });

  it('keeps an unknown unit ("Brass") as written and invents no conversion (PRD §12.4)', async () => {
    const s = await site();
    const id = await upload(s, 'ch-008.jpg');
    await run(id);
    const inv = await load(id);
    expect(inv.documentType).toBe('CHALLAN');
    expect(inv.invoiceNo).toBeNull();
    expect(inv.challanNo).toBe('217');
    for (const item of inv.items) {
      expect(item).toMatchObject({
        invoiceUnitId: null,
        invoiceUnitRaw: 'Brass',
        lineStatus: 'PENDING',
      });
      expect((item.proposedMaterial as unknown as ProposedMaterial).stockUnitId).toBeNull();
    }
  });

  it('flags an overwritten quantity instead of trusting it, and keeps the other lines (PRD §11.5)', async () => {
    const s = await site();
    await addMaterial(s, {
      name: 'Red Clay Brick 9x4x3',
      category: 'Bricks and Blocks',
      unit: 'NOS',
      size: '9x4x3 inch',
    });
    const id = await upload(s, 'ch-009.jpg');
    await run(id);
    const inv = await load(id);
    expect(inv.items.length).toBe(2);
    const bricks = inv.items[0]!;
    expect(bricks.invoiceQty?.toString()).toBe('8000');
    expect((bricks.extracted as { quantity: { legible: boolean } }).quantity.legible).toBe(false);
    expect(bricks.lineStatus).toBe('PENDING');
  });

  it('does not guess a grade or a pack size the document does not state', async () => {
    const s = await site();
    const steel = await upload(s, 'ch-010.jpg');
    await run(steel);
    for (const item of (await load(steel)).items) {
      expect((item.proposedMaterial as unknown as ProposedMaterial).grade).toBeNull();
    }
    const cement = await upload(s, 'ch-011.jpg');
    await run(cement);
    for (const item of (await load(cement)).items) {
      const p = item.proposedMaterial as unknown as ProposedMaterial;
      expect(p.packSize).toBeNull();
      expect(p.packUnitId).toBeNull();
    }
  });

  it('consolidates a two-page invoice without losing lines (PRD §7.2)', async () => {
    const s = await site();
    const id = await upload(s, 'inv-007.pdf');
    await run(id);
    const inv = await load(id);
    expect(inv.items.map((i) => i.lineNo)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });
});

describe('quality check (PRD §7.3 step 2, DECISIONS Q27)', () => {
  it('asks for a better photo before any AI call', async () => {
    const s = await site();
    const id = await upload(s, 'bad-012.jpg');
    const extractor = scripted(new Error('must not be called'));
    expect(await run(id, extractor)).toBe('NEEDS_RECAPTURE');
    expect(extractor.calls).toBe(0);
    const inv = await load(id);
    expect(inv.status).toBe('NEEDS_RECAPTURE');
    const report = inv.qualityReport as { ok: boolean; issues: string[]; advice: string[] };
    expect(report.ok).toBe(false);
    expect(report.issues).toContain('BLURRY');
    expect(report.advice.length).toBeGreaterThan(0);
    expect(inv.items).toHaveLength(0);
  });

  it('goes on when the user chooses to, and still produces a reviewable draft', async () => {
    const s = await site();
    const id = await upload(s, 'bad-012.jpg', { override: true });
    expect(await run(id)).toBe('READY_FOR_REVIEW');
    const inv = await load(id);
    // Nothing could be read: the user enters the lines by hand against the stored photo.
    expect(inv.items).toHaveLength(0);
    expect((inv.qualityReport as { ok: boolean }).ok).toBe(false);
  });

  it('rejects a file that is not an image at all, override or not', async () => {
    const s = await site();
    const id = await upload(s, 'bad-012.jpg', { override: true });
    const page = await raw.invoicePage.findFirstOrThrow({ where: { invoiceId: id } });
    await storage.put(
      page.storageKey,
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not a jpeg')]),
    );
    expect(await run(id)).toBe('NEEDS_RECAPTURE');
    expect(((await load(id)).qualityReport as { issues: string[] }).issues).toContain('UNREADABLE');
  });
});

describe('AI output validation and failure recovery (CLAUDE.md AI rules, PRD §25.3)', () => {
  const good = async (): Promise<ExtractionResult> =>
    (
      await fixture.extract([
        {
          pageNo: 1,
          mimeType: 'application/pdf',
          pageCount: 1,
          data: Buffer.alloc(0),
          sha256: createHash('sha256')
            .update(await readFile(path.join(DOCS, 'inv-001.pdf')))
            .digest('hex'),
        },
      ])
    ).raw as ExtractionResult;

  it('treats output that does not fit the schema as a failure, after one repair attempt', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const extractor = scripted({ lines: 'everything is fine' });
    expect(await run(id, extractor)).toBe('FAILED');
    expect(extractor.calls).toBe(2);
    const inv = await load(id);
    expect(inv).toMatchObject({ status: 'FAILED', failureCode: 'INVALID_OUTPUT' });
    expect(inv.items).toHaveLength(0);
    expect(inv.aiLogs.map((l) => l.status)).toEqual(['INVALID_OUTPUT', 'INVALID_OUTPUT']);
    expect(inv.aiLogs[0]!.validationErrors).not.toBeNull();
  });

  it('rejects a partly valid answer as a whole: no partial truth', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const broken = await good();
    // A JS float where a decimal string is required, and a confidence out of range.
    (broken.lines[1]!.quantity as { value: unknown }).value = 200.5;
    broken.lines[0]!.unit.confidence = 7;
    expect(await run(id, scripted(broken))).toBe('FAILED');
    expect((await load(id)).items).toHaveLength(0);
  });

  it('accepts a corrected answer on the repair attempt', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const extractor = scripted({ nonsense: true }, await good());
    expect(await run(id, extractor)).toBe('READY_FOR_REVIEW');
    const inv = await load(id);
    expect(inv.aiLogs.map((l) => l.status)).toEqual(['INVALID_OUTPUT', 'SUCCESS']);
    expect(inv.items).toHaveLength(2);
  });

  it('retries a transient provider error later, and gives up after the last attempt', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const down = scripted(new ExtractorError('TRANSIENT', 'HTTP_503', 'Service unavailable'));
    expect(await run(id, down)).toBe('RETRY_LATER');
    let inv = await load(id);
    expect(inv).toMatchObject({ status: 'QUEUED', attemptCount: 1, failureCode: 'HTTP_503' });
    expect(inv.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    // Not claimable until the pause is over.
    expect(await claimNext(db, id)).toBeNull();

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await raw.invoice.update({
        where: { id },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      const outcome = await run(id, down);
      expect(outcome).toBe(attempt < MAX_ATTEMPTS ? 'RETRY_LATER' : 'FAILED');
    }
    inv = await load(id);
    expect(inv).toMatchObject({ status: 'FAILED', attemptCount: MAX_ATTEMPTS });
    expect(inv.aiLogs.every((l) => l.status === 'PROVIDER_ERROR')).toBe(true);
  });

  it('fails at once on a refusal or a missing provider, with a message the user can act on', async () => {
    const s = await site();
    const refused = await upload(s, 'inv-001.pdf');
    expect(await run(refused, scripted(new ExtractorError('REFUSED', 'REFUSED', 'no')))).toBe(
      'FAILED',
    );
    expect((await load(refused)).failureMessage).toMatch(/by hand/);

    const unknown = await upload(s, 'inv-001.pdf');
    // The offline extractor does not know a file whose bytes differ from the samples.
    await raw.invoicePage.updateMany({
      where: { invoiceId: unknown },
      data: { sha256: 'f'.repeat(64) },
    });
    expect(await run(unknown)).toBe('FAILED');
    expect((await load(unknown)).failureCode).toBe('NO_FIXTURE');
  });

  it('gives one document to exactly one worker', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const claims = await Promise.all(Array.from({ length: 8 }, () => claimNext(db, id)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('drops the work of a run whose document was reprocessed meanwhile', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    const claim = (await claimNext(db, id))!;
    // The user asked for reprocessing while the first run was still going.
    await raw.invoice.update({ where: { id }, data: { extractionVersion: { increment: 1 } } });
    expect(await processInvoice(deps(), claim)).toBe('STALE');
    expect((await load(id)).items).toHaveLength(0);
  });

  it('recovers a document whose worker died', async () => {
    const s = await site();
    const id = await upload(s, 'inv-001.pdf');
    await claimNext(db, id);
    expect(await reapStaleClaims(db)).toBe(0);
    await raw.invoice.update({
      where: { id },
      data: { processingStartedAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(await reapStaleClaims(db)).toBe(1);
    expect((await load(id)).status).toBe('QUEUED');
    expect(await run(id)).toBe('READY_FOR_REVIEW');
  });
});

describe('document retention (DECISIONS Q25)', () => {
  it('purges files of discarded uploads after the retention period, and keeps the rest', async () => {
    const s = await site();
    const discarded = await upload(s, 'inv-001.pdf');
    const recent = await upload(s, 'inv-002.pdf');
    const ready = await upload(s, 'inv-003.pdf');
    await run(ready);
    const old = new Date(Date.now() - 40 * 86_400_000);
    // updated_at is maintained by the client, so the test sets it with SQL.
    await raw.$executeRaw`UPDATE invoices SET status = 'DISCARDED', updated_at = ${old} WHERE id = ${discarded}::uuid`;
    await raw.$executeRaw`UPDATE invoices SET status = 'DISCARDED' WHERE id = ${recent}::uuid`;
    await raw.$executeRaw`UPDATE invoices SET updated_at = ${old} WHERE id = ${ready}::uuid`;

    expect(await purgeExpiredDocuments(db, storage, 30)).toBe(1);
    const page = async (id: string) =>
      raw.invoicePage.findFirstOrThrow({ where: { invoiceId: id } });
    expect((await page(discarded)).purgedAt).not.toBeNull();
    await expect(storage.get((await page(discarded)).storageKey)).rejects.toThrow();
    for (const id of [recent, ready]) {
      expect((await page(id)).purgedAt).toBeNull();
      expect((await storage.get((await page(id)).storageKey)).length).toBeGreaterThan(0);
    }
    expect(await purgeExpiredDocuments(db, storage, 30)).toBe(0);
  });
});
