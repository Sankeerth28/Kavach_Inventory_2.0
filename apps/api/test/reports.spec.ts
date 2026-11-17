import type { INestApplication } from '@nestjs/common';
import { REPORT_KEYS, type ReportDto } from '@kavach/shared';
import ExcelJS from 'exceljs';
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
  uniqueTag,
} from './helpers';

const ik = () => `rep-${uniqueTag()}-${Math.random().toString(36).slice(2, 10)}`;

/** Supertest buffers a binary body into `res.body` only with a parser. */
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Reports (PRD §19, Phase 5)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let m: Masters;
  let locationId: string;
  let otherStoreId: string;
  let otherManager: Actor;
  let cement: { id: string; code: string };
  let wire: { id: string; code: string };

  const admin = () => as(app, fx.admin, fx.projectId);
  const manager = () => as(app, fx.manager, fx.projectId);
  const post = (actor: Actor, url: string, body: object) =>
    as(app, actor, fx.projectId).post(url, body, { 'Idempotency-Key': ik() });
  const report = async (actor: Actor, key: string, query = ''): Promise<ReportDto> =>
    (await as(app, actor, fx.projectId).get(`/reports/${key}${query}`).expect(200))
      .body as ReportDto;
  const rowOf = (r: ReportDto, code: string) => r.rows.find((x) => x.code === code);

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
    m = await loadMasters(app, fx.admin, fx.projectId);

    locationId = (await admin().post('/locations', { name: 'Tower A', type: 'TOWER' }).expect(201))
      .body.id;
    otherStoreId = (await admin().post('/stores', { code: 'YARD', name: 'Yard Store' }).expect(201))
      .body.id;
    otherManager = await createMember(app, fx.projectId, 'STORE_MANAGER', [otherStoreId]);

    const material = async (name: string, unit: string, category: string, minimumStock?: string) =>
      (
        await admin()
          .post('/materials', {
            name: `${name} ${uniqueTag()}`,
            categoryId: m.categoryId(category),
            stockUnitId: m.unitId(unit),
            ...(minimumStock ? { minimumStock } : {}),
          })
          .expect(201)
      ).body as { id: string; code: string };
    cement = await material('Report Cement', 'BAG', 'Cement', '80');
    wire = await material('Report Wire', 'KG', 'Steel');

    // Main store: 100 bags in (5 damaged on delivery), 30 out, 4 back good, 2 back as scrap.
    const receipt = await post(fx.manager, '/inventory/receipts', {
      storeId: fx.storeId,
      supplierName: 'Sri Krishna Traders',
      externalRef: 'INV-77',
      lines: [
        { materialId: cement.id, acceptedQuantity: '100', damagedQuantity: '5' },
        { materialId: wire.id, acceptedQuantity: '50' },
      ],
    }).expect(201);
    expect(receipt.body.referenceNo).toMatch(/^RCV-/);
    await post(fx.manager, '/inventory/issues', {
      storeId: fx.storeId,
      locationId,
      lines: [{ materialId: cement.id, quantity: '30' }],
    }).expect(201);
    await post(fx.manager, '/inventory/returns', {
      storeId: fx.storeId,
      locationId,
      lines: [
        { materialId: cement.id, quantity: '4', condition: 'GOOD' },
        { materialId: cement.id, quantity: '2', condition: 'SCRAP' },
      ],
    }).expect(201);
    // An issue of 10 wire that the admin reverses: it must vanish from "Material Out".
    const wrongIssue = await post(fx.manager, '/inventory/issues', {
      storeId: fx.storeId,
      locationId,
      lines: [{ materialId: wire.id, quantity: '10' }],
    }).expect(201);
    await post(fx.admin, `/inventory/postings/${wrongIssue.body.id}/reverse`, {
      reason: 'Entered twice',
    }).expect(201);

    // Yard store: 20 bags in.
    await post(otherManager, '/inventory/receipts', {
      storeId: otherStoreId,
      lines: [{ materialId: cement.id, acceptedQuantity: '20' }],
    }).expect(201);

    // A physical count in the main store that found 2 bags fewer. It changes nothing until approved.
    await post(fx.manager, '/stock-verifications', {
      storeId: fx.storeId,
      materialId: cement.id,
      physicalQuantity: '72',
      reason: 'Monthly count',
    }).expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists all ten reports for the admin and the six operational ones for a Store Manager (Q18, Q37)', async () => {
    const all = (await admin().get('/reports').expect(200)).body as { key: string }[];
    expect(all.map((r) => r.key)).toEqual([...REPORT_KEYS]);
    const ops = (await manager().get('/reports').expect(200)).body as { key: string }[];
    expect(ops.map((r) => r.key)).toEqual([
      'current-stock',
      'material-in',
      'material-out',
      'material-return',
      'material-movement',
      'low-stock',
    ]);
  });

  it('refuses admin-only reports to a Store Manager in the backend, not only in the menu', async () => {
    for (const key of ['supplier-wise', 'stock-discrepancy', 'ai-processing', 'new-materials']) {
      await manager().get(`/reports/${key}`).expect(403);
      await manager().get(`/reports/${key}/export?format=pdf`).expect(403);
    }
    await manager().get('/reports/no-such-report').expect(404);
  });

  it('keeps a Store Manager to their own stores', async () => {
    await manager().get(`/reports/current-stock?storeId=${otherStoreId}`).expect(403);
    const own = await report(fx.manager, 'current-stock');
    // Without a store filter the manager sees their store only: 74 bags, not 94.
    expect(rowOf(own, cement.code)).toMatchObject({ available: '74' });
  });

  it('Current Stock: project-wide, per store, damaged and scrap apart', async () => {
    const wide = await report(fx.admin, 'current-stock');
    expect(rowOf(wide, cement.code)).toMatchObject({
      available: '94',
      damaged: '5',
      scrap: '2',
      status: 'Available',
    });
    const byStore = await report(fx.admin, 'current-stock', '?byStore=true');
    const cementRows = byStore.rows.filter((r) => r.code === cement.code);
    expect(cementRows.map((r) => [r.store, r.available]).sort()).toEqual([
      ['Main Store', '74'],
      ['Yard Store', '20'],
    ]);
    const yard = await report(fx.admin, 'current-stock', `?storeId=${otherStoreId}`);
    expect(rowOf(yard, cement.code)).toMatchObject({ available: '20', damaged: '0' });
  });

  it('Material Movement: opening + in + reusable returns − out + adjustments = closing (§19.1, Q16)', async () => {
    const r = await report(fx.admin, 'material-movement', `?storeId=${fx.storeId}`);
    expect(rowOf(r, cement.code)).toMatchObject({
      opening: '0',
      received: '100',
      returns: '4',
      issued: '30',
      adjustments: '0',
      closing: '74',
      damaged: '5',
      scrap: '2',
    });
    // The reversed wire issue is netted out of "Material Out".
    expect(rowOf(r, wire.code)).toMatchObject({ received: '50', issued: '0', closing: '50' });

    for (const row of r.rows) {
      const n = (k: string) => Number(row[k]);
      expect(n('opening') + n('received') + n('returns') - n('issued') + n('adjustments')).toBe(
        n('closing'),
      );
    }
  });

  it('Material Movement: activity before the period becomes opening stock', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await report(
      fx.admin,
      'material-movement',
      `?storeId=${fx.storeId}&from=${tomorrow}&to=${tomorrow}`,
    );
    expect(rowOf(r, cement.code)).toMatchObject({
      opening: '74',
      received: '0',
      issued: '0',
      closing: '74',
    });
  });

  it('Material In / Out / Return list the lines with their details', async () => {
    const inn = await report(fx.manager, 'material-in');
    const cementIn = inn.rows.filter((r) => r.code === cement.code);
    expect(cementIn.map((r) => [r.kind, r.quantity]).sort()).toEqual([
      ['Damaged on delivery', '5'],
      ['Good (available)', '100'],
    ]);
    expect(cementIn[0]).toMatchObject({ supplier: 'Sri Krishna Traders', document: 'INV-77' });

    const out = await report(fx.manager, 'material-out');
    expect(out.rows.find((r) => r.code === cement.code)).toMatchObject({
      quantity: '30',
      location: 'Tower A',
      status: 'Posted',
    });
    expect(out.rows.find((r) => r.code === wire.code)).toMatchObject({ status: 'Reversed' });

    const ret = await report(fx.manager, 'material-return');
    expect(
      ret.rows
        .filter((r) => r.code === cement.code)
        .map((r) => r.condition)
        .sort(),
    ).toEqual(['Good (reusable)', 'Scrap']);
  });

  it('Low Stock: judged on the whole project against the minimum', async () => {
    const before = await report(fx.manager, 'low-stock');
    expect(rowOf(before, cement.code)).toBeUndefined(); // 94 > 80
    await post(fx.manager, '/inventory/issues', {
      storeId: fx.storeId,
      locationId,
      lines: [{ materialId: cement.id, quantity: '15' }],
    }).expect(201);
    const after = await report(fx.manager, 'low-stock');
    expect(rowOf(after, cement.code)).toMatchObject({
      available: '79',
      minimum: '80',
      shortfall: '1',
      status: 'Low stock',
    });
  });

  it('Supplier-wise, Discrepancy and New Material reports for the admin', async () => {
    const sup = await report(fx.admin, 'supplier-wise');
    expect(
      sup.rows.find((r) => r.code === cement.code && r.supplier === 'Sri Krishna Traders'),
    ).toMatchObject({ accepted: '100', damaged: '5', receipts: 1 });
    expect(
      sup.rows.find((r) => r.code === cement.code && r.supplier !== 'Sri Krishna Traders'),
    ).toMatchObject({ supplier: '(supplier not recorded)', accepted: '20' });

    const disc = await report(fx.admin, 'stock-discrepancy');
    expect(rowOf(disc, cement.code)).toMatchObject({
      system: '74',
      physical: '72',
      difference: '-2',
      status: 'Waiting for approval',
    });

    const created = await report(fx.admin, 'new-materials');
    expect(rowOf(created, cement.code)).toMatchObject({ source: 'Entered by hand' });

    const ai = await report(fx.admin, 'ai-processing');
    expect(ai.rows).toEqual([]);
  });

  it('rejects a start date after the end date', async () => {
    const res = await admin().get('/reports/material-in?from=2026-02-01&to=2026-01-01').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('exports Excel and PDF with the same rows, and records the export in the audit log', async () => {
    const xlsx = await manager()
      .get('/reports/current-stock/export?format=xlsx')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    expect(xlsx.headers['content-disposition']).toMatch(/kavach-current-stock-.*\.xlsx/);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(xlsx.body as Buffer).buffer);
    const values = book.worksheets[0]!.getSheetValues().flat().map(String);
    expect(values).toContain('Current Stock Report');
    expect(values.some((v) => v.startsWith('Report Cement'))).toBe(true);

    const pdf = await admin()
      .get('/reports/material-movement/export?format=pdf&byStore=true')
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');

    await admin().get('/reports/low-stock/export?format=csv').expect(400);

    const audit = await rawDb(app).auditLog.findMany({
      where: { projectId: fx.projectId, action: 'report.export' },
    });
    expect(audit.map((a) => a.entityId).sort()).toEqual(['current-stock', 'material-movement']);
  });

  it('never writes a spreadsheet formula from data', async () => {
    await admin()
      .post('/materials', {
        name: `=HYPERLINK("http://x") ${uniqueTag()}`,
        categoryId: m.categoryId('Steel'),
        stockUnitId: m.unitId('KG'),
      })
      .expect(201);
    const xlsx = await admin()
      .get('/reports/new-materials/export?format=xlsx')
      .buffer(true)
      .parse(binary)
      .expect(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(new Uint8Array(xlsx.body as Buffer).buffer);
    let formulas = 0;
    book.worksheets[0]!.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.type === ExcelJS.ValueType.Formula) formulas += 1;
      }),
    );
    expect(formulas).toBe(0);
  });
});

