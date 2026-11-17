import type { INestApplication } from '@nestjs/common';
import { type PrismaClient, createProject } from '@kavach/db';
import type { MeResponse } from '@kavach/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { addToProject, resetPassword } from '../src/cli/operator';
import {
  PASSWORD,
  type Fixture,
  createApp,
  createFixture,
  login,
  rawDb,
  uniqueTag,
} from './helpers';

/** Operator commands for multi-project accounts (PROGRESS "Must fix before production" item 3). */
describe('operator commands', () => {
  let app: INestApplication;
  let db: PrismaClient;
  let fx: Fixture;
  let other: { id: string; code: string };

  beforeAll(async () => {
    app = await createApp();
    db = rawDb(app);
    fx = await createFixture(app);
    const tag = uniqueTag();
    other = await db.$transaction((tx) =>
      createProject(tx, { code: `O${tag}`.slice(0, 20), name: `Other ${tag}` }),
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  it('adds an existing user to a second project as Store Manager of named stores', async () => {
    await expect(
      addToProject(db, fx.manager.email, other.code, 'STORE_MANAGER', []),
    ).rejects.toThrow(/at least one store/);
    await expect(
      addToProject(db, fx.manager.email, other.code, 'STORE_MANAGER', ['NOPE']),
    ).rejects.toThrow(/No such store/);

    await addToProject(db, fx.manager.email, other.code, 'STORE_MANAGER', ['main']);

    const me = (await login(app, fx.manager.email)) as MeResponse;
    const membership = me.memberships.find((m) => m.projectId === other.id);
    expect(membership?.roleCode).toBe('STORE_MANAGER');
    expect(membership?.storeIds).toHaveLength(1);
    await expect(
      addToProject(db, fx.manager.email, other.code, 'STORE_MANAGER', ['MAIN']),
    ).rejects.toThrow(/already a member/);

    const audit = await db.auditLog.findFirst({
      where: { projectId: other.id, action: 'user.create', entityId: fx.manager.userId },
    });
    expect(audit?.actorType).toBe('SYSTEM');
  });

  it('resets the password of a multi-project user, ends their sessions and audits it in each project', async () => {
    const before = await login(app, fx.manager.email);
    await resetPassword(db, fx.manager.email, 'Fresh#Passw0rd');

    // Every earlier session is ended: the refresh token from before is refused.
    expect(before.refreshToken).toBeTruthy();
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: before.refreshToken })
      .expect(401);

    // The old password no longer works; the new one does and must be changed.
    await expect(login(app, fx.manager.email, PASSWORD)).rejects.toThrow();
    const after = await login(app, fx.manager.email, 'Fresh#Passw0rd');
    expect(after.user.mustChangePassword).toBe(true);

    const rows = await db.auditLog.findMany({
      where: { action: 'user.password_reset', entityId: fx.manager.userId },
      select: { projectId: true, actorType: true },
    });
    expect(rows.map((r) => r.projectId).sort()).toEqual([fx.projectId, other.id].sort());
    expect(rows.every((r) => r.actorType === 'SYSTEM')).toBe(true);
  });

  it('refuses a weak password and an unknown login', async () => {
    await expect(resetPassword(db, fx.admin.email, 'short')).rejects.toThrow();
    await expect(resetPassword(db, 'nobody@test.local', 'Fresh#Passw0rd')).rejects.toThrow(
      /No user/,
    );
  });
});
