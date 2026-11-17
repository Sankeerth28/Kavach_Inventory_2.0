import type { INestApplication } from '@nestjs/common';
import type { DuplicateCheckResult, MaterialDto } from '@kavach/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Fixture,
  type Masters,
  as,
  createApp,
  createFixture,
  loadMasters,
  rawDb,
} from './helpers';

describe('Material Master (PRD §6)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let m: Masters;
  const admin = () => as(app, fx.admin, fx.projectId);

  const tmt = (size: string, extra: object = {}) => ({
    name: `TMT Steel ${size}`,
    categoryId: m.categoryId('Steel'),
    grade: 'Fe 550D',
    stockUnitId: m.unitId('MT'),
    isVariableWeight: true,
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
    m = await loadMasters(app, fx.admin, fx.projectId);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('TMT 12 mm, 16 mm and 20 mm stay separate (PRD §6.5)', () => {
    const created: MaterialDto[] = [];

    it('creates all three without a duplicate block or a confirmation', async () => {
      for (const size of ['12mm', '16mm', '20mm']) {
        const res = await admin().post('/materials', tmt(size)).expect(201);
        created.push(res.body as MaterialDto);
      }
      expect(new Set(created.map((c) => c.id)).size).toBe(3);
      expect(created.map((c) => c.code)).toEqual(['MAT-000001', 'MAT-000002', 'MAT-000003']);
      expect(created.every((c) => c.status === 'ACTIVE' && c.creationSource === 'MANUAL')).toBe(
        true,
      );
    });

    it('stores a different structured size for each', async () => {
      const specs = await rawDb(app).materialSpecification.findMany({
        where: { materialId: { in: created.map((c) => c.id) }, key: 'SIZE' },
      });
      expect(specs.map((s) => s.normalizedValue).sort()).toEqual(['12MM', '16MM', '20MM']);
    });

    it('reports the other sizes as different materials, never as duplicates', async () => {
      const check = (await admin().post('/materials/check-duplicates', tmt('25mm')).expect(200))
        .body as DuplicateCheckResult;
      expect(check.exact).toBe(false);
      expect(check.needsConfirmation).toBe(false);
      expect(check.candidates).toHaveLength(3);
      for (const c of check.candidates) {
        expect(c.verdict).toBe('DIFFERENT_SPEC');
        expect(c.conflicts.map((x) => x.key)).toContain('SIZE');
      }
    });

    it('still finds each one separately in search', async () => {
      const all = (await admin().get('/materials?q=tmt steel').expect(200)).body;
      expect(all.total).toBe(3);
      const one = (await admin().get('/materials?q=TMT 16mm').expect(200)).body;
      expect(one.items.map((i: MaterialDto) => i.name)).toEqual(['TMT Steel 16mm']);
    });

    it('blocks the same size written differently as an exact duplicate', async () => {
      for (const body of [
        tmt('12 MM'),
        { ...tmt(''), name: 'tmt  steel', size: '12mm' },
        { ...tmt('12mm'), grade: 'FE-550 D' },
      ]) {
        const res = await admin()
          .post('/materials', { ...body, confirmNotDuplicate: true })
          .expect(409);
        expect(res.body.error.code).toBe('MATERIAL_ALREADY_EXISTS');
        expect(res.body.error.details.candidates[0].material.id).toBe(created[0]!.id);
      }
    });

    it('a different grade of the same size is a separate material too', async () => {
      const res = await admin()
        .post('/materials', tmt('12mm', { grade: 'Fe 500' }))
        .expect(201);
      expect(res.body.id).not.toBe(created[0]!.id);
    });

    it('editing one size into another existing size is blocked', async () => {
      const res = await admin()
        .patch(`/materials/${created[1]!.id}`, {
          name: 'TMT Steel 20mm',
          version: created[1]!.version,
        })
        .expect(409);
      expect(res.body.error.code).toBe('MATERIAL_ALREADY_EXISTS');
      const unchanged = (await admin().get(`/materials/${created[1]!.id}`).expect(200)).body;
      expect(unchanged.name).toBe('TMT Steel 16mm');
    });
  });

  describe('possible duplicates need a decision (PRD §6.5)', () => {
    const cement = (name: string, extra: object = {}) => ({
      name,
      categoryId: m.categoryId('Cement'),
      stockUnitId: m.unitId('BAG'),
      ...extra,
    });

    it('matches the PRD example and asks before creating', async () => {
      const existing = (
        await admin()
          .post(
            '/materials',
            cement('OPC Cement 53 Grade', { packSize: '50', packUnitId: m.unitId('KG') }),
          )
          .expect(201)
      ).body as MaterialDto;

      const proposal = cement('ULTRATECH OPC 53 50KG');
      const check = (await admin().post('/materials/check-duplicates', proposal).expect(200))
        .body as DuplicateCheckResult;
      expect(check.needsConfirmation).toBe(true);
      expect(check.candidates[0]).toMatchObject({
        verdict: 'POSSIBLE_DUPLICATE',
        material: { id: existing.id },
        conflicts: [],
      });

      const blocked = await admin().post('/materials', proposal).expect(409);
      expect(blocked.body.error.code).toBe('POSSIBLE_DUPLICATE');
      expect((await admin().get('/materials?q=ultratech').expect(200)).body.total).toBe(0);

      // The admin decides it really is a separate (branded) material.
      const made = await admin()
        .post('/materials', { ...proposal, brand: 'UltraTech', confirmNotDuplicate: true })
        .expect(201);
      const audit = await rawDb(app).auditLog.findFirstOrThrow({
        where: { entityId: made.body.id, action: 'material.create' },
      });
      expect(audit.metadata).toMatchObject({
        confirmedNotDuplicate: true,
        similarMaterialIds: [existing.id],
      });
    });

    it('a different pack size is a separate material (Q11)', async () => {
      const res = await admin()
        .post(
          '/materials',
          cement('OPC Cement 53 Grade', { packSize: '25', packUnitId: m.unitId('KG') }),
        )
        .expect(201);
      expect(res.body.packSize).toBe('25');
    });
  });

  describe('validation', () => {
    const base = () => ({
      name: 'Validation Probe',
      categoryId: m.categoryId('Hardware'),
      stockUnitId: m.unitId('NOS'),
    });

    it('requires name, category and unit (PRD §6.2)', async () => {
      const res = await admin().post('/materials', { name: ' ' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['name', 'categoryId', 'stockUnitId']));
    });

    it('needs pack size and pack unit together, and no pack on variable-weight materials (PRD §12.4)', async () => {
      await admin()
        .post('/materials', { ...base(), packSize: '50' })
        .expect(400);
      await admin()
        .post('/materials', { ...base(), packUnitId: m.unitId('KG') })
        .expect(400);
      await admin()
        .post('/materials', {
          ...base(),
          packSize: '50',
          packUnitId: m.unitId('KG'),
          isVariableWeight: true,
        })
        .expect(400);
      await admin()
        .post('/materials', { ...base(), packSize: '0', packUnitId: m.unitId('KG') })
        .expect(400);
    });

    it('keeps quantities as exact decimals and whole numbers for count units (Q12)', async () => {
      const bad = await admin()
        .post('/materials', { ...base(), minimumStock: '10.5' })
        .expect(400);
      expect(bad.body.error.code).toBe('UNIT_INCOMPATIBLE');
      await admin()
        .post('/materials', { ...base(), minimumStock: 12.5 })
        .expect(400); // not a string
      await admin()
        .post('/materials', { ...base(), minimumStock: '1.2345' })
        .expect(400);

      const ok = await admin()
        .post('/materials', {
          name: 'Binding Wire',
          categoryId: m.categoryId('Steel'),
          stockUnitId: m.unitId('KG'),
          minimumStock: '0.125',
        })
        .expect(201);
      expect(ok.body.minimumStock).toBe('0.125');
    });

    it('rejects a subcategory of another category and an inactive category', async () => {
      const sub = await admin()
        .post('/categories', { name: 'Wires', parentId: m.categoryId('Electrical') })
        .expect(201);
      await admin()
        .post('/materials', { ...base(), subcategoryId: sub.body.id })
        .expect(400);
      await admin()
        .post('/materials', { ...base(), categoryId: sub.body.id })
        .expect(400);

      await admin()
        .patch(`/categories/${m.categoryId('Tools and Equipment')}`, { isActive: false })
        .expect(200);
      await admin()
        .post('/materials', { ...base(), categoryId: m.categoryId('Tools and Equipment') })
        .expect(400);
    });
  });

  describe('editing and deactivating (PRD §3.3)', () => {
    let material: MaterialDto;

    beforeAll(async () => {
      material = (
        await admin()
          .post('/materials', {
            name: 'Safety Helmet Yellow',
            categoryId: m.categoryId('Safety Equipment'),
            stockUnitId: m.unitId('NOS'),
          })
          .expect(201)
      ).body;
    });

    it('audits an edit with the values before and after', async () => {
      const res = await admin()
        .patch(`/materials/${material.id}`, {
          minimumStock: '25',
          brand: 'Karam',
          version: material.version,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        minimumStock: '25',
        brand: 'Karam',
        version: material.version + 1,
      });
      const audit = await rawDb(app).auditLog.findFirstOrThrow({
        where: { entityId: material.id, action: 'material.update' },
      });
      expect(audit.actorUserId).toBe(fx.admin.userId);
      expect(audit.before).toMatchObject({ minimumStock: null, brand: null });
      expect(audit.after).toMatchObject({ minimumStock: '25', brand: 'Karam' });
      material = res.body;
    });

    it('rejects an edit made on a stale copy', async () => {
      const res = await admin()
        .patch(`/materials/${material.id}`, { description: 'late', version: material.version - 1 })
        .expect(409);
      expect(res.body.error.code).toBe('STALE_VERSION');
    });

    it('clears an optional field with null and leaves absent fields alone', async () => {
      const res = await admin()
        .patch(`/materials/${material.id}`, { brand: null, version: material.version })
        .expect(200);
      expect(res.body).toMatchObject({ brand: null, minimumStock: '25' });
      material = res.body;
    });

    it('deactivates and reactivates, with an audit row each time', async () => {
      const off = (await admin().post(`/materials/${material.id}/deactivate`).expect(200)).body;
      expect(off.status).toBe('INACTIVE');
      expect((await admin().get('/materials?status=ACTIVE&q=helmet').expect(200)).body.total).toBe(
        0,
      );
      expect(
        (await admin().get('/materials?status=INACTIVE&q=helmet').expect(200)).body.total,
      ).toBe(1);

      // An inactive material still blocks an identical new one.
      await admin()
        .post('/materials', {
          name: 'Safety Helmet Yellow',
          categoryId: m.categoryId('Safety Equipment'),
          stockUnitId: m.unitId('NOS'),
        })
        .expect(409);

      const on = (await admin().post(`/materials/${material.id}/activate`).expect(200)).body;
      expect(on.status).toBe('ACTIVE');
      const actions = (
        await rawDb(app).auditLog.findMany({
          where: { entityId: material.id },
          orderBy: { id: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual([
        'material.create',
        'material.update',
        'material.update',
        'material.deactivate',
        'material.activate',
      ]);
    });
  });

  it('gives every material a unique ID even when created at the same time (PRD §26 rule 1)', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        admin().post('/materials', {
          name: `Concurrent Anchor Bolt M${10 + i * 2} Zinc`,
          size: `${10 + i * 2}mm`,
          categoryId: m.categoryId('Hardware'),
          stockUnitId: m.unitId('NOS'),
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const codes = results.map((r) => r.body.code as string);
    expect(new Set(codes).size).toBe(8);
  });

  it('two simultaneous requests for the same new material create exactly one', async () => {
    const body = {
      name: 'Race Condition Sealant',
      categoryId: m.categoryId('Paint and Finishing'),
      stockUnitId: m.unitId('L'),
    };
    const results = await Promise.all([
      admin().post('/materials', body),
      admin().post('/materials', body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await admin().get('/materials?q=race condition').expect(200)).body.total).toBe(1);
  });
});
