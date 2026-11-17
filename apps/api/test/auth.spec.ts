import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Fixture, PASSWORD, as, createApp, createFixture, login, rawDb } from './helpers';

describe('authentication (PRD §25.2, ARCHITECTURE §8)', () => {
  let app: INestApplication;
  let fx: Fixture;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixture(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('stores passwords as argon2id hashes, never in clear text', async () => {
    const user = await rawDb(app).user.findUniqueOrThrow({ where: { id: fx.admin.userId } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('logs in with e-mail and returns the memberships with their permissions', async () => {
    const auth = await login(app, fx.admin.email.toUpperCase());
    expect(auth.accessToken).toBeTruthy();
    expect(auth.refreshToken).toBeTruthy();
    expect(auth.memberships).toHaveLength(1);
    expect(auth.memberships[0]).toMatchObject({
      projectId: fx.projectId,
      roleCode: 'PROJECT_ADMIN',
    });
    expect(auth.memberships[0]?.permissions).toContain('user:manage');
    expect(JSON.stringify(auth)).not.toContain('passwordHash');
  });

  it('logs in with a mobile number (Q36)', async () => {
    const phone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    await rawDb(app).user.update({ where: { id: fx.manager.userId }, data: { phone } });
    const auth = await login(app, `+91 ${phone}`);
    expect(auth.user.id).toBe(fx.manager.userId);
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    const wrong = await http()
      .post('/auth/login')
      .send({ identifier: fx.admin.email, password: 'wrong-password1' })
      .expect(401);
    const unknown = await http()
      .post('/auth/login')
      .send({ identifier: 'nobody@test.local', password: 'wrong-password1' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body).toEqual(wrong.body);
  });

  it('locks an identifier after repeated failures', async () => {
    const identifier = `lock.${Date.now()}@test.local`;
    for (let i = 0; i < 10; i++) {
      await http().post('/auth/login').send({ identifier, password: 'x' }).expect(401);
    }
    const res = await http().post('/auth/login').send({ identifier, password: 'x' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects requests without a token, with a bad token, and for a disabled user', async () => {
    await http().get('/auth/me').expect(401);
    await http().get('/auth/me').set('Authorization', 'Bearer not-a-jwt').expect(401);

    const temp = await createFixture(app);
    await as(app, temp.manager).get('/auth/me').expect(200);
    await rawDb(app).user.update({
      where: { id: temp.manager.userId },
      data: { status: 'DISABLED' },
    });
    await as(app, temp.manager).get('/auth/me').expect(401);
    const res = await http()
      .post('/auth/login')
      .send({ identifier: temp.manager.email, password: PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const first = await login(app, fx.admin.email);
    const second = await http()
      .post('/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    // The first token was already used: this is a replay.
    await http().post('/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    // ...and the family is gone, so the legitimate holder must sign in again too.
    await http().post('/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('keeps the refresh token in an httpOnly cookie for the web client', async () => {
    const res = await http()
      .post('/auth/login')
      .send({ identifier: fx.admin.email, password: PASSWORD, client: 'web' })
      .expect(200);
    expect(res.body.refreshToken).toBeUndefined();
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/^kavach_refresh=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    const pair = cookie.split(';')[0]!;
    await http()
      .post('/auth/refresh')
      .set('Cookie', pair)
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(403);
    const ok = await http()
      .post('/auth/refresh')
      .set('Cookie', pair)
      .set('Origin', 'http://localhost:3000')
      .send({})
      .expect(200);
    expect(ok.body.accessToken).toBeTruthy();
  });

  it('logout revokes the refresh token', async () => {
    const auth = await login(app, fx.admin.email);
    await http().post('/auth/logout').send({ refreshToken: auth.refreshToken }).expect(204);
    await http().post('/auth/refresh').send({ refreshToken: auth.refreshToken }).expect(401);
  });

  it('forces a password change before anything else (Q36)', async () => {
    const temp = await createFixture(app);
    await rawDb(app).user.update({
      where: { id: temp.manager.userId },
      data: { mustChangePassword: true },
    });
    const blocked = await as(app, temp.manager, temp.projectId).get('/materials').expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await as(app, temp.manager).get('/auth/me').expect(200);

    await as(app, temp.manager)
      .post('/auth/change-password', { currentPassword: 'wrong', newPassword: 'NewPassw0rd' })
      .expect(400);
    await as(app, temp.manager)
      .post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'weak' })
      .expect(400);
    const changed = await as(app, temp.manager)
      .post('/auth/change-password', { currentPassword: PASSWORD, newPassword: 'NewPassw0rd' })
      .expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    await as(app, temp.manager, temp.projectId).get('/materials').expect(200);
    await login(app, temp.manager.email, 'NewPassw0rd');
    await http()
      .post('/auth/login')
      .send({ identifier: temp.manager.email, password: PASSWORD })
      .expect(401);
  });

  it('audits logins and password changes without recording the password', async () => {
    const rows = await rawDb(app).auditLog.findMany({
      where: { actorUserId: fx.admin.userId, action: 'auth.login' },
    });
    expect(rows.length).toBeGreaterThan(0);
    const all = await rawDb(app).auditLog.findMany({ where: { action: { startsWith: 'auth.' } } });
    expect(JSON.stringify(all, (_, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(
      PASSWORD,
    );
  });
});