describe('Hardening (PRD §25.2, Phase 5)', () => {
  let app: INestApplication;
  let fx: Fixture;

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const attempt = (identifier: string, password: string, ip: string) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ identifier, password, client: 'mobile' });

  it('a login locked from one address still works from another, and the count is in the database', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt(fx.manager.email, 'wrong-password1', '203.0.113.7').expect(401);
    }
    const locked = await attempt(fx.manager.email, 'Passw0rd!1', '203.0.113.7').expect(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    // The owner, elsewhere, is not locked out by someone who knows their login name.
    await attempt(fx.manager.email, 'Passw0rd!1', '198.51.100.20').expect(200);

    const rows = await rawDb(app).$queryRaw<{ count: number }[]>`
      SELECT count FROM rate_limits WHERE key = ${`login:pair:${fx.manager.email}|203.0.113.7`}`;
    expect(rows[0]?.count).toBe(10);
  });

  it('limits failed logins per address across login names', async () => {
    const ip = '203.0.113.99';
    for (let i = 0; i < 40; i += 1) {
      await attempt(`nobody${i}@test.local`, 'wrong-password1', ip).expect(401);
    }
    await attempt(fx.admin.email, 'Passw0rd!1', ip).expect(429);
  });

  it('sends security headers and a request id on every answer', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('reports readiness only when the database answers', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'api' });
  });

  it('hides internal errors behind a stable message', async () => {
    const res = await as(app, fx.admin, fx.projectId).get('/reports/current-stock?storeId=bad');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/prisma|stack|at \w+ \(/i);
  });
});
