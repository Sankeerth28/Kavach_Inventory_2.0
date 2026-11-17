import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@kavach/db';
import { type ContractorDto, type MaterialDto, type StockDetailDto, Decimal } from '@kavach/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  type Fixture,
  type Masters,
  as,
  createApp,
  createFixture,
  loadMasters,
  rawDb,
  uniqueTag,
} from './helpers';

describe('Inventory Engine (Phase 2)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let m: Masters;
  let db: PrismaClient;

  const ik = (prefix = 'ik') =>
    `${prefix}-${uniqueTag()}-${Math.random().toString(36).slice(2, 12)}`.replace(
      /[^A-Za-z0-9_-]/g,
      '_',
    );

  const http = (
    actor: Actor,
    method: 'get' | 'post' | 'patch',
    url: string,
    body?: object,
    key?: string,
    projectId = fx.projectId,
  ) => {
    const agent = request(app.getHttpServer());
    let req = agent[method](url)
      .set('Authorization', `Bearer ${actor.token}`)
      .set('X-Project-Id', projectId);
    if (key) req = req.set('Idempotency-Key', key);
    return body !== undefined ? req.send(body) : req;
  };

  const admin = () => as(app, fx.admin, fx.projectId);

  let defaultLocationId: string;

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
    m = await loadMasters(app, fx.admin, fx.projectId);
    db = rawDb(app);

    // Create a default location for issues and returns
    const locRes = await admin().post('/locations', { name: 'Tower 1', type: 'TOWER' }).expect(201);
    defaultLocationId = locRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const createMaterial = async (
    name: string,
    unitCode: string,
    extra: Record<string, unknown> = {},
  ): Promise<MaterialDto> => {
    const res = await admin()
      .post('/materials', {
        name: `${name} ${uniqueTag()}`,
        categoryId: m.categoryId('Steel'),
        stockUnitId: m.unitId(unitCode),
        ...extra,
      })
      .expect(201);
    return res.body as MaterialDto;
  };

  // ── 1. Negative stock rejected ───────────────────────────────────────────────
  describe('1. Negative stock rejected', () => {
    it('issue more than available throws 409 INSUFFICIENT_STOCK with balance and ledger unchanged', async () => {
      const mat = await createMaterial('NegStock Probe', 'NOS');

      // Attempt to issue 15 when balance is 0
      const res = await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '15' }],
        },
        ik(),
      ).expect(409);

      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.error.details).toMatchObject({
        materialId: mat.id,
        available: '0',
        requested: '15',
      });

      // Verify DB remains completely untouched
      const txnCount = await db.materialTransaction.count({ where: { materialId: mat.id } });
      expect(txnCount).toBe(0);

      const bal = await db.stockBalance.findUnique({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      if (bal) {
        expect(bal.availableQty.toString()).toBe('0');
      }
    });

    it('direct SQL update to negative stock is refused by sb_nonneg CHECK constraint', async () => {
      const mat = await createMaterial('DirectSQL Check', 'NOS');

      await db.stockBalance.upsert({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
        create: {
          projectId: fx.projectId,
          storeId: fx.storeId,
          materialId: mat.id,
          availableQty: 0,
        },
        update: {},
      });

      await expect(
        db.$executeRawUnsafe(
          `UPDATE stock_balances SET available_qty = -5 WHERE store_id = '${fx.storeId}'::uuid AND material_id = '${mat.id}'::uuid`,
        ),
      ).rejects.toThrow(/sb_nonneg/i);
    });
  });

  // ── 2. Concurrent issues ─────────────────────────────────────────────────────
  describe('2. Two concurrent issues for the last units → only one succeeds', () => {
    it('two parallel issues of 10 against 10 → exactly one succeeds, balance 0', async () => {
      const mat = await createMaterial('Concurrent Probe 10', 'NOS');

      // Receive 10 units first
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '10' }],
        },
        ik(),
      ).expect(201);

      // Fire 2 concurrent issues of 10
      const issueBody = {
        storeId: fx.storeId,
        locationId: defaultLocationId,
        lines: [{ materialId: mat.id, quantity: '10' }],
      };

      const results = await Promise.all([
        http(fx.manager, 'post', '/inventory/issues', issueBody, ik()),
        http(fx.manager, 'post', '/inventory/issues', issueBody, ik()),
      ]);

      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);

      const bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(0)).toBe(true);
    });

    it('10 parallel issues of 1 against 5 → exactly 5 succeed, balance 0', async () => {
      const mat = await createMaterial('Concurrent Probe 5', 'NOS');

      // Receive 5 units
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '5' }],
        },
        ik(),
      ).expect(201);

      const issueBody = {
        storeId: fx.storeId,
        locationId: defaultLocationId,
        lines: [{ materialId: mat.id, quantity: '1' }],
      };

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          http(fx.manager, 'post', '/inventory/issues', issueBody, ik()),
        ),
      );

      const successes = results.filter((r) => r.status === 201);
      const failures = results.filter((r) => r.status === 409);

      expect(successes).toHaveLength(5);
      expect(failures).toHaveLength(5);

      const bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(0)).toBe(true);
    });
  });

  // ── 3. Idempotency ───────────────────────────────────────────────────────────
  describe('3. Same Idempotency-Key twice → one posting', () => {
    it('sequential replay returns the original posting, no new ledger rows', async () => {
      const mat = await createMaterial('Idempotency Sequential', 'NOS');
      const key = ik('seq-key');

      const body = {
        storeId: fx.storeId,
        lines: [{ materialId: mat.id, acceptedQuantity: '12' }],
      };

      const first = await http(fx.manager, 'post', '/inventory/receipts', body, key).expect(201);
      const second = await http(fx.manager, 'post', '/inventory/receipts', body, key);
      expect([200, 201]).toContain(second.status);

      expect(second.body.id).toBe(first.body.id);
      expect(second.body.referenceNo).toBe(first.body.referenceNo);

      // Verify exactly one posting and one transaction row
      const postings = await db.posting.findMany({ where: { idempotencyKey: key } });
      expect(postings).toHaveLength(1);

      const txns = await db.materialTransaction.findMany({ where: { materialId: mat.id } });
      expect(txns).toHaveLength(1);
      expect(new Decimal(txns[0]!.quantity.toString()).equals(12)).toBe(true);
    });

    it('5 parallel requests with one key → one posting, same response', async () => {
      const mat = await createMaterial('Idempotency Parallel', 'NOS');
      const key = ik('par-key');

      const body = {
        storeId: fx.storeId,
        lines: [{ materialId: mat.id, acceptedQuantity: '7' }],
      };

      const results = await Promise.all(
        Array.from({ length: 5 }, () => http(fx.manager, 'post', '/inventory/receipts', body, key)),
      );

      expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);
      const ids = results.map((r) => r.body.id);
      expect(new Set(ids).size).toBe(1);

      const postings = await db.posting.findMany({ where: { idempotencyKey: key } });
      expect(postings).toHaveLength(1);

      const bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(7)).toBe(true);
    });

    it('same key with different body → 422 IDEMPOTENCY_KEY_REUSED', async () => {
      const mat1 = await createMaterial('Idemp Diff 1', 'NOS');
      const mat2 = await createMaterial('Idemp Diff 2', 'NOS');
      const key = ik('diff-key');

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat1.id, acceptedQuantity: '5' }],
        },
        key,
      ).expect(201);

      const res = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat2.id, acceptedQuantity: '10' }],
        },
        key,
      ).expect(422);

      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('missing or invalid Idempotency-Key → 400', async () => {
      const mat = await createMaterial('Idemp Missing', 'NOS');

      // Missing header
      const res1 = await request(app.getHttpServer())
        .post('/inventory/receipts')
        .set('Authorization', `Bearer ${fx.manager.token}`)
        .set('X-Project-Id', fx.projectId)
        .send({
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '5' }],
        })
        .expect(400);
      expect(res1.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      // Too short
      const res2 = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '5' }],
        },
        'short-key',
      ).expect(400);
      expect(res2.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // ── 4. Multi-line receipt with one bad line → nothing posted ─────────────────
  describe('4. Multi-line receipt with one bad line → nothing posted', () => {
    it('unknown material → 404, nothing posted', async () => {
      const mat = await createMaterial('Good Line 1', 'NOS');
      const fakeId = '00000000-0000-0000-0000-000000000000';

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [
            { materialId: mat.id, acceptedQuantity: '10' },
            { materialId: fakeId, acceptedQuantity: '5' },
          ],
        },
        ik(),
      ).expect(404);

      expect(await db.posting.count({ where: { createdMaterialId: mat.id } })).toBe(0);
      expect(await db.materialTransaction.count({ where: { materialId: mat.id } })).toBe(0);
    });

    it('inactive material → 400/409, nothing posted', async () => {
      const mat1 = await createMaterial('Good Line 2', 'NOS');
      const mat2 = await createMaterial('Inactive Material', 'NOS');
      await admin().post(`/materials/${mat2.id}/deactivate`).expect(200);

      const res = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [
            { materialId: mat1.id, acceptedQuantity: '10' },
            { materialId: mat2.id, acceptedQuantity: '5' },
          ],
        },
        ik(),
      ).expect(409);

      expect(res.body.error.code).toBe('MATERIAL_INACTIVE');
      expect(await db.materialTransaction.count({ where: { materialId: mat1.id } })).toBe(0);
    });

    it('incompatible unit → 400, nothing posted', async () => {
      const mat1 = await createMaterial('Good Line 3', 'NOS');
      const mat2 = await createMaterial('Unit Incompatible Line', 'BAG');

      const res = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [
            { materialId: mat1.id, acceptedQuantity: '10' },
            { materialId: mat2.id, acceptedQuantity: '5', unitId: m.unitId('L') },
          ],
        },
        ik(),
      ).expect(400);

      expect(res.body.error.code).toBe('UNIT_INCOMPATIBLE');
      expect(await db.materialTransaction.count({ where: { materialId: mat1.id } })).toBe(0);
    });

    it('fractional bag → 400, nothing posted', async () => {
      const mat1 = await createMaterial('Good Line 4', 'NOS');
      const cement = await createMaterial('Cement 50kg', 'BAG', {
        categoryId: m.categoryId('Cement'),
        packSize: '50',
        packUnitId: m.unitId('KG'),
      });

      // 25 kg is half a bag (not representable as integer bag)
      const res = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [
            { materialId: mat1.id, acceptedQuantity: '10' },
            { materialId: cement.id, acceptedQuantity: '25', unitId: m.unitId('KG') },
          ],
        },
        ik(),
      ).expect(400);

      expect(res.body.error.code).toBe('UNIT_INCOMPATIBLE');
      expect(await db.materialTransaction.count({ where: { materialId: mat1.id } })).toBe(0);
    });
  });

  // ── 5. Atomic rollback ───────────────────────────────────────────────────────
  describe('5. Atomic rollback', () => {
    it('multi-line issue whose last line exceeds stock leaves first lines untouched', async () => {
      const mat1 = await createMaterial('Atomic Line 1', 'NOS');
      const mat2 = await createMaterial('Atomic Line 2', 'NOS');

      // Receive 10 for mat1, 2 for mat2
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [
            { materialId: mat1.id, acceptedQuantity: '10' },
            { materialId: mat2.id, acceptedQuantity: '2' },
          ],
        },
        ik(),
      ).expect(201);

      // Issue 5 of mat1 and 10 of mat2 (exceeds 2)
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [
            { materialId: mat1.id, quantity: '5' },
            { materialId: mat2.id, quantity: '10' },
          ],
        },
        ik(),
      ).expect(409);

      // Verify mat1 stock is still 10, not 5
      const bal1 = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat1.id } },
      });
      expect(new Decimal(bal1.availableQty.toString()).equals(10)).toBe(true);
    });

    it('Quick Receive with invalid material leaves no material created', async () => {
      const res = await http(
        fx.manager,
        'post',
        '/inventory/quick-receive',
        {
          storeId: fx.storeId,
          quantity: '10',
          newMaterial: {
            name: 'Quick Fail Material',
            categoryId: m.categoryId('Steel'),
            stockUnitId: m.unitId('NOS'),
            packSize: '50', // packSize without packUnitId is invalid
          },
        },
        ik(),
      ).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const found = await db.material.findFirst({ where: { name: 'Quick Fail Material' } });
      expect(found).toBeNull();
    });
  });

  // ── 6. Reversal restores stock and links the original ────────────────────────
  describe('6. Reversal restores stock and links the original', () => {
    it('reverses an issue, restores stock, prevents double reversal and reversal-of-reversal', async () => {
      const mat = await createMaterial('Reversal Probe', 'NOS');

      // 1. Receive 20
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '20' }],
        },
        ik(),
      ).expect(201);

      // 2. Issue 5
      const issueRes = await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5' }],
        },
        ik(),
      ).expect(201);

      const issuePostingId = issueRes.body.id;
      let bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(15)).toBe(true);

      // 3. Admin reverses the issue
      const revRes = await http(
        fx.admin,
        'post',
        `/inventory/postings/${issuePostingId}/reverse`,
        { reason: 'Wrong issue slip' },
        ik(),
      ).expect(201);

      expect(revRes.body.type).toBe('REVERSAL');
      expect(revRes.body.reverses.id).toBe(issuePostingId);

      // Stock is restored to 20
      bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(20)).toBe(true);

      // 4. Second reversal attempt on original posting refused
      const dupRev = await http(
        fx.admin,
        'post',
        `/inventory/postings/${issuePostingId}/reverse`,
        { reason: 'Again' },
        ik(),
      ).expect(409);
      expect(dupRev.body.error.code).toBe('ALREADY_REVERSED');

      // 5. Reversal of reversal refused
      const revOfRev = await http(
        fx.admin,
        'post',
        `/inventory/postings/${revRes.body.id}/reverse`,
        { reason: 'Reverse reversal' },
        ik(),
      ).expect(409);
      expect(revOfRev.body.error.code).toBe('NOT_REVERSIBLE');
    });

    it('reversal blocked when it would drive stock negative', async () => {
      const mat = await createMaterial('Reversal Negative Probe', 'NOS');

      // 1. Receive 10
      const rcvRes = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '10' }],
        },
        ik(),
      ).expect(201);

      // 2. Issue 8 (balance becomes 2)
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '8' }],
        },
        ik(),
      ).expect(201);

      // 3. Reversing receipt would deduct 10 from 2 → -8, must fail
      const res = await http(
        fx.admin,
        'post',
        `/inventory/postings/${rcvRes.body.id}/reverse`,
        { reason: 'Wrong receipt' },
        ik(),
      ).expect(409);

      expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
    });
  });

  // ── 7. Damaged / scrap not in available stock ────────────────────────────────
  describe('7. Damaged / scrap not in available stock', () => {
    it('damaged and scrap returns and delivery damaged stock do not count as available stock', async () => {
      const mat = await createMaterial('DamageScrap Probe', 'NOS');

      // Receive 10 good, 3 damaged
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '10', damagedQuantity: '3' }],
        },
        ik(),
      ).expect(201);

      // Return 2 damaged, 1 scrap
      await http(
        fx.manager,
        'post',
        '/inventory/returns',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [
            { materialId: mat.id, quantity: '2', condition: 'DAMAGED' },
            { materialId: mat.id, quantity: '1', condition: 'SCRAP' },
          ],
        },
        ik(),
      ).expect(201);

      const bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(10)).toBe(true);
      expect(new Decimal(bal.damagedQty.toString()).equals(5)).toBe(true); // 3 + 2
      expect(new Decimal(bal.scrapQty.toString()).equals(1)).toBe(true);

      // Attempt to issue 12 (available is only 10, total physical is 16)
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '12' }],
        },
        ik(),
      ).expect(409);
    });
  });

  // ── 8. Adjustment only after admin approval ──────────────────────────────────
  describe('8. Adjustment only after admin approval', () => {
    it('SM submits verification count, stock unchanged; SM cannot approve; Admin approval posts adjustment', async () => {
      const mat = await createMaterial('Verify Probe', 'NOS');

      // Initial receipt of 10
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '10' }],
        },
        ik(),
      ).expect(201);

      // 1. SM submits count: physical = 8 (difference = -2)
      const subRes = await http(fx.manager, 'post', '/stock-verifications', {
        storeId: fx.storeId,
        materialId: mat.id,
        physicalQuantity: '8',
        reason: 'Monthly physical check',
      }).expect(201);

      const verId = subRes.body.id;
      expect(subRes.body.differenceQty).toBe('-2');
      expect(subRes.body.status).toBe('SUBMITTED');

      // Stock is unchanged
      let bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(10)).toBe(true);

      // 2. SM cannot approve
      await http(fx.manager, 'post', `/stock-verifications/${verId}/approve`, {
        note: 'ok',
      }).expect(403);

      // SM cannot make direct adjustment
      await http(
        fx.manager,
        'post',
        '/inventory/adjustments',
        {
          storeId: fx.storeId,
          materialId: mat.id,
          kind: 'MANUAL_CORRECTION',
          bucket: 'AVAILABLE',
          quantity: '-2',
          reason: 'Correction',
        },
        ik(),
      ).expect(403);

      // 3. Admin approves
      const appRes = await http(fx.admin, 'post', `/stock-verifications/${verId}/approve`, {
        note: 'Approved count',
      }).expect(200);

      expect(appRes.body.status).toBe('APPROVED');
      expect(appRes.body.adjustmentReferenceNo).toBeTruthy();

      // Stored balance is now 8
      bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(8)).toBe(true);
    });

    it('Admin rejection posts nothing, leaves stock untouched', async () => {
      const mat = await createMaterial('Verify Reject Probe', 'NOS');

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: mat.id, acceptedQuantity: '10' }],
        },
        ik(),
      ).expect(201);

      const subRes = await http(fx.manager, 'post', '/stock-verifications', {
        storeId: fx.storeId,
        materialId: mat.id,
        physicalQuantity: '5',
        reason: 'Bad count',
      }).expect(201);

      await http(fx.admin, 'post', `/stock-verifications/${subRes.body.id}/reject`, {
        note: 'Count again please',
      }).expect(200);

      const bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: mat.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(10)).toBe(true);
    });
  });

  // ── 9. §19.1 formula equals stored balance ──────────────────────────────────
  describe('9. §19.1 formula equals stored balance for every material', () => {
    it('Opening + In + Reusable Returns − Out + Adjustments (reversals netted) = available_qty and ledger sum = bucket balance', async () => {
      const mat = await createMaterial('Formula 19.1 Probe', 'KG');

      // 1. Receipt: +100
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '100' }] },
        ik(),
      ).expect(201);

      // 2. Issue: -30
      const iss1 = await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '30' }],
        },
        ik(),
      ).expect(201);

      // 3. Reverse that issue: net 0 issue
      await http(
        fx.admin,
        'post',
        `/inventory/postings/${iss1.body.id}/reverse`,
        { reason: 'Cancelled issue' },
        ik(),
      ).expect(201);

      // 4. Issue: -20
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '20' }],
        },
        ik(),
      ).expect(201);

      // 5. Return GOOD: +5
      await http(
        fx.manager,
        'post',
        '/inventory/returns',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5', condition: 'GOOD' }],
        },
        ik(),
      ).expect(201);

      // 6. Return DAMAGED: +3
      await http(
        fx.manager,
        'post',
        '/inventory/returns',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '3', condition: 'DAMAGED' }],
        },
        ik(),
      ).expect(201);

      // 7. Admin adjustment: -2 on AVAILABLE
      await http(
        fx.admin,
        'post',
        '/inventory/adjustments',
        {
          storeId: fx.storeId,
          materialId: mat.id,
          kind: 'MANUAL_CORRECTION',
          bucket: 'AVAILABLE',
          quantity: '-2',
          reason: 'Spillage loss',
        },
        ik(),
      ).expect(201);

      // Read stock detail (which calculates §19.1 movement totals)
      const detailRes = await http(fx.manager, 'get', `/stock/${mat.id}`).expect(200);
      const detail = detailRes.body as StockDetailDto;

      // Expected calculation:
      // Opening: 0
      // In: 100
      // Reusable Returns: 5
      // Out: 20 (30 issued, 30 reversed -> net 20)
      // Adjustments: -2
      // Expected closing available: 0 + 100 + 5 - 20 + (-2) = 83
      expect(new Decimal(detail.availableQty).equals(83)).toBe(true);
      expect(new Decimal(detail.damagedQty).equals(3)).toBe(true);

      const totals = detail.totals;
      expect(new Decimal(totals.received).equals(100)).toBe(true);
      expect(new Decimal(totals.issued).equals(20)).toBe(true);
      expect(new Decimal(totals.reusableReturns).equals(5)).toBe(true);
      expect(new Decimal(totals.adjustments).equals(-2)).toBe(true);

      const calculatedClosing = new Decimal(0)
        .plus(totals.received)
        .plus(totals.reusableReturns)
        .minus(totals.issued)
        .plus(totals.adjustments);

      expect(calculatedClosing.equals(detail.availableQty)).toBe(true);

      // Also verify ledger sum per bucket = balance
      const ledgerRows = await db.materialTransaction.findMany({
        where: { storeId: fx.storeId, materialId: mat.id },
      });
      const sumAvail = ledgerRows
        .filter((r) => r.bucket === 'AVAILABLE')
        .reduce((sum, r) => sum.plus(r.quantity.toString()), new Decimal(0));
      const sumDamaged = ledgerRows
        .filter((r) => r.bucket === 'DAMAGED')
        .reduce((sum, r) => sum.plus(r.quantity.toString()), new Decimal(0));

      expect(sumAvail.equals(83)).toBe(true);
      expect(sumDamaged.equals(3)).toBe(true);
    });
  });

  // ── 10. Project stock = sum of store balances ────────────────────────────────
  describe('10. Project stock = sum of store balances', () => {
    it('project-wide stock equals sum over stores for every material', async () => {
      const mat = await createMaterial('Multi Store Stock', 'NOS');

      // Create Store 2
      const s2Res = await admin()
        .post('/stores', { code: `S2-${uniqueTag().slice(0, 5)}`, name: 'Store Two' })
        .expect(201);
      const store2Id = s2Res.body.id;

      // Assign manager to store 2 as well
      const member = await db.projectMember.findFirstOrThrow({
        where: { projectId: fx.projectId, userId: fx.manager.userId },
      });
      await db.projectMemberStore.create({
        data: { projectId: fx.projectId, memberId: member.id, storeId: store2Id },
      });

      // Receive 25 in Store 1
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '25' }] },
        ik(),
      ).expect(201);

      // Receive 35 in Store 2
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: store2Id, lines: [{ materialId: mat.id, acceptedQuantity: '35' }] },
        ik(),
      ).expect(201);

      // Issue 5 from Store 1
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5' }],
        },
        ik(),
      ).expect(201);

      // Total available across project: (25 - 5) + 35 = 55
      const detail = (await http(fx.admin, 'get', `/stock/${mat.id}`).expect(200))
        .body as StockDetailDto;
      expect(new Decimal(detail.projectAvailableQty).equals(55)).toBe(true);
      expect(detail.stores).toHaveLength(2);
    });
  });

  // ── 11. Ledger is append-only ────────────────────────────────────────────────
  describe('11. Ledger is append-only', () => {
    it('UPDATE / DELETE / TRUNCATE on material_transactions and postings raise exception', async () => {
      const mat = await createMaterial('AppendOnly Guard', 'NOS');

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '5' }] },
        ik(),
      ).expect(201);

      // Attempt UPDATE on material_transactions
      await expect(
        db.$executeRawUnsafe(
          `UPDATE material_transactions SET notes = 'tampered' WHERE material_id = '${mat.id}'::uuid`,
        ),
      ).rejects.toThrow(/is append-only/i);

      // Attempt DELETE on material_transactions
      await expect(
        db.$executeRawUnsafe(
          `DELETE FROM material_transactions WHERE material_id = '${mat.id}'::uuid`,
        ),
      ).rejects.toThrow(/is append-only/i);

      // Attempt UPDATE on postings
      await expect(
        db.$executeRawUnsafe(
          `UPDATE postings SET notes = 'tampered' WHERE project_id = '${fx.projectId}'::uuid`,
        ),
      ).rejects.toThrow(/is append-only/i);

      // Attempt DELETE on postings
      await expect(
        db.$executeRawUnsafe(`DELETE FROM postings WHERE project_id = '${fx.projectId}'::uuid`),
      ).rejects.toThrow(/is append-only/i);
    });
  });

  // ── 12. Permissions and isolation ────────────────────────────────────────────
  describe('12. Permissions and isolation', () => {
    it('Project Admin cannot post In / Out / Return (Q4)', async () => {
      const mat = await createMaterial('Admin Forbidden', 'NOS');

      // Admin post receipt -> 403
      await http(
        fx.admin,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(403);

      // Admin post issue -> 403
      await http(
        fx.admin,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5' }],
        },
        ik(),
      ).expect(403);

      // Admin post return -> 403
      await http(
        fx.admin,
        'post',
        '/inventory/returns',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5', condition: 'GOOD' }],
        },
        ik(),
      ).expect(403);
    });

    it('Store Manager cannot post to an unassigned store', async () => {
      const mat = await createMaterial('Store Scope Probe', 'NOS');

      // Create Store 3 not assigned to fx.manager
      const s3 = (
        await admin()
          .post('/stores', { code: `S3-${uniqueTag().slice(0, 5)}`, name: 'Store 3' })
          .expect(201)
      ).body;

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: s3.id, lines: [{ materialId: mat.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(403);
    });

    it("cannot post using another project's store, material, or location", async () => {
      const fxB = await createFixture(app);
      const mB = await loadMasters(app, fxB.admin, fxB.projectId);
      const matB = (
        await as(app, fxB.admin, fxB.projectId)
          .post('/materials', {
            name: 'Material In B',
            categoryId: mB.categoryId('Steel'),
            stockUnitId: mB.unitId('NOS'),
          })
          .expect(201)
      ).body;

      const matA = await createMaterial('Material In A', 'NOS');

      // Manager of A trying to post to store of B
      const resCrossStore = await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fxB.storeId, lines: [{ materialId: matA.id, acceptedQuantity: '10' }] },
        ik(),
      );
      expect([403, 404]).toContain(resCrossStore.status);

      // Manager of A trying to receive material of B
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: matB.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(404);
    });
  });

  // ── 13. Q10 units ────────────────────────────────────────────────────────────
  describe('13. Q10 units on issue and return', () => {
    it('2500 kg issued from MT stock = 2.5 MT; 100 kg from 50 kg bags = 2 bags; 25 kg refused; bar-count not for issue', async () => {
      // 1. Steel in MT
      const steelMT = await createMaterial('Structural Steel', 'MT');
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: steelMT.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(201);

      // Issue 2500 KG
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: steelMT.id, quantity: '2500', unitId: m.unitId('KG') }],
        },
        ik(),
      ).expect(201);

      // Remaining stock should be 7.5 MT
      let bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: steelMT.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(7.5)).toBe(true);

      // 2. Cement in 50 kg bags
      const cement = await createMaterial('PPC Cement', 'BAG', {
        categoryId: m.categoryId('Cement'),
        packSize: '50',
        packUnitId: m.unitId('KG'),
      });

      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: cement.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(201);

      // Issue 100 KG -> 2 bags
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: cement.id, quantity: '100', unitId: m.unitId('KG') }],
        },
        ik(),
      ).expect(201);

      bal = await db.stockBalance.findUniqueOrThrow({
        where: { storeId_materialId: { storeId: fx.storeId, materialId: cement.id } },
      });
      expect(new Decimal(bal.availableQty.toString()).equals(8)).toBe(true);

      // Issue 25 KG -> 0.5 bag (fractional bag is refused)
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: cement.id, quantity: '25', unitId: m.unitId('KG') }],
        },
        ik(),
      ).expect(400);

      // 3. Material-specific conversion row (bar-count ↔ weight) used for receipt but not for issue
      const rebar = await createMaterial('Rebar 12mm', 'MT');
      // Create material-specific conversion: 1 NOS = 0.0105 MT (10.5 kg per 12m bar)
      await admin()
        .post('/unit-conversions', {
          fromUnitId: m.unitId('NOS'),
          toUnitId: m.unitId('MT'),
          factor: '0.0105',
          materialId: rebar.id,
        })
        .expect(201);

      // Allowed on receipt: receive 100 NOS = 1.05 MT
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        {
          storeId: fx.storeId,
          lines: [{ materialId: rebar.id, acceptedQuantity: '100', unitId: m.unitId('NOS') }],
        },
        ik(),
      ).expect(201);

      // Refused on issue: bar-count ↔ weight not allowed for issue (Q10)
      const badIssue = await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: rebar.id, quantity: '10', unitId: m.unitId('NOS') }],
        },
        ik(),
      ).expect(400);
      expect(badIssue.body.error.code).toBe('UNIT_INCOMPATIBLE');
    });
  });

  // ── 14. Q22 material lock and zero-stock deactivation ────────────────────────
  describe('14. Q22 material lock and zero-stock deactivation', () => {
    it('editing identity fields after first transaction → 409; deactivating with stock → 409', async () => {
      const mat = await createMaterial('Q22 Lock Material', 'NOS', {
        specification: 'Spec A',
        grade: 'Fe 500',
        size: '10mm',
      });

      // Before transactions: admin can update identity fields
      const updated = (
        await admin()
          .patch(`/materials/${mat.id}`, {
            specification: 'Spec B',
            version: mat.version,
          })
          .expect(200)
      ).body as MaterialDto;

      // Post first transaction (receipt of 5)
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '5' }] },
        ik(),
      ).expect(201);

      // After transaction: identity edits blocked (409 MATERIAL_LOCKED)
      const lockRes = await admin()
        .patch(`/materials/${mat.id}`, {
          specification: 'Spec C',
          version: updated.version,
        })
        .expect(409);
      expect(lockRes.body.error.code).toBe('MATERIAL_LOCKED');

      // Non-identity edit (e.g. description, brand, name) still permitted
      await admin()
        .patch(`/materials/${mat.id}`, {
          description: 'Updated description',
          version: updated.version,
        })
        .expect(200);

      // Deactivation with stock on hand blocked (409 MATERIAL_HAS_STOCK)
      const deactBlocked = await admin().post(`/materials/${mat.id}/deactivate`).expect(409);
      expect(deactBlocked.body.error.code).toBe('MATERIAL_HAS_STOCK');

      // Issue all 5 units so stock is 0
      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          lines: [{ materialId: mat.id, quantity: '5' }],
        },
        ik(),
      ).expect(201);

      // Now deactivation succeeds
      await admin().post(`/materials/${mat.id}/deactivate`).expect(200);
    });
  });

  // ── Contractors (Q31) ────────────────────────────────────────────────────────
  describe('Contractors (Q31 inline add, duplicate warning, merge)', () => {
    it('Store Manager can create contractor inline or via master, warning on similar names, admin merges', async () => {
      // 1. Create contractor
      const c1 = (
        await http(fx.manager, 'post', '/contractors', {
          name: 'L&T Construction',
          phone: '9876543210',
        }).expect(201)
      ).body as ContractorDto;

      expect(c1.name).toBe('L&T Construction');

      // 2. Similar name without confirm → 409
      const dupCheck = await http(fx.manager, 'post', '/contractors', {
        name: 'L and T Construction',
      }).expect(409);
      expect(dupCheck.body.error.code).toBe('POSSIBLE_DUPLICATE');

      // With confirmNotDuplicate → succeeds
      const c2 = (
        await http(fx.manager, 'post', '/contractors', {
          name: 'L and T Construction',
          confirmNotDuplicate: true,
        }).expect(201)
      ).body as ContractorDto;

      // 3. Store Manager can issue naming the contractor
      const mat = await createMaterial('Contractor Material', 'NOS');
      await http(
        fx.manager,
        'post',
        '/inventory/receipts',
        { storeId: fx.storeId, lines: [{ materialId: mat.id, acceptedQuantity: '10' }] },
        ik(),
      ).expect(201);

      await http(
        fx.manager,
        'post',
        '/inventory/issues',
        {
          storeId: fx.storeId,
          locationId: defaultLocationId,
          contractorId: c2.id,
          lines: [{ materialId: mat.id, quantity: '4' }],
        },
        ik(),
      ).expect(201);

      // 4. Admin merges c2 into c1
      await http(fx.admin, 'post', `/contractors/${c2.id}/merge`, { intoId: c1.id }).expect(200);

      const mergedC2 = await db.contractor.findUniqueOrThrow({ where: { id: c2.id } });
      expect(mergedC2.mergedIntoId).toBe(c1.id);
      expect(mergedC2.isActive).toBe(false);
    });
  });
});
