import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { type Prisma, createMaterialCatalog, loadMatchingMasters } from '@kavach/db';
import { matchLine } from '@kavach/matching';
import {
  DEFAULT_THRESHOLDS,
  type ExtractedLine,
  type InvoiceDetailDto,
  type PostingDto,
  normalise,
  normaliseDocumentNo,
  resolveUnit,
} from '@kavach/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type Fixture,
  type Masters,
  as,
  createApp,
  createFixture,
  createMember,
  loadMasters,
  rawDb,
} from './helpers';

const DOCS = path.resolve(__dirname, '../../../test-docs');
const PDF = readFileSync(path.join(DOCS, 'inv-001.pdf'));

let app: INestApplication;
let keyCounter = 0;
const key = () => `invoice-spec-key-${Date.now()}-${(keyCounter += 1)}`;

/** A PDF with its own fingerprint: bytes after %%EOF do not change what it is. */
function pdf(tag: string): Buffer {
  return Buffer.concat([PDF, Buffer.from(`\n% ${tag}\n`)]);
}

interface LineSpec {
  description: string;
  suggestedName?: string;
  category?: string;
  brand?: string;
  grade?: string;
  size?: string;
  packSize?: string;
  quantity: string;
  unit: string;
  unitPrice?: string;
  lineTotal?: string;
  /** Marks the quantity as unreadable, as the model does for an overwritten number. */
  uncertainQuantity?: boolean;
}

interface HeaderSpec {
  supplierName?: string;
  gstin?: string;
  invoiceNo?: string | null;
  invoiceDate?: string;
  challanNo?: string | null;
}

const f = <T>(value: T | null, uncertain = false) =>
  value === null
    ? { value: null, confidence: 0, legible: true }
    : { value, confidence: uncertain ? 0.4 : 0.98, legible: !uncertain };

async function upload(
  actor: Actor,
  fx: Fixture,
  file: Buffer,
  storeId = fx.storeId,
): Promise<InvoiceDetailDto> {
  const client = as(app, actor, fx.projectId);
  const created = (await client.post('/invoices', { storeId }).expect(201))
    .body as InvoiceDetailDto;
  await request(app.getHttpServer())
    .post(`/invoices/${created.id}/pages`)
    .set('Authorization', `Bearer ${actor.token}`)
    .set('X-Project-Id', fx.projectId)
    .set('Content-Type', 'application/pdf')
    .set('X-File-Name', encodeURIComponent('invoice 1.pdf'))
    .send(file)
    .expect(201);
  return (await client.post(`/invoices/${created.id}/submit`).expect(200)).body as InvoiceDetailDto;
}

/**
 * Stands in for the worker (apps/worker, tested on its own): writes the draft the pipeline
 * writes, using the same matching engine and catalog, and nothing else.
 */
async function extract(
  fx: Fixture,
  invoiceId: string,
  header: HeaderSpec,
  lines: LineSpec[],
): Promise<void> {
  const db = rawDb(app);
  const masters = await loadMatchingMasters(db, fx.projectId);
  const supplierName = header.supplierName ?? 'Sai Krupa Cement Agencies';
  const supplier = await db.supplier.findFirst({
    where: { projectId: fx.projectId, normalizedName: normalise(supplierName) },
  });
  const catalog = createMaterialCatalog(db, fx.projectId);
  const items: Prisma.InvoiceItemCreateManyInput[] = [];
  for (const [i, l] of lines.entries()) {
    const unit = resolveUnit(l.unit, masters.units);
    const extracted: ExtractedLine = {
      lineNo: i + 1,
      page: 1,
      description: f(l.description),
      suggestedName: f(l.suggestedName ?? null),
      brand: f(l.brand ?? null),
      category: f(l.category ?? null),
      specification: f<string>(null),
      grade: f(l.grade ?? null),
      size: f(l.size ?? null),
      packSize: f(l.packSize ?? null),
      quantity: f(l.quantity, l.uncertainQuantity),
      unit: f(l.unit),
      unitPrice: f(l.unitPrice ?? null),
      lineTotal: f(l.lineTotal ?? null),
      hsn: f<string>(null),
    };
    const match = await matchLine(
      {
        description: l.description,
        suggestedName: l.suggestedName ?? null,
        brand: l.brand ?? null,
        category: l.category ?? null,
        specification: null,
        grade: l.grade ?? null,
        size: l.size ?? null,
        packSize: l.packSize ?? null,
        unitId: unit?.id ?? null,
      },
      { supplierId: supplier?.id ?? null, ...masters, thresholds: DEFAULT_THRESHOLDS },
      catalog,
    );
    const clean =
      match.status === 'MATCHED' &&
      !match.requiresConfirmation &&
      !l.uncertainQuantity &&
      unit !== null;
    items.push({
      projectId: fx.projectId,
      invoiceId,
      lineNo: i + 1,
      pageNo: 1,
      extracted: extracted as unknown as Prisma.InputJsonValue,
      originalDescription: l.description,
      normalizedDescription: normalise(l.description),
      matchStatus: match.status,
      matchMethod: match.method,
      matchScore: match.score?.toFixed(4) ?? null,
      candidates: match.candidates as unknown as Prisma.InputJsonValue,
      materialId: match.status === 'MATCHED' ? match.materialId : null,
      proposedMaterial:
        match.status === 'NEW_MATERIAL'
          ? (match.proposal as unknown as Prisma.InputJsonValue)
          : undefined,
      invoiceQty: l.quantity,
      invoiceUnitId: unit?.id ?? null,
      invoiceUnitRaw: l.unit,
      unitPrice: l.unitPrice ?? null,
      lineTotal: l.lineTotal ?? null,
      acceptedQty: l.quantity,
      lineStatus: clean ? 'CONFIRMED' : 'PENDING',
    });
  }
  const invoiceNo =
    header.invoiceNo === undefined ? `INV-${invoiceId.slice(0, 8)}` : header.invoiceNo;
  const challanNo = header.challanNo ?? null;
  await db.invoiceItem.createMany({ data: items });
  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'READY_FOR_REVIEW',
      stage: 'DONE',
      documentType: invoiceNo ? 'INVOICE' : 'CHALLAN',
      supplierId: supplier?.id ?? null,
      supplierNameRaw: supplierName,
      supplierGstinRaw: header.gstin ?? null,
      invoiceNo,
      normalizedInvoiceNo: normaliseDocumentNo(invoiceNo),
      invoiceDate: new Date(`${header.invoiceDate ?? '2026-11-09'}T00:00:00.000Z`),
      challanNo,
      normalizedChallanNo: normaliseDocumentNo(challanNo),
      version: { increment: 1 },
    },
  });
}

