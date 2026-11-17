import type { INestApplication } from '@nestjs/common';
import type { MemberDto } from '@kavach/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixture, PASSWORD, as, createApp, createFixture, login, rawDb } from './helpers';

describe('user management (PRD §3.1, DECISIONS Q2, Q36)', () => {
  let app: INestApplication;
  let fx: Fixture;
  const admin = () => as(app, fx.admin, fx.projectId);
  const unique = (prefix: string) =>
    `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@test.local`;

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('creates a Store Manager who must change the initial password at first login', async () => {
    const email = unique('ravi');
    const created = (
      await admin()
        .post('/users', {
          name: 'Ravi Kumar',
          email: email.toUpperCase(),
          roleCode: 'STORE_MANAGER',
          storeIds: [fx.storeId],
          password: 'Initial#123',
        })
        .expect(201)
    ).body as MemberDto;
    expect(created).toMatchObject({
      email,
      roleCode: 'STORE_MANAGER',
      status: 'ACTIVE',
      storeIds: [fx.storeId],
      mustChangePassword: true,
    });
    expect(JSON.stringify(created)).not.toMatch(/password(?!")|argon/i);

    const auth = await login(app, email, 'Initial#123');
    expect(auth.user.mustChangePassword).toBe(true);
    const ravi = { token: auth.accessToken };
    await as(app, ravi, fx.projectId).get('/materials').expect(403);
    const changed = await as(app, ravi)
      .post('/auth/change-password', { currentPassword: 'Initial#123', newPassword: 'MyOwn#4567' })
      .expect(200);
    await as(app, { token: changed.body.accessToken }, fx.projectId).get('/materials').expect(200);
  });

  it('creates a phone-only user (site staff without e-mail)', async () => {
    const phone = `8${Math.floor(100000000 + Math.random() * 899999999)}`;
    const created = (
      await admin()
        .post('/users', {
          name: 'Suresh',
          phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
          roleCode: 'STORE_MANAGER',
          storeIds: [fx.storeId],
          password: 'Initial#123',
        })
        .expect(201)
    ).body as MemberDto;
    expect(created).toMatchObject({ email: null, phone });
    await login(app, phone, 'Initial#123');
  });

  it('validates the input', async () => {
    const base = {
      name: 'X',
      roleCode: 'STORE_MANAGER',
      storeIds: [fx.storeId],
      password: 'Initial#123',
    };
    await admin().post('/users', base).expect(400); // no e-mail or phone
    await admin()
      .post('/users', { ...base, email: unique('a'), storeIds: [] })
      .expect(400);
    await admin()
      .post('/users', { ...base, email: unique('a'), password: 'weak' })
      .expect(400);
    await admin()
      .post('/users', { ...base, email: 'not-an-email' })
      .expect(400);
    await admin()
      .post('/users', { ...base, email: unique('a'), roleCode: 'SUPER_ADMIN' })
      .expect(400);
  });

  it('refuses an e-mail or phone that is already in use, without adding a membership', async () => {
    const other = await createFixture(app);
    const res = await admin()
      .post('/users', {
        name: 'Borrowed',
        email: other.admin.email,
        roleCode: 'PROJECT_ADMIN',
        password: 'Initial#123',
      })
      .expect(409);
    expect(res.body.error.code).toBe('IDENTIFIER_TAKEN');
    expect(await rawDb(app).projectMember.count({ where: { userId: other.admin.userId } })).toBe(1);
  });

  it('changes role and stores, and audits it without secrets', async () => {
    const temp = await createFixture(app);
    const a = as(app, temp.admin, temp.projectId);
    const second = (await a.post('/stores', { code: 'S2', name: 'Second' }).expect(201)).body;

    const moved = (
      await a
        .patch(`/users/${temp.manager.userId}`, { storeIds: [second.id], name: 'Renamed Manager' })
        .expect(200)
    ).body as MemberDto;
    expect(moved).toMatchObject({ storeIds: [second.id], name: 'Renamed Manager' });
    await a.patch(`/users/${temp.manager.userId}`, { storeIds: [] }).expect(400);

    const promoted = (
      await a.patch(`/users/${temp.manager.userId}`, { roleCode: 'PROJECT_ADMIN' }).expect(200)
    ).body as MemberDto;
    expect(promoted).toMatchObject({ roleCode: 'PROJECT_ADMIN', storeIds: [] });
    // The existing token now carries admin rights: roles are read per request.
    await as(app, temp.manager, temp.projectId).get('/users').expect(200);

    const logs = await rawDb(app).auditLog.findMany({
      where: { projectId: temp.projectId, entityId: temp.manager.userId, action: 'user.update' },
      orderBy: { id: 'asc' },
    });
    expect(logs).toHaveLength(2);
    expect(logs[1]?.before).toMatchObject({ roleCode: 'STORE_MANAGER' });
    expect(logs[1]?.after).toMatchObject({ roleCode: 'PROJECT_ADMIN' });
    expect(JSON.stringify(logs.map((l) => [l.before, l.after, l.metadata]))).not.toMatch(
      /argon|passwordHash/i,
    );
  });

  it('an admin cannot remove or demote themselves', async () => {
    for (const body of [
      { status: 'REMOVED' },
      { roleCode: 'STORE_MANAGER', storeIds: [fx.storeId] },
    ]) {
      const res = await admin().patch(`/users/${fx.admin.userId}`, body).expect(403);
      expect(res.body.error.message).toMatch(/your own/);
    }
    await admin().get('/users').expect(200);
  });

  it('removes and restores a member', async () => {
    const temp = await createFixture(app);
    const a = as(app, temp.admin, temp.projectId);
    await a.patch(`/users/${temp.manager.userId}`, { status: 'REMOVED' }).expect(200);
    await as(app, temp.manager, temp.projectId).get('/stores').expect(403);
    expect((await login(app, temp.manager.email)).memberships).toEqual([]);
    await a.patch(`/users/${temp.manager.userId}`, { status: 'ACTIVE' }).expect(200);
    await as(app, temp.manager, temp.projectId).get('/stores').expect(200);
  });

  it('resets a password: old sessions end and the user must choose a new one', async () => {
    const temp = await createFixture(app);
    const session = await login(app, temp.manager.email);
    await as(app, temp.admin, temp.projectId)
      .post(`/users/${temp.manager.userId}/reset-password`, { password: 'Temp#12345' })
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ identifier: temp.manager.email, password: PASSWORD })
      .expect(401);
    const fresh = await login(app, temp.manager.email, 'Temp#12345');
    expect(fresh.user.mustChangePassword).toBe(true);

    const log = await rawDb(app).auditLog.findFirstOrThrow({
      where: { projectId: temp.projectId, action: 'user.password_reset' },
    });
    expect(log).toMatchObject({ actorUserId: temp.admin.userId, entityId: temp.manager.userId });
    expect(JSON.stringify(log, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      'Temp#12345',
    );

    // Your own password goes through "change password", which asks for the current one.
    await as(app, temp.admin, temp.projectId)
      .post(`/users/${temp.admin.userId}/reset-password`, { password: 'Temp#12345' })
      .expect(403);
  });

  it('lists members with role, stores and status', async () => {
    const list = (await admin().get('/users').expect(200)).body as MemberDto[];
    const adminRow = list.find((u) => u.userId === fx.admin.userId);
    const managerRow = list.find((u) => u.userId === fx.manager.userId);
    expect(adminRow).toMatchObject({ roleCode: 'PROJECT_ADMIN', storeIds: [] });
    expect(managerRow).toMatchObject({ roleCode: 'STORE_MANAGER', storeIds: [fx.storeId] });
    expect(JSON.stringify(list)).not.toMatch(/argon|passwordHash/i);
  });
});
