import type { INestApplication } from '@nestjs/common';
import { DEFAULT_CATEGORIES, SYSTEM_UNITS } from '@kavach/db';
import type { CategoryDto, ConversionDto, LocationDto, UnitDto } from '@kavach/shared';
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

describe('project structure and masters (PRD §6.3, §12.2, §14.3, §28 Phase 1)', () => {
  let app: INestApplication;
  let fx: Fixture;
  let m: Masters;
  const admin = () => as(app, fx.admin, fx.projectId);
  const auditActions = async (entityId: string) =>
    (await rawDb(app).auditLog.findMany({ where: { entityId }, orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
    m = await loadMasters(app, fx.admin, fx.projectId);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('project and stores', () => {
    it('a new project starts with a Main Store and the default categories', async () => {
      const stores = (await admin().get('/stores').expect(200)).body;
      expect(stores).toMatchObject([{ code: 'MAIN', name: 'Main Store', isActive: true }]);
      const categories = (await admin().get('/categories').expect(200)).body as CategoryDto[];
      expect(categories.map((c) => c.name)).toEqual([...DEFAULT_CATEGORIES]);
    });

    it('updates project details and rejects an unknown time zone', async () => {
      const res = await admin()
        .patch('/projects/current', {
          name: 'Skyline Phase 2',
          address: 'Plot 12',
          timezone: 'Asia/Kolkata',
        })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Skyline Phase 2', address: 'Plot 12' });
      await admin().patch('/projects/current', { timezone: 'Mars/Olympus' }).expect(400);
      expect(await auditActions(fx.projectId)).toEqual(['project.create', 'project.update']);
    });

    it('creates stores with unique codes and keeps at least one active', async () => {
      const store = (
        await admin().post('/stores', { code: 'twr-b', name: 'Tower B Store' }).expect(201)
      ).body;
      expect(store.code).toBe('TWR-B');
      await admin().post('/stores', { code: 'TWR-B', name: 'Again' }).expect(409);
      await admin().post('/stores', { code: 'bad code!', name: 'x' }).expect(400);

      await admin().patch(`/stores/${store.id}`, { isActive: false }).expect(200);
      const res = await admin().patch(`/stores/${fx.storeId}`, { isActive: false }).expect(409);
      expect(res.body.error.message).toMatch(/at least one active store/);
      expect(await auditActions(store.id)).toEqual(['store.create', 'store.update']);
    });
  });

  describe('locations: Tower → Floor → Work area (PRD §14.3)', () => {
    let tower: LocationDto;
    let floor: LocationDto;
    let flat: LocationDto;

    it('builds the tree with a readable path', async () => {
      tower = (await admin().post('/locations', { name: 'Tower A', type: 'TOWER' }).expect(201))
        .body;
      floor = (
        await admin()
          .post('/locations', { name: 'Floor 3', type: 'FLOOR', parentId: tower.id })
          .expect(201)
      ).body;
      flat = (
        await admin()
          .post('/locations', { name: 'Flat 302', type: 'WORK_AREA', parentId: floor.id })
          .expect(201)
      ).body;
      expect(flat.path).toBe('Tower A / Floor 3 / Flat 302');
    });

    it('rejects the same name twice under one parent, but allows it under another', async () => {
      await admin().post('/locations', { name: 'tower  a', type: 'TOWER' }).expect(409);
      await admin()
        .post('/locations', { name: 'floor 3', type: 'FLOOR', parentId: tower.id })
        .expect(409);
      const towerB = (
        await admin().post('/locations', { name: 'Tower B', type: 'TOWER' }).expect(201)
      ).body;
      await admin()
        .post('/locations', { name: 'Floor 3', type: 'FLOOR', parentId: towerB.id })
        .expect(201);
    });

    it('a rename updates the paths below', async () => {
      await admin().patch(`/locations/${tower.id}`, { name: 'Tower Alpha' }).expect(200);
      const all = (await admin().get('/locations').expect(200)).body as LocationDto[];
      expect(all.find((l) => l.id === flat.id)?.path).toBe('Tower Alpha / Floor 3 / Flat 302');
    });

    it('deactivating closes everything below; a child cannot reopen under a closed parent', async () => {
      await admin().patch(`/locations/${floor.id}`, { isActive: false }).expect(200);
      const all = (await admin().get('/locations').expect(200)).body as LocationDto[];
      expect(all.find((l) => l.id === flat.id)?.isActive).toBe(false);
      expect(all.find((l) => l.id === tower.id)?.isActive).toBe(true);
      await admin().patch(`/locations/${flat.id}`, { isActive: true }).expect(400);
      await admin()
        .post('/locations', { name: 'Flat 303', type: 'WORK_AREA', parentId: floor.id })
        .expect(400);
      expect(await auditActions(floor.id)).toEqual(['location.create', 'location.update']);
    });
  });

  describe('categories (PRD §6.3)', () => {
    it('adds categories and subcategories, two levels only', async () => {
      const sub = (
        await admin()
          .post('/categories', { name: 'TMT Bars', parentId: m.categoryId('Steel') })
          .expect(201)
      ).body as CategoryDto;
      expect(sub.parentId).toBe(m.categoryId('Steel'));
      await admin().post('/categories', { name: 'Deeper', parentId: sub.id }).expect(400);
      expect(await auditActions(sub.id)).toEqual(['category.create']);
    });

    it('rejects duplicate names at the same level, ignoring case and spacing', async () => {
      await admin().post('/categories', { name: ' cement ' }).expect(409);
      await admin()
        .post('/categories', { name: 'tmt bars', parentId: m.categoryId('Steel') })
        .expect(409);
      // The same name under a different parent is a different subcategory.
      await admin()
        .post('/categories', { name: 'TMT Bars', parentId: m.categoryId('Hardware') })
        .expect(201);
      await admin()
        .patch(`/categories/${m.categoryId('Hardware')}`, { name: 'Steel' })
        .expect(409);
    });
  });

  describe('unit master and approved conversions (PRD §12.2, §12.4)', () => {
    it('lists the fifteen system units of PRD §12.2 as read-only', async () => {
      const units = (await admin().get('/units').expect(200)).body as UnitDto[];
      const system = units.filter((u) => u.isSystem);
      expect(system.map((u) => u.code).sort()).toEqual(SYSTEM_UNITS.map((u) => u.code).sort());
      expect(system).toHaveLength(15);
      // Count units take whole numbers only (Q12).
      for (const code of ['BAG', 'NOS', 'PCS', 'ROLL', 'BOX', 'BUNDLE']) {
        expect(system.find((u) => u.code === code)?.decimalPlaces, code).toBe(0);
      }
      const res = await admin()
        .patch(`/units/${m.unitId('KG')}`, { name: 'Kilos' })
        .expect(403);
      expect(res.body.error.message).toMatch(/System units/);
    });

    it('lets the admin add a project unit, but not reuse a system code', async () => {
      const unit = (
        await admin()
          .post('/units', {
            code: 'sqft',
            name: 'Square Feet',
            symbol: 'sq ft',
            dimension: 'AREA',
            decimalPlaces: 2,
          })
          .expect(201)
      ).body as UnitDto;
      expect(unit).toMatchObject({ code: 'SQFT', isSystem: false });
      await admin()
        .post('/units', {
          code: 'SQFT',
          name: 'Again',
          symbol: 'x',
          dimension: 'AREA',
          decimalPlaces: 2,
        })
        .expect(409);
      await admin()
        .post('/units', {
          code: 'KG',
          name: 'My kg',
          symbol: 'kg',
          dimension: 'MASS',
          decimalPlaces: 3,
        })
        .expect(409);
      expect(await auditActions(unit.id)).toEqual(['unit.create']);
    });

    it('seeds only the standard conversions and protects them', async () => {
      const conversions = (await admin().get('/unit-conversions').expect(200))
        .body as ConversionDto[];
      const mtKg = conversions.find(
        (c) => c.fromUnitId === m.unitId('MT') && c.toUnitId === m.unitId('KG'),
      );
      expect(mtKg).toMatchObject({ factor: '1000', isSystem: true, materialId: null });
      // Nothing converts bags to kilograms unless a material's pack size says so.
      expect(
        conversions.some((c) => c.fromUnitId === m.unitId('BAG') || c.toUnitId === m.unitId('BAG')),
      ).toBe(false);
      await admin().patch(`/unit-conversions/${mtKg!.id}`, { isActive: false }).expect(403);
    });

    it('approves a conversion once per pair, in either direction', async () => {
      const body = { fromUnitId: m.unitId('BUNDLE'), toUnitId: m.unitId('NOS'), factor: '10' };
      const created = (await admin().post('/unit-conversions', body).expect(201))
        .body as ConversionDto;
      expect(created).toMatchObject({ factor: '10', isSystem: false, isActive: true });
      await admin().post('/unit-conversions', body).expect(409);
      await admin()
        .post('/unit-conversions', {
          fromUnitId: body.toUnitId,
          toUnitId: body.fromUnitId,
          factor: '0.1',
        })
        .expect(409);
      // A system pair cannot be redefined at project level either.
      await admin()
        .post('/unit-conversions', {
          fromUnitId: m.unitId('KG'),
          toUnitId: m.unitId('MT'),
          factor: '0.5',
        })
        .expect(409);

      await admin().patch(`/unit-conversions/${created.id}`, { isActive: false }).expect(200);
      expect(await auditActions(created.id)).toEqual([
        'unit_conversion.create',
        'unit_conversion.update',
      ]);
    });

    it('rejects a zero, negative or same-unit conversion', async () => {
      const pair = { fromUnitId: m.unitId('ROLL'), toUnitId: m.unitId('M') };
      await admin()
        .post('/unit-conversions', { ...pair, factor: '0' })
        .expect(400);
      await admin()
        .post('/unit-conversions', { ...pair, factor: '-5' })
        .expect(400);
      await admin()
        .post('/unit-conversions', { ...pair, factor: 90 })
        .expect(400);
      await admin()
        .post('/unit-conversions', {
          fromUnitId: pair.fromUnitId,
          toUnitId: pair.fromUnitId,
          factor: '1',
        })
        .expect(400);
    });

    it('allows a conversion for one material only (variable-weight steel, Q12)', async () => {
      const bars = (
        await admin()
          .post('/materials', {
            name: 'TMT Bar 12mm 12m length',
            categoryId: m.categoryId('Steel'),
            stockUnitId: m.unitId('NOS'),
            isVariableWeight: true,
          })
          .expect(201)
      ).body;
      const res = await admin()
        .post('/unit-conversions', {
          fromUnitId: m.unitId('NOS'),
          toUnitId: m.unitId('KG'),
          factor: '10.656',
          materialId: bars.id,
        })
        .expect(201);
      expect(res.body).toMatchObject({ materialId: bars.id, factor: '10.656' });
    });

    it('will not deactivate a unit that active materials use', async () => {
      const unit = (
        await admin()
          .post('/units', {
            code: 'PAIR',
            name: 'Pairs',
            symbol: 'pr',
            dimension: 'COUNT',
            decimalPlaces: 0,
          })
          .expect(201)
      ).body;
      await admin()
        .post('/materials', {
          name: 'Safety Gloves',
          categoryId: m.categoryId('Safety Equipment'),
          stockUnitId: unit.id,
        })
        .expect(201);
      await admin().patch(`/units/${unit.id}`, { isActive: false }).expect(409);
    });
  });

  describe('audit trail (CLAUDE.md invariant 10, PRD §26 rule 16)', () => {
    it('records who did what and when, visible to the admin', async () => {
      const page = (await admin().get('/audit-logs?entityType=store&pageSize=50').expect(200)).body;
      expect(page.total).toBe(2); // store.create + store.update of TWR-B
      for (const row of page.items) {
        expect(row.actorUserId).toBe(fx.admin.userId);
        expect(row.actorName).toBeTruthy();
        expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false);
      }
    });

    it('is append-only at the database level', async () => {
      const db = rawDb(app);
      const row = await db.auditLog.findFirstOrThrow({ where: { projectId: fx.projectId } });
      await expect(
        db.auditLog.update({ where: { id: row.id }, data: { action: 'tampered' } }),
      ).rejects.toThrow(/append-only/);
      await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
      await expect(db.$executeRawUnsafe('TRUNCATE audit_logs')).rejects.toThrow(/append-only/);
      const same = await db.auditLog.findUniqueOrThrow({ where: { id: row.id } });
      expect(same.action).toBe(row.action);
    });

    it('a failed action leaves no audit row and no partial change', async () => {
      const before = await rawDb(app).auditLog.count({ where: { projectId: fx.projectId } });
      await admin().post('/stores', { code: 'MAIN', name: 'Duplicate' }).expect(409);
      await admin().post('/categories', { name: 'Cement' }).expect(409);
      expect(await rawDb(app).auditLog.count({ where: { projectId: fx.projectId } })).toBe(before);
    });
  });
});
