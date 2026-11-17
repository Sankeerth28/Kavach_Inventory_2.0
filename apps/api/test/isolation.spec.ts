import type { INestApplication } from '@nestjs/common';
import { ProjectScopeError, addMember } from '@kavach/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import {
  type Fixture,
  type Masters,
  PASSWORD,
  as,
  createApp,
  createFixture,
  loadMasters,
  login,
  rawDb,
} from './helpers';

describe('project isolation (PRD §25.5, CLAUDE.md invariant 6)', () => {
  let app: INestApplication;
  let a: Fixture;
  let b: Fixture;
  let mb: Masters;
  /** Things that exist only in project B. */
  let bIds: {
    material: string;
    location: string;
    category: string;
    unit: string;
    conversion: string;
  };

  beforeAll(async () => {
    app = await createApp();
    a = await createFixture(app);
    b = await createFixture(app);
    mb = await loadMasters(app, b.admin, b.projectId);
    const adminB = as(app, b.admin, b.projectId);

    const material = await adminB
      .post('/materials', {
        name: 'Secret B Waterproofing Compound',
        categoryId: mb.categoryId('Paint and Finishing'),
        stockUnitId: mb.unitId('L'),
      })
      .expect(201);
    const location = await adminB
      .post('/locations', { name: 'B Tower', type: 'TOWER' })
      .expect(201);
    const category = await adminB.post('/categories', { name: 'B Only Category' }).expect(201);
    const unit = await adminB
      .post('/units', {
        code: 'BUNIT',
        name: 'B unit',
        symbol: 'bu',
        dimension: 'COUNT',
        decimalPlaces: 0,
      })
      .expect(201);
    const conversion = await adminB
      .post('/unit-conversions', {
        fromUnitId: unit.body.id,
        toUnitId: mb.unitId('KG'),
        factor: '7',
      })
      .expect(201);
    bIds = {
      material: material.body.id,
      location: location.body.id,
      category: category.body.id,
      unit: unit.body.id,
      conversion: conversion.body.id,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it("a user of project A is refused on every route when naming project B's id", async () => {
    for (const actor of [a.admin, a.manager]) {
      const intruder = as(app, actor, b.projectId);
      for (const url of [
        '/projects/current',
        '/dashboard',
        '/stores',
        '/locations',
        '/categories',
        '/units',
        '/unit-conversions',
        '/materials',
        `/materials/${bIds.material}`,
        '/users',
        '/audit-logs',
      ]) {
        const res = await intruder.get(url);
        expect(res.status, url).toBe(403);
        expect(JSON.stringify(res.body), url).not.toContain('Secret B');
      }
      await intruder.post('/materials', {}).expect(403);
      await intruder.patch(`/stores/${b.storeId}`, { name: 'x' }).expect(403);
    }
  });

  it("project B's rows never appear in project A's lists", async () => {
    const adminA = as(app, a.admin, a.projectId);
    const lists = await Promise.all(
      [
        '/stores',
        '/locations',
        '/categories',
        '/units',
        '/unit-conversions',
        '/materials?pageSize=100',
        '/users',
        '/audit-logs?pageSize=100',
      ].map((url) => adminA.get(url).expect(200)),
    );
    const text = JSON.stringify(lists.map((r) => r.body));
    for (const id of [...Object.values(bIds), b.storeId, b.admin.userId, b.manager.userId]) {
      expect(text).not.toContain(id);
    }
    expect(text).not.toContain('Secret B');
    expect(text).not.toContain('B Only Category');
  });

  it("project B's ids are 'not found' under project A's header, for reads and writes", async () => {
    const adminA = as(app, a.admin, a.projectId);
    await adminA.get(`/materials/${bIds.material}`).expect(404);
    await adminA.patch(`/materials/${bIds.material}`, { description: 'x', version: 0 }).expect(404);
    await adminA.post(`/materials/${bIds.material}/deactivate`).expect(404);
    await adminA.patch(`/stores/${b.storeId}`, { name: 'Taken over' }).expect(404);
    await adminA.patch(`/locations/${bIds.location}`, { name: 'Taken over' }).expect(404);
    await adminA.patch(`/categories/${bIds.category}`, { name: 'Taken over' }).expect(404);
    await adminA.patch(`/units/${bIds.unit}`, { name: 'Taken over' }).expect(404);
    await adminA.patch(`/unit-conversions/${bIds.conversion}`, { isActive: false }).expect(404);
    await adminA.patch(`/users/${b.manager.userId}`, { status: 'REMOVED' }).expect(404);
    await adminA
      .post(`/users/${b.manager.userId}/reset-password`, { password: PASSWORD })
      .expect(404);

    // Nothing changed in B.
    const adminB = as(app, b.admin, b.projectId);
    expect((await adminB.get(`/materials/${bIds.material}`).expect(200)).body.status).toBe(
      'ACTIVE',
    );
    const stores = (await adminB.get('/stores').expect(200)).body as { name: string }[];
    expect(stores.map((s) => s.name)).not.toContain('Taken over');
    await login(app, b.manager.email); // password untouched
  });

  it("a record in project A cannot reference project B's masters", async () => {
    const adminA = as(app, a.admin, a.projectId);
    const ma = await loadMasters(app, a.admin, a.projectId);
    const base = {
      name: 'Cross Project Thing',
      categoryId: ma.categoryId('Hardware'),
      stockUnitId: ma.unitId('NOS'),
    };

    await adminA.post('/materials', { ...base, categoryId: bIds.category }).expect(404);
    await adminA.post('/materials', { ...base, stockUnitId: bIds.unit }).expect(404);
    await adminA
      .post('/locations', { name: 'Floor 1', type: 'FLOOR', parentId: bIds.location })
      .expect(404);
    await adminA.post('/categories', { name: 'Sub', parentId: bIds.category }).expect(404);
    await adminA
      .post('/unit-conversions', { fromUnitId: bIds.unit, toUnitId: ma.unitId('KG'), factor: '2' })
      .expect(404);
    const res = await adminA
      .post('/users', {
        name: 'Cross store manager',
        email: `cross.${Date.now()}@test.local`,
        roleCode: 'STORE_MANAGER',
        storeIds: [b.storeId],
        password: PASSWORD,
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('the database itself refuses cross-project references (composite foreign keys)', async () => {
    const db = rawDb(app);
    const memberA = await db.projectMember.findFirstOrThrow({
      where: { projectId: a.projectId, userId: a.manager.userId },
    });
    await expect(
      db.projectMemberStore.create({
        data: { projectId: a.projectId, memberId: memberA.id, storeId: b.storeId },
      }),
    ).rejects.toThrow(/foreign key/i);

    const categoryB = await db.materialCategory.findFirstOrThrow({
      where: { projectId: b.projectId },
    });
    const materialA = await as(app, a.admin, a.projectId)
      .post('/materials', {
        name: 'FK Probe Nails',
        categoryId: (await loadMasters(app, a.admin, a.projectId)).categoryId('Hardware'),
        stockUnitId: mb.unitId('KG'),
      })
      .expect(201);
    await expect(
      db.material.update({ where: { id: materialA.body.id }, data: { categoryId: categoryB.id } }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('a user who belongs to both projects sees each one separately', async () => {
    await rawDb(app).$transaction((tx) =>
      addMember(tx, {
        projectId: b.projectId,
        userId: a.admin.userId,
        roleCode: 'STORE_MANAGER',
        storeIds: [b.storeId],
      }),
    );
    const auth = await login(app, a.admin.email);
    expect(auth.memberships.map((m) => m.projectId).sort()).toEqual(
      [a.projectId, b.projectId].sort(),
    );
    const both = { ...a.admin, token: auth.accessToken };

    // Admin in A, Store Manager in B: the role follows the project header.
    await as(app, both, a.projectId).get('/users').expect(200);
    await as(app, both, b.projectId).get('/users').expect(403);
    const inB = (await as(app, both, b.projectId).get('/materials').expect(200)).body;
    const inA = (await as(app, both, a.projectId).get('/materials').expect(200)).body;
    expect(JSON.stringify(inB)).toContain('Secret B');
    expect(JSON.stringify(inA)).not.toContain('Secret B');

    // B's admin cannot take over this shared account.
    const res = await as(app, b.admin, b.projectId)
      .post(`/users/${a.admin.userId}/reset-password`, { password: 'Hijack3d!1' })
      .expect(409);
    expect(res.body.error.code).toBe('MULTI_PROJECT_USER');
    await login(app, a.admin.email);
  });

  it('requests without a project header, or with a malformed one, are rejected', async () => {
    const res = await as(app, a.admin).get('/materials').expect(400);
    expect(res.body.error.code).toBe('PROJECT_REQUIRED');
    await as(app, a.admin, 'not-a-uuid').get('/materials').expect(400);
  });

  describe('repository layer: the scoped client refuses unscoped queries', () => {
    it('throws when a query on a project-scoped model does not name the project', async () => {
      const db = app.get(PrismaService).db;
      const refused = (query: PromiseLike<unknown>) =>
        expect(Promise.resolve(query)).rejects.toThrow(ProjectScopeError);
      await refused(db.material.findMany());
      await refused(db.material.findMany({ where: { name: 'x' } }));
      await refused(db.material.findUnique({ where: { id: bIds.material } }));
      await refused(db.store.updateMany({ where: {}, data: { name: 'x' } }));
      await refused(db.location.deleteMany());
      await refused(db.auditLog.findMany());
      await refused(db.unit.findMany());
      // `projectId: undefined` is the classic bug: Prisma would silently drop the filter.
      await refused(db.material.findMany({ where: { projectId: undefined as unknown as string } }));
      // An OR that leaves one branch open is not scoped.
      await refused(
        db.material.findMany({ where: { OR: [{ projectId: a.projectId }, { name: 'x' }] } }),
      );
      // Nothing was deleted or renamed by the refused writes.
      expect(await rawDb(app).location.count({ where: { id: bIds.location } })).toBe(1);
    });

    it('accepts scoped queries, inside transactions too', async () => {
      const db = app.get(PrismaService).db;
      await expect(
        db.material.findMany({ where: { projectId: a.projectId } }),
      ).resolves.toBeDefined();
      await expect(
        db.unit.findMany({ where: { OR: [{ projectId: null }, { projectId: a.projectId }] } }),
      ).resolves.not.toHaveLength(0);
      await expect(
        db.$transaction((tx) => tx.store.findMany({ where: { projectId: a.projectId } })),
      ).resolves.toHaveLength(1);
      await expect(db.$transaction(async (tx) => tx.store.findMany())).rejects.toThrow(
        ProjectScopeError,
      );
    });

    it('only authentication, user-account and seed code uses the unscoped client', async () => {
      const { readdirSync, readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const src = path.resolve(__dirname, '../src');
      const users: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else if (entry.name.endsWith('.ts') && /\.unscoped\b/.test(readFileSync(full, 'utf8'))) {
            users.push(path.relative(src, full).replaceAll('\\', '/'));
          }
        }
      };
      walk(src);
      expect(users.sort()).toEqual([
        'cli/seed.ts',
        'common/auth/access.guard.ts',
        'common/auth/token.service.ts',
        'common/prisma/prisma.service.ts',
        'modules/auth/auth.service.ts',
        'modules/users/users.ts',
      ]);
    });
  });
});