const CEMENT: LineSpec = {
  description: 'ULTRATECH OPC 53 GRADE 50KG',
  suggestedName: 'OPC Cement 53 Grade',
  category: 'Cement',
  brand: 'UltraTech',
  grade: '53',
  packSize: '50 KG',
  quantity: '500',
  unit: 'Bags',
  unitPrice: '385',
  lineTotal: '192500',
};
const PPC: LineSpec = {
  description: 'ULTRATECH PPC 50KG',
  suggestedName: 'PPC Cement',
  category: 'Cement',
  brand: 'UltraTech',
  packSize: '50 KG',
  quantity: '200',
  unit: 'Bags',
};

describe('AI invoice receiving (PRD §7–§13, §10.2)', () => {
  let fx: Fixture;
  let m: Masters;
  let cementId: string;

  const manager = () => as(app, fx.manager, fx.projectId);
  const admin = () => as(app, fx.admin, fx.projectId);
  const detail = async (id: string) =>
    (await manager().get(`/invoices/${id}`).expect(200)).body as InvoiceDetailDto;
  const stockOf = async (materialId: string) => {
    const b = await rawDb(app).stockBalance.findFirst({
      where: { projectId: fx.projectId, materialId },
    });
    return {
      available: b?.availableQty.toString() ?? '0',
      damaged: b?.damagedQty.toString() ?? '0',
    };
  };
  /** Ticks every pending line that has nothing else wrong with it. */
  async function tickAll(id: string): Promise<InvoiceDetailDto> {
    let d = await detail(id);
    for (const item of d.items) {
      if (item.lineStatus === 'PENDING') {
        d = (
          await manager()
            .patch(`/invoices/${id}/items/${item.id}`, {
              version: d.version,
              lineStatus: 'CONFIRMED',
            })
            .expect(200)
        ).body as InvoiceDetailDto;
      }
    }
    return d;
  }
  async function ready(
    header: HeaderSpec,
    lines: LineSpec[],
    file = pdf(key()),
  ): Promise<InvoiceDetailDto> {
    const up = await upload(fx.manager, fx, file);
    await extract(fx, up.id, header, lines);
    return detail(up.id);
  }

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
    m = await loadMasters(app, fx.admin, fx.projectId);
    cementId = (
      await admin()
        .post('/materials', {
          name: 'OPC Cement 53 Grade',
          categoryId: m.categoryId('Cement'),
          stockUnitId: m.unitId('BAG'),
          packSize: '50',
          packUnitId: m.unitId('KG'),
        })
        .expect(201)
    ).body.id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('upload (PRD §7.2, §25.2)', () => {
    it('accepts a PDF, fingerprints it and queues it for the worker', async () => {
      const d = await upload(fx.manager, fx, pdf('upload-1'));
      expect(d).toMatchObject({ status: 'QUEUED', stage: 'UPLOADED', pageCount: 1, lineCount: 0 });
      expect(d.pages[0]).toMatchObject({
        pageNo: 1,
        mimeType: 'application/pdf',
        originalName: 'invoice 1.pdf',
      });
      const row = await rawDb(app).invoice.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.documentFingerprint).toMatch(/^[0-9a-f]{64}$/);
      // Nothing can be edited or received while it is being processed.
      await manager()
        .post(`/invoices/${d.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(409);
    });

    it('reads the file type from the bytes, not from the declared content type', async () => {
      const created = (await manager().post('/invoices', { storeId: fx.storeId }).expect(201))
        .body as InvoiceDetailDto;
      const send = (body: Buffer, type: string) =>
        request(app.getHttpServer())
          .post(`/invoices/${created.id}/pages`)
          .set('Authorization', `Bearer ${fx.manager.token}`)
          .set('X-Project-Id', fx.projectId)
          .set('Content-Type', type)
          .send(body);
      const html = await send(Buffer.from('<html><script>alert(1)</script></html>'), 'image/jpeg');
      expect(html.status).toBe(415);
      expect(html.body.error.code).toBe('UNSUPPORTED_FILE');
      // An executable renamed to .pdf is refused too.
      expect((await send(Buffer.from('MZ\x90\x00 not a pdf'), 'application/pdf')).status).toBe(415);
      // JSON is not a document.
      expect((await manager().post(`/invoices/${created.id}/pages`, { a: 1 })).status).toBe(415);
      await manager().post(`/invoices/${created.id}/submit`).expect(400);
    });

    it('serves the stored page only to members who may see that store', async () => {
      const d = await upload(fx.manager, fx, pdf('content-1'));
      const get = (actor: Actor, projectId: string) =>
        request(app.getHttpServer())
          .get(`/invoices/${d.id}/pages/1/content`)
          .set('Authorization', `Bearer ${actor.token}`)
          .set('X-Project-Id', projectId);
      const ok = await get(fx.manager, fx.projectId)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(ok.status).toBe(200);
      expect(ok.headers['content-type']).toContain('application/pdf');
      expect(ok.headers['cache-control']).toContain('no-store');
      expect((ok.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
      expect((await get(fx.admin, fx.projectId)).status).toBe(200);
      // No token, another project, and a Store Manager of another store.
      await request(app.getHttpServer()).get(`/invoices/${d.id}/pages/1/content`).expect(401);
      const other = await createFixture(app);
      expect((await get(other.manager, other.projectId)).status).toBe(404);
      expect((await as(app, other.manager, other.projectId).get(`/invoices/${d.id}`)).status).toBe(
        404,
      );
      const store2 = (
        await admin()
          .post('/stores', { code: `S2-${keyCounter}`, name: 'Second store' })
          .expect(201)
      ).body.id;
      const outsider = await createMember(app, fx.projectId, 'STORE_MANAGER', [store2]);
      expect((await get(outsider, fx.projectId)).status).toBe(403);
      expect((await as(app, outsider, fx.projectId).get(`/invoices/${d.id}`)).status).toBe(403);
      const list = (await as(app, outsider, fx.projectId).get('/invoices').expect(200)).body;
      expect(list.items.map((i: { id: string }) => i.id)).not.toContain(d.id);
    });

    it('a Project Admin views documents but does not upload or receive (DECISIONS Q4)', async () => {
      await admin().post('/invoices', { storeId: fx.storeId }).expect(403);
      const d = await ready({}, [CEMENT]);
      await admin().get(`/invoices/${d.id}`).expect(200);
      await admin().patch(`/invoices/${d.id}`, { version: d.version, notes: 'x' }).expect(403);
      await admin()
        .post(`/invoices/${d.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(403);
    });
  });

  describe('review and Confirm & Receive (PRD §10.2 screens 3–6)', () => {
    let posted: PostingDto;
    let invoiceId: string;
    let confirmKey: string;
    let confirmVersion: number;

    it('shows matched and new lines, with what blocks each of them', async () => {
      const d = await ready(
        { gstin: '27ABCDE1234F1Z5', invoiceNo: 'SKC/26-27/1045', challanNo: '1045' },
        [CEMENT, PPC],
      );
      invoiceId = d.id;
      expect(d.status).toBe('READY_FOR_REVIEW');
      const [opc, ppc] = d.items;
      expect(opc).toMatchObject({ matchStatus: 'MATCHED', lineStatus: 'CONFIRMED', issues: [] });
      expect(opc!.material).toMatchObject({ id: cementId, stockUnitCode: 'BAG' });
      expect(opc!.stock).toEqual({ unitCode: 'BAG', acceptedQty: '500', damagedQty: '0' });
      expect(ppc).toMatchObject({
        matchStatus: 'NEW_MATERIAL',
        lineStatus: 'PENDING',
        material: null,
      });
      expect(ppc!.proposedMaterial).toMatchObject({
        name: 'PPC Cement',
        categoryId: m.categoryId('Cement'),
      });
      expect(ppc!.issues.map((i) => i.code)).toEqual(['NOT_CONFIRMED']);
      expect(d.summary).toMatchObject({
        lines: 2,
        newMaterials: 1,
        needsAttention: 1,
        ready: false,
      });
    });

    it('refuses to receive while a line is unconfirmed, and changes nothing', async () => {
      const d = await detail(invoiceId);
      const res = await manager().post(
        `/invoices/${invoiceId}/confirm`,
        { version: d.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REVIEW_INCOMPLETE');
      expect(res.body.error.details.lines).toHaveLength(1);
      expect(await stockOf(cementId)).toEqual({ available: '0', damaged: '0' });
    });

    it('keeps invoice quantity and received quantity apart, and asks for the reason (screen 4)', async () => {
      let d = await detail(invoiceId);
      const opc = d.items[0]!;
      // 500 on the invoice; 490 good, 5 damaged, 5 short.
      d = (
        await manager()
          .patch(`/invoices/${invoiceId}/items/${opc.id}`, {
            version: d.version,
            acceptedQty: '490',
            damagedQty: '5',
          })
          .expect(200)
      ).body;
      expect(d.items[0]).toMatchObject({
        invoiceQty: '500',
        acceptedQty: '490',
        damagedQty: '5',
        shortQty: '5',
      });
      expect(d.items[0]!.issues.map((i) => i.code)).toContain('REASON_REQUIRED');
      d = (
        await manager()
          .patch(`/invoices/${invoiceId}/items/${opc.id}`, {
            version: d.version,
            discrepancyReason: 'SHORT_SUPPLY',
          })
          .expect(200)
      ).body;
      expect(d.items[0]!.issues).toEqual([]);
      // A stale screen cannot overwrite a newer edit.
      await manager()
        .patch(`/invoices/${invoiceId}/items/${opc.id}`, {
          version: d.version - 1,
          acceptedQty: '1',
        })
        .expect(409);
      // Count units stay whole.
      const frac = await manager().patch(`/invoices/${invoiceId}/items/${opc.id}`, {
        version: d.version,
        acceptedQty: '489.5',
      });
      expect((frac.body as InvoiceDetailDto).items[0]!.issues.map((i) => i.code)).toContain(
        'QUANTITY_NOT_WHOLE',
      );
      await manager()
        .patch(`/invoices/${invoiceId}/items/${opc.id}`, {
          version: (frac.body as InvoiceDetailDto).version,
          acceptedQty: '490',
        })
        .expect(200);
    });

    it('posts everything in one step: material, ledger, balances, supplier, mappings, receipt', async () => {
      const d = await tickAll(invoiceId);
      expect(d.summary.ready).toBe(true);
      confirmKey = key();
      confirmVersion = d.version;
      posted = (
        await manager()
          .post(
            `/invoices/${invoiceId}/confirm`,
            { version: d.version },
            { 'Idempotency-Key': confirmKey },
          )
          .expect(201)
      ).body as PostingDto;

      expect(posted.type).toBe('RECEIPT_INVOICE');
      expect(posted.referenceNo).toMatch(/^RCV-\d{4}-\d{6}$/);
      expect(posted).toMatchObject({
        invoiceId,
        externalRef: 'SKC/26-27/1045',
        supplierName: 'Sai Krupa Cement Agencies',
      });
      expect(posted.lines.map((l) => [l.bucket, l.quantity, l.type])).toEqual([
        ['AVAILABLE', '490', 'MATERIAL_IN'],
        ['DAMAGED', '5', 'MATERIAL_IN'],
        ['AVAILABLE', '200', 'MATERIAL_IN'],
      ]);
      // Only the accepted quantity is available stock; damaged is held apart; short is not stocked.
      expect(await stockOf(cementId)).toEqual({ available: '490', damaged: '5' });

      const db = rawDb(app);
      const ppc = await db.material.findFirstOrThrow({
        where: { projectId: fx.projectId, name: 'PPC Cement' },
      });
      expect(ppc).toMatchObject({
        creationSource: 'AI_INVOICE',
        createdById: fx.manager.userId,
        brand: 'UltraTech',
      });
      expect(ppc.code).toMatch(/^MAT-\d{6}$/);
      expect(await stockOf(ppc.id)).toEqual({ available: '200', damaged: '0' });

      const supplier = await db.supplier.findFirstOrThrow({ where: { projectId: fx.projectId } });
      expect(supplier).toMatchObject({
        name: 'Sai Krupa Cement Agencies',
        gstin: '27ABCDE1234F1Z5',
      });
      const mappings = await db.supplierMaterialMapping.findMany({
        where: { projectId: fx.projectId, supplierId: supplier.id },
        orderBy: { description: 'asc' },
      });
      expect(mappings.map((x) => [x.description, x.materialId, x.status])).toEqual([
        ['ULTRATECH OPC 53 GRADE 50KG', cementId, 'CONFIRMED'],
        ['ULTRATECH PPC 50KG', ppc.id, 'CONFIRMED'],
      ]);

      const after = await detail(invoiceId);
      expect(after).toMatchObject({
        status: 'POSTED',
        receiptReferenceNo: posted.referenceNo,
        postingId: posted.id,
      });
      const actions = (
        await db.auditLog.findMany({
          where: { projectId: fx.projectId, actorUserId: fx.manager.userId },
        })
      ).map((a) => a.action);
      for (const action of [
        'invoice.upload',
        'invoice_item.update',
        'material.create',
        'supplier.create',
        'supplier_mapping.create',
        'posting.receipt_invoice',
      ]) {
        expect(actions).toContain(action);
      }
      // The ledger rows name their invoice lines.
      const rows = await db.materialTransaction.findMany({
        where: { projectId: fx.projectId, postingId: posted.id },
      });
      expect(rows.every((r) => r.invoiceItemId !== null)).toBe(true);
    });

    it('a retry with the same key returns the same receipt and adds no stock (PRD §13.3)', async () => {
      const again = (
        await manager()
          .post(
            `/invoices/${invoiceId}/confirm`,
            { version: confirmVersion },
            { 'Idempotency-Key': confirmKey },
          )
          .expect(201)
      ).body as PostingDto;
      expect(again.id).toBe(posted.id);
      expect(await stockOf(cementId)).toEqual({ available: '490', damaged: '5' });
      // A second click with a new key is refused: the document is already received.
      const d = await detail(invoiceId);
      const second = await manager().post(
        `/invoices/${invoiceId}/confirm`,
        { version: d.version },
        { 'Idempotency-Key': key() },
      );
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('INVOICE_NOT_EDITABLE');
      // A posted document can no longer be edited or discarded.
      await manager()
        .patch(`/invoices/${invoiceId}`, { version: d.version, notes: 'late' })
        .expect(409);
      await manager().post(`/invoices/${invoiceId}/discard`).expect(409);
    });

    it('reuses the confirmed supplier mapping on the next document (PRD §9.3)', async () => {
      const d = await ready({ invoiceNo: 'SKC/26-27/1046' }, [{ ...CEMENT, quantity: '10' }]);
      expect(d.supplierId).not.toBeNull();
      expect(d.items[0]).toMatchObject({
        matchStatus: 'MATCHED',
        matchMethod: 'SUPPLIER_MAPPING',
        lineStatus: 'CONFIRMED',
      });
      await manager()
        .post(`/invoices/${d.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(201);
      const mapping = await rawDb(app).supplierMaterialMapping.findFirstOrThrow({
        where: { projectId: fx.projectId, materialId: cementId, status: 'CONFIRMED' },
      });
      expect(mapping.timesUsed).toBe(2);
      expect(await stockOf(cementId)).toEqual({ available: '500', damaged: '5' });
    });

    it('two confirmations of one document at the same time post once', async () => {
      const d = await ready({ invoiceNo: 'RACE-1' }, [{ ...CEMENT, quantity: '7' }]);
      const before = await stockOf(cementId);
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          manager().post(
            `/invoices/${d.id}/confirm`,
            { version: d.version },
            { 'Idempotency-Key': key() },
          ),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
      expect(Number((await stockOf(cementId)).available)).toBe(Number(before.available) + 7);
      expect(
        await rawDb(app).posting.count({ where: { projectId: fx.projectId, invoiceId: d.id } }),
      ).toBe(1);
    });
  });

  describe('atomic posting (PRD §10.2 "committed atomically", §26 rule 18)', () => {
    it('leaves nothing behind when a later line fails inside the transaction', async () => {
      const temp = await createFixture(app);
      const tm = await loadMasters(app, temp.admin, temp.projectId);
      const client = as(app, temp.manager, temp.projectId);
      const up = await upload(temp.manager, temp, pdf('atomic'));
      await extract(temp, up.id, { supplierName: 'Atomic Traders' }, [
        {
          description: 'River sand washed',
          suggestedName: 'River Sand',
          category: 'Sand and Aggregate',
          quantity: '4',
          unit: 'CFT',
        },
        // Will look like "Binding Wire": creating it needs an explicit confirmation.
        {
          description: 'Binding wire GI',
          suggestedName: 'Binding Wire Galvanised',
          category: 'Steel',
          quantity: '25',
          unit: 'Kg',
        },
      ]);
      // Meanwhile the admin adds a material that the second line now resembles.
      await as(app, temp.admin, temp.projectId)
        .post('/materials', {
          name: 'Binding Wire',
          categoryId: tm.categoryId('Steel'),
          stockUnitId: tm.unitId('KG'),
        })
        .expect(201);
      let d = (await client.get(`/invoices/${up.id}`).expect(200)).body as InvoiceDetailDto;
      expect(d.items.map((i) => i.matchStatus)).toEqual(['NEW_MATERIAL', 'NEW_MATERIAL']);
      for (const item of d.items) {
        d = (
          await client
            .patch(`/invoices/${up.id}/items/${item.id}`, {
              version: d.version,
              lineStatus: 'CONFIRMED',
            })
            .expect(200)
        ).body;
      }
      const res = await client.post(
        `/invoices/${up.id}/confirm`,
        { version: d.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect(res.body.error.details).toMatchObject({ lineNo: 2, itemId: d.items[1]!.id });

      // Line 1's material was created inside the transaction and rolled back with it.
      const db = rawDb(app);
      const where = { projectId: temp.projectId };
      expect(await db.material.count({ where })).toBe(1);
      expect(await db.supplier.count({ where })).toBe(0);
      expect(await db.posting.count({ where })).toBe(0);
      expect(await db.materialTransaction.count({ where })).toBe(0);
      expect(await db.stockBalance.count({ where })).toBe(0);
      expect(await db.supplierMaterialMapping.count({ where })).toBe(0);
      expect((await db.invoice.findUniqueOrThrow({ where: { id: up.id } })).status).toBe(
        'READY_FOR_REVIEW',
      );

      // The user says it is a different material: now everything commits together.
      const line2 = d.items[1]!;
      d = (
        await client
          .patch(`/invoices/${up.id}/items/${line2.id}`, {
            version: d.version,
            proposedMaterial: { ...line2.proposedMaterial, confirmNotDuplicate: true },
          })
          .expect(200)
      ).body;
      await client
        .post(`/invoices/${up.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(201);
      expect(await db.material.count({ where })).toBe(3);
      expect(await db.supplierMaterialMapping.count({ where })).toBe(2);
    });
  });

  describe('units and specifications (PRD §8.2, §12)', () => {
    it('converts with approved conversions only and shows the result before confirming', async () => {
      const steel = (
        await admin()
          .post('/materials', {
            name: 'TMT Steel 12mm',
            categoryId: m.categoryId('Steel'),
            stockUnitId: m.unitId('KG'),
            grade: 'Fe 550',
          })
          .expect(201)
      ).body.id as string;
      const d = await ready({ invoiceNo: 'UNIT-1' }, [
        {
          description: 'TMT FE550 12MM',
          grade: 'Fe 550',
          size: '12mm',
          quantity: '2.5',
          unit: 'MT',
        },
        // 25 kg of a 50 kg bag is half a bag: never rounded.
        { ...CEMENT, description: 'OPC 53 loose', quantity: '25', unit: 'Kg', packSize: undefined },
      ]);
      expect(d.items[0]!.material?.id).toBe(steel);
      expect(d.items[0]!.stock).toEqual({ unitCode: 'KG', acceptedQty: '2500', damagedQty: '0' });
      expect(d.items[1]!.issues.map((i) => i.code)).toContain('QUANTITY_NOT_WHOLE');
      // 100 kg is two bags, through the material's own pack size.
      let fixed = (
        await manager()
          .patch(`/invoices/${d.id}/items/${d.items[1]!.id}`, {
            version: d.version,
            invoiceQty: '100',
            materialId: cementId,
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(fixed.items[1]).toMatchObject({ invoiceQty: '100', acceptedQty: '100' });
      expect(fixed.items[1]!.stock).toEqual({ unitCode: 'BAG', acceptedQty: '2', damagedQty: '0' });
      fixed = await tickAll(d.id);
      const before = Number((await stockOf(cementId)).available);
      const posting = (
        await manager()
          .post(
            `/invoices/${d.id}/confirm`,
            { version: fixed.version },
            { 'Idempotency-Key': key() },
          )
          .expect(201)
      ).body as PostingDto;
      expect(await stockOf(steel)).toEqual({ available: '2500', damaged: '0' });
      expect(Number((await stockOf(cementId)).available)).toBe(before + 2);
      // The quantity and unit as written are kept beside the stock quantity (PRD §12.3).
      expect(posting.lines[0]).toMatchObject({
        quantity: '2500',
        unitCode: 'KG',
        enteredQuantity: '2.5',
        enteredUnitCode: 'MT',
      });
    });

    it('an unknown unit ("Brass") and an unconvertible unit block the line until the user decides', async () => {
      const d = await ready(
        { supplierName: 'Om Sai Sand Suppliers', invoiceNo: null, challanNo: '217' },
        [
          {
            description: 'River sand (washed)',
            suggestedName: 'River Sand',
            category: 'Sand and Aggregate',
            quantity: '2',
            unit: 'Brass',
          },
        ],
      );
      const line = d.items[0]!;
      expect(line).toMatchObject({ invoiceUnitId: null, invoiceUnitRaw: 'Brass' });
      expect(line.issues.map((i) => i.code)).toEqual(
        expect.arrayContaining(['UNIT_REQUIRED', 'NEW_MATERIAL_INCOMPLETE']),
      );
      // Choosing cement in bags for a quantity in cubic feet is refused: no conversion is assumed.
      const wrong = (
        await manager()
          .patch(`/invoices/${d.id}/items/${line.id}`, {
            version: d.version,
            invoiceUnitId: m.unitId('CFT'),
            materialId: cementId,
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(wrong.items[0]!.issues.map((i) => i.code)).toContain('UNIT_INCOMPATIBLE');
      expect(wrong.items[0]!.stock).toBeNull();
      const res = await manager().post(
        `/invoices/${d.id}/confirm`,
        { version: wrong.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.body.error.code).toBe('REVIEW_INCOMPLETE');
      // The user converts by hand: 2 brass = 200 cft, stocked in cubic feet.
      const right = (
        await manager()
          .patch(`/invoices/${d.id}/items/${line.id}`, {
            version: wrong.version,
            invoiceQty: '200',
            acceptedQty: '200',
            proposedMaterial: { ...line.proposedMaterial, stockUnitId: m.unitId('CFT') },
            lineStatus: 'CONFIRMED',
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(right.items[0]!.issues).toEqual([]);
      await manager()
        .post(`/invoices/${d.id}/confirm`, { version: right.version }, { 'Idempotency-Key': key() })
        .expect(201);
    });

    it('shows a specification conflict when the user picks a material by hand, and never hides it', async () => {
      const tmt16 = (
        await admin()
          .post('/materials', {
            name: 'TMT Steel 16mm',
            categoryId: m.categoryId('Steel'),
            stockUnitId: m.unitId('KG'),
          })
          .expect(201)
      ).body.id as string;
      const d = await ready({ invoiceNo: 'SPEC-1' }, [
        { description: 'TMT FE550 20MM', size: '20mm', quantity: '1000', unit: 'Kg' },
      ]);
      // 20 mm is neither the 12 mm nor the 16 mm material: it is proposed as new, not merged.
      expect(d.items[0]).toMatchObject({ matchStatus: 'NEW_MATERIAL', material: null });
      const picked = (
        await manager()
          .patch(`/invoices/${d.id}/items/${d.items[0]!.id}`, {
            version: d.version,
            materialId: tmt16,
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(picked.items[0]).toMatchObject({ matchMethod: 'MANUAL', proposedMaterial: null });
      expect(picked.items[0]!.specConflicts).toEqual([
        { key: 'SIZE', line: '20MM', material: '16MM' },
      ]);
      expect(picked.items[0]!.warnings.join(' ')).toMatch(/SIZE 20MM vs 16MM/);
      await manager().post(`/invoices/${d.id}/discard`).expect(200);
    });

    it('an uncertain quantity waits for the user, and correcting it carries the received quantity', async () => {
      const d = await ready({ invoiceNo: 'UNSURE-1' }, [
        { ...CEMENT, quantity: '6000', uncertainQuantity: true },
      ]);
      expect(d.items[0]).toMatchObject({ lineStatus: 'PENDING', uncertainFields: ['quantity'] });
      const fixed = (
        await manager()
          .patch(`/invoices/${d.id}/items/${d.items[0]!.id}`, {
            version: d.version,
            invoiceQty: '8000',
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(fixed.items[0]).toMatchObject({
        invoiceQty: '8000',
        acceptedQty: '8000',
        shortQty: '0',
      });
      // The AI's reading stays on record beside the correction.
      expect(fixed.items[0]!.extracted?.quantity.value).toBe('6000');
      await manager().post(`/invoices/${d.id}/discard`).expect(200);
    });
  });

  describe('duplicate invoice protection (PRD §13, DECISIONS Q6, Q8, Q15)', () => {
    let fileA: Buffer;
    let first: PostingDto;
    let firstInvoiceId: string;

    it('blocks the same file a second time, whatever was typed over it', async () => {
      fileA = pdf('dup-file-A');
      const a = await ready(
        { supplierName: 'Dup Traders', invoiceNo: 'DUP-100' },
        [{ ...CEMENT, quantity: '10' }],
        fileA,
      );
      firstInvoiceId = a.id;
      first = (
        await manager()
          .post(`/invoices/${a.id}/confirm`, { version: a.version }, { 'Idempotency-Key': key() })
          .expect(201)
      ).body;

      const again = await ready(
        { supplierName: 'Dup Traders', invoiceNo: 'DUP-100-RETYPED' },
        [{ ...CEMENT, quantity: '10' }],
        fileA,
      );
      expect(again.duplicates).toHaveLength(1);
      expect(again.duplicates[0]).toMatchObject({
        kind: 'FINGERPRINT',
        invoiceId: a.id,
        referenceNo: first.referenceNo,
      });
      expect(again.summary.ready).toBe(false);
      const before = await stockOf(cementId);
      const res = await manager().post(
        `/invoices/${again.id}/confirm`,
        { version: again.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DUPLICATE_INVOICE');
      expect(res.body.error.details.duplicates[0].invoiceId).toBe(a.id);
      expect(await stockOf(cementId)).toEqual(before);
      await manager().post(`/invoices/${again.id}/discard`).expect(200);
    });

    it('blocks the same supplier, number and date from a different photo', async () => {
      const b = await ready({ supplierName: 'Dup Traders', invoiceNo: 'dup 100' }, [
        { ...CEMENT, quantity: '10' },
      ]);
      expect(b.duplicates[0]).toMatchObject({ kind: 'HEADER', invoiceNo: 'DUP-100' });
      const res = await manager().post(
        `/invoices/${b.id}/confirm`,
        { version: b.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.body.error.code).toBe('DUPLICATE_INVOICE');

      // Only the Project Admin can say it is a different document, with a reason (Q6).
      await manager()
        .post(`/invoices/${b.id}/duplicate-override`, { note: 'I say so' })
        .expect(403);
      await admin().post(`/invoices/${b.id}/duplicate-override`, { note: '' }).expect(400);
      const overridden = (
        await admin()
          .post(`/invoices/${b.id}/duplicate-override`, {
            note: 'Second delivery on the same invoice number',
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      expect(overridden.duplicateOverride).toMatchObject({
        note: 'Second delivery on the same invoice number',
      });
      expect(overridden.summary.ready).toBe(true);
      await manager()
        .post(
          `/invoices/${b.id}/confirm`,
          { version: overridden.version },
          { 'Idempotency-Key': key() },
        )
        .expect(201);
      const audit = await rawDb(app).auditLog.findFirst({
        where: { projectId: fx.projectId, action: 'invoice.duplicate_override', entityId: b.id },
      });
      expect(audit?.actorUserId).toBe(fx.admin.userId);
    });

    it('a different date or supplier is a different invoice', async () => {
      const c = await ready(
        { supplierName: 'Dup Traders', invoiceNo: 'DUP-100', invoiceDate: '2026-12-01' },
        [{ ...CEMENT, quantity: '1' }],
      );
      expect(c.duplicates).toEqual([]);
      await manager()
        .post(`/invoices/${c.id}/confirm`, { version: c.version }, { 'Idempotency-Key': key() })
        .expect(201);
      const e = await ready({ supplierName: 'Another Supplier', invoiceNo: 'DUP-100' }, [
        { ...CEMENT, quantity: '1' },
      ]);
      expect(e.duplicates).toEqual([]);
      await manager().post(`/invoices/${e.id}/discard`).expect(200);
    });

    it('an invoice for a challan that was already received is blocked (Q8)', async () => {
      const challan = await ready(
        { supplierName: 'Challan Steel', invoiceNo: null, challanNo: 'DC-0412' },
        [{ ...CEMENT, quantity: '3' }],
      );
      await manager()
        .post(
          `/invoices/${challan.id}/confirm`,
          { version: challan.version },
          { 'Idempotency-Key': key() },
        )
        .expect(201);
      const invoice = await ready(
        { supplierName: 'Challan Steel', invoiceNo: 'TAX-9001', challanNo: 'dc/0412' },
        [{ ...CEMENT, quantity: '3' }],
      );
      expect(invoice.duplicates[0]).toMatchObject({ kind: 'CHALLAN', challanNo: 'DC-0412' });
      const res = await manager().post(
        `/invoices/${invoice.id}/confirm`,
        { version: invoice.version },
        { 'Idempotency-Key': key() },
      );
      expect(res.body.error.code).toBe('DUPLICATE_INVOICE');
    });

    it('reversing the receipt frees the invoice to be received again (Q15)', async () => {
      const before = Number((await stockOf(cementId)).available);
      await admin()
        .post(
          `/inventory/postings/${first.id}/reverse`,
          { reason: 'Wrong store' },
          { 'Idempotency-Key': key() },
        )
        .expect(201);
      expect(Number((await stockOf(cementId)).available)).toBe(before - 10);
      expect((await detail(firstInvoiceId)).status).toBe('REVERSED');
      const again = await ready(
        { supplierName: 'Dup Traders', invoiceNo: 'DUP-100' },
        [{ ...CEMENT, quantity: '10' }],
        fileA,
      );
      // The overridden second delivery (same number, another file) is still on record.
      expect(again.duplicates.every((x) => x.invoiceId !== firstInvoiceId)).toBe(true);
    });

    it('the database refuses a duplicate even if the check were skipped', async () => {
      const db = rawDb(app);
      const postedRow = await db.invoice.findFirstOrThrow({
        where: { projectId: fx.projectId, status: 'POSTED', dupHeaderKey: { not: null } },
      });
      const draft = await ready({ invoiceNo: 'RAW-1' }, [{ ...CEMENT, quantity: '1' }]);
      await expect(
        db.invoice.update({
          where: { id: draft.id },
          data: {
            status: 'POSTED',
            postedAt: new Date(),
            supplierId: postedRow.supplierId,
            dupHeaderKey: postedRow.dupHeaderKey,
          },
        }),
      ).rejects.toThrow();
      // And the duplicate keys cannot sit on a document that is not received.
      await expect(
        db.invoice.update({ where: { id: draft.id }, data: { dupFingerprintKey: 'x' } }),
      ).rejects.toThrow();
    });
  });

  describe('supplier mappings learn only from confirmed decisions (PRD §9, DECISIONS Q14)', () => {
    it('replaces a mapping when the user confirms a different material, and keeps the history', async () => {
      const other = (
        await admin()
          .post('/materials', {
            name: 'OPC Cement 43 Grade',
            categoryId: m.categoryId('Cement'),
            stockUnitId: m.unitId('BAG'),
          })
          .expect(201)
      ).body.id as string;
      const line: LineSpec = { description: 'CEMENT OPC BAGS', quantity: '5', unit: 'Bags' };
      const a = await ready({ supplierName: 'Mapping Traders', invoiceNo: 'MAP-1' }, [line]);
      let d = (
        await manager()
          .patch(`/invoices/${a.id}/items/${a.items[0]!.id}`, {
            version: a.version,
            materialId: cementId,
            lineStatus: 'CONFIRMED',
          })
          .expect(200)
      ).body as InvoiceDetailDto;
      await manager()
        .post(`/invoices/${a.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(201);

      const b = await ready({ supplierName: 'Mapping Traders', invoiceNo: 'MAP-2' }, [line]);
      expect(b.items[0]).toMatchObject({ matchMethod: 'SUPPLIER_MAPPING' });
      expect(b.items[0]!.material?.id).toBe(cementId);
      d = (
        await manager()
          .patch(`/invoices/${b.id}/items/${b.items[0]!.id}`, {
            version: b.version,
            materialId: other,
            lineStatus: 'CONFIRMED',
          })
          .expect(200)
      ).body;
      await manager()
        .post(`/invoices/${b.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(201);

      const rows = await rawDb(app).supplierMaterialMapping.findMany({
        where: { projectId: fx.projectId, normalizedDescription: normalise(line.description) },
        orderBy: { confirmedAt: 'asc' },
      });
      expect(rows.map((r) => [r.materialId, r.status])).toEqual([
        [cementId, 'DISABLED'],
        [other, 'CONFIRMED'],
      ]);
      expect(rows[0]!.disabledReason).toMatch(/Replaced on receipt RCV-/);

      // A discarded or unconfirmed document teaches nothing.
      const c = await ready({ supplierName: 'Mapping Traders', invoiceNo: 'MAP-3' }, [
        { description: 'NEVER CONFIRMED ITEM', quantity: '1', unit: 'Nos' },
      ]);
      await manager().post(`/invoices/${c.id}/discard`).expect(200);
      expect(
        await rawDb(app).supplierMaterialMapping.count({
          where: {
            projectId: fx.projectId,
            normalizedDescription: normalise('NEVER CONFIRMED ITEM'),
          },
        }),
      ).toBe(0);
    });

    it('the admin sees mappings and can disable one; the Store Manager cannot', async () => {
      const list = (await admin().get('/supplier-mappings?status=CONFIRMED').expect(200)).body;
      expect(list.total).toBeGreaterThan(0);
      await manager().get('/supplier-mappings').expect(403);
      const target = list.items[0] as { id: string };
      const disabled = (
        await admin()
          .post(`/supplier-mappings/${target.id}/disable`, { reason: 'Wrong material' })
          .expect(200)
      ).body;
      expect(disabled).toMatchObject({ status: 'DISABLED', disabledReason: 'Wrong material' });
      await admin()
        .post(`/supplier-mappings/${target.id}/disable`, { reason: 'Again' })
        .expect(409);
    });
  });

  describe('manual entry and failed documents (PRD §11.5, §25.3)', () => {
    it('lets the user type the lines of a document that could not be read', async () => {
      const up = await upload(fx.manager, fx, pdf('manual-1'));
      await rawDb(app).invoice.update({
        where: { id: up.id },
        data: {
          status: 'FAILED',
          failureCode: 'INVALID_OUTPUT',
          failureMessage: 'Could not be read.',
        },
      });
      let d = (await manager().post(`/invoices/${up.id}/manual-entry`).expect(200))
        .body as InvoiceDetailDto;
      expect(d).toMatchObject({ status: 'READY_FOR_REVIEW', lineCount: 0 });
      expect(d.summary.blockers).toEqual(
        expect.arrayContaining(['Add at least one material line.', 'Enter the supplier.']),
      );
      d = (
        await manager()
          .patch(`/invoices/${up.id}`, {
            version: d.version,
            supplierName: 'Hand Written Supplier',
            challanNo: 'HW-1',
          })
          .expect(200)
      ).body;
      d = (
        await manager()
          .post(`/invoices/${up.id}/items`, {
            version: d.version,
            description: 'OPC Cement 53 Grade',
            invoiceQty: '12',
            invoiceUnitId: m.unitId('BAG'),
          })
          .expect(201)
      ).body;
      // A typed line is matched without the LLM, and still waits for the user's tick.
      expect(d.items[0]).toMatchObject({
        isManualEntry: true,
        matchStatus: 'MATCHED',
        acceptedQty: '12',
        lineStatus: 'PENDING',
      });
      d = await tickAll(up.id);
      await manager()
        .post(`/invoices/${up.id}/confirm`, { version: d.version }, { 'Idempotency-Key': key() })
        .expect(201);
    });

    it('queues a failed document again on request, and records a quality override (Q27)', async () => {
      const up = await upload(fx.manager, fx, pdf('retry-1'));
      await rawDb(app).invoice.update({
        where: { id: up.id },
        data: { status: 'NEEDS_RECAPTURE', attemptCount: 1 },
      });
      const d = (
        await manager().post(`/invoices/${up.id}/reprocess`, { overrideQuality: true }).expect(200)
      ).body as InvoiceDetailDto;
      expect(d).toMatchObject({ status: 'QUEUED', qualityOverridden: true });
      const row = await rawDb(app).invoice.findUniqueOrThrow({ where: { id: up.id } });
      expect(row).toMatchObject({ extractionVersion: 1, attemptCount: 0 });
      const audit = await rawDb(app).auditLog.findFirst({
        where: { projectId: fx.projectId, action: 'invoice.quality_override', entityId: up.id },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe('suppliers and AI logs (PRD §3, §4 module 9, §5.1 E)', () => {
    it('the admin manages suppliers; duplicates by name or GSTIN are refused', async () => {
      const created = (
        await admin()
          .post('/suppliers', { name: 'Jal Shakti Pipes', gstin: '27cdefg3456h1z7' })
          .expect(201)
      ).body;
      expect(created).toMatchObject({
        name: 'Jal Shakti Pipes',
        gstin: '27CDEFG3456H1Z7',
        isActive: true,
      });
      await admin().post('/suppliers', { name: 'JAL SHAKTI  PIPES' }).expect(409);
      await admin()
        .post('/suppliers', { name: 'Someone Else', gstin: '27CDEFG3456H1Z7' })
        .expect(409);
      await admin().post('/suppliers', { name: 'Bad GSTIN', gstin: 'ABC' }).expect(400);
      await manager().post('/suppliers', { name: 'Made by SM' }).expect(403);
      await manager().patch(`/suppliers/${created.id}`, { name: 'Renamed' }).expect(403);
      const listed = (await manager().get('/suppliers?q=jal').expect(200)).body as { id: string }[];
      expect(listed.map((s) => s.id)).toContain(created.id);
      await admin().patch(`/suppliers/${created.id}`, { isActive: false }).expect(200);
      expect(((await manager().get('/suppliers?q=jal').expect(200)).body as unknown[]).length).toBe(
        0,
      );
    });

    it('a Store Manager sees their own AI activity, the admin sees all', async () => {
      const db = rawDb(app);
      const other = await createMember(app, fx.projectId, 'STORE_MANAGER', [fx.storeId]);
      const mine = await upload(fx.manager, fx, pdf('log-mine'));
      const theirs = await upload(other, fx, pdf('log-theirs'));
      for (const [invoiceId, userId] of [
        [mine.id, fx.manager.userId],
        [theirs.id, other.userId],
      ] as const) {
        await db.aiProcessingLog.create({
          data: {
            projectId: fx.projectId,
            invoiceId,
            triggeredById: userId,
            stage: 'EXTRACTION',
            provider: 'fixture',
            model: 'm',
            promptVersion: 'v',
            attempt: 1,
            status: 'SUCCESS',
            latencyMs: 12,
          },
        });
      }
      const own = (await manager().get('/ai-logs?pageSize=100').expect(200)).body;
      expect(
        own.items.every(
          (l: { triggeredByName: string; invoiceId: string }) => l.invoiceId !== theirs.id,
        ),
      ).toBe(true);
      expect(own.items.map((l: { invoiceId: string }) => l.invoiceId)).toContain(mine.id);
      const all = (await admin().get('/ai-logs?pageSize=100').expect(200)).body;
      expect(all.items.map((l: { invoiceId: string }) => l.invoiceId)).toEqual(
        expect.arrayContaining([mine.id, theirs.id]),
      );
      // The log cannot be rewritten.
      const row = await db.aiProcessingLog.findFirstOrThrow({ where: { projectId: fx.projectId } });
      await expect(
        db.aiProcessingLog.update({ where: { id: row.id }, data: { status: 'REFUSED' } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.aiProcessingLog.delete({ where: { id: row.id } })).rejects.toThrow(
        /append-only/,
      );

      const overview = (await admin().get('/ai-logs/overview').expect(200)).body;
      expect(overview.invoicesProcessed).toBeGreaterThan(5);
      expect(overview.newMaterialsCreated).toBeGreaterThan(0);
      expect(overview.matchedLines).toBeGreaterThan(0);
    });

    it('confidence thresholds are configurable by the admin (PRD §8.2)', async () => {
      expect((await manager().get('/settings/confidence').expect(200)).body).toEqual({
        auto: 0.95,
        confirm: 0.7,
      });
      const put = (actor: Actor, body: object) =>
        as(app, actor, fx.projectId).patch('/settings/confidence', body);
      expect((await put(fx.manager, { auto: 0.9, confirm: 0.6 })).status).toBe(403);
      expect((await put(fx.admin, { auto: 0.6, confirm: 0.9 })).status).toBe(400);
      expect((await put(fx.admin, { auto: 0.9, confirm: 0.6 })).body).toEqual({
        auto: 0.9,
        confirm: 0.6,
      });
      const d = await ready({ invoiceNo: 'THRESH-1' }, [{ ...CEMENT, quantity: '1' }]);
      expect(d.thresholds).toEqual({ auto: 0.9, confirm: 0.6 });
      await put(fx.admin, { auto: 0.95, confirm: 0.7 });
    });
  });
});
