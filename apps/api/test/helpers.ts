import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { type PrismaClient, addMember, createProject } from '@kavach/db';
import type { AuthResponse, RoleCode } from '@kavach/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/common/auth/password.service';
import { PrismaService } from '../src/common/prisma/prisma.service';

export const PASSWORD = 'Passw0rd!1';

let passwordHash: Promise<string> | undefined;
let counter = 0;

/** A short unique tag so every test file works on its own projects and users. */
export function uniqueTag(): string {
  counter += 1;
  return `${Date.now().toString(36)}${process.pid.toString(36)}${counter}`.toUpperCase();
}

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return app;
}

export function rawDb(app: INestApplication): PrismaClient {
  return app.get(PrismaService).unscoped;
}

export interface Actor {
  userId: string;
  email: string;
  token: string;
}

export interface Fixture {
  projectId: string;
  storeId: string;
  admin: Actor;
  manager: Actor;
}

export async function login(
  app: INestApplication,
  identifier: string,
  password = PASSWORD,
): Promise<AuthResponse> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ identifier, password, client: 'mobile' })
    .expect(200);
  return res.body as AuthResponse;
}

/** Creates a user directly in the database (as the operator CLI does) and logs them in. */
export async function createMember(
  app: INestApplication,
  projectId: string,
  roleCode: RoleCode,
  storeIds: string[] = [],
): Promise<Actor> {
  const db = rawDb(app);
  passwordHash ??= hashPassword(PASSWORD);
  const email = `${roleCode.toLowerCase()}.${uniqueTag().toLowerCase()}@test.local`;
  const user = await db.user.create({
    data: { name: `Test ${roleCode}`, email, passwordHash: await passwordHash },
  });
  await db.$transaction((tx) => addMember(tx, { projectId, userId: user.id, roleCode, storeIds }));
  const auth = await login(app, email);
  return { userId: user.id, email, token: auth.accessToken };
}

/** A project with its default store and categories, one Project Admin and one Store Manager. */
export async function createFixture(app: INestApplication): Promise<Fixture> {
  const db = rawDb(app);
  const tag = uniqueTag();
  const project = await db.$transaction((tx) =>
    createProject(tx, { code: `T${tag}`, name: `Test project ${tag}` }),
  );
  const store = await db.store.findFirstOrThrow({ where: { projectId: project.id } });
  const admin = await createMember(app, project.id, 'PROJECT_ADMIN');
  const manager = await createMember(app, project.id, 'STORE_MANAGER', [store.id]);
  return { projectId: project.id, storeId: store.id, admin, manager };
}

/** HTTP client acting as `actor` inside `projectId`. */
export function as(app: INestApplication, actor: Pick<Actor, 'token'>, projectId?: string) {
  const call = (
    method: 'get' | 'post' | 'patch',
    url: string,
    body?: object,
    headers?: Record<string, string>,
  ) => {
    const agent = request(app.getHttpServer());
    let req = agent[method](url).set('Authorization', `Bearer ${actor.token}`);
    if (projectId) req = req.set('X-Project-Id', projectId);
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        req = req.set(k, v);
      }
    }
    return body === undefined ? req : req.send(body);
  };
  return {
    get: (url: string, headers?: Record<string, string>) => call('get', url, undefined, headers),
    post: (url: string, body: object = {}, headers?: Record<string, string>) =>
      call('post', url, body, headers),
    patch: (url: string, body: object = {}, headers?: Record<string, string>) =>
      call('patch', url, body, headers),
  };
}

export interface Masters {
  categoryId: (name: string) => string;
  unitId: (code: string) => string;
}

/** Category and unit lookups for a project, by name and code. */
export async function loadMasters(
  app: INestApplication,
  actor: Actor,
  projectId: string,
): Promise<Masters> {
  const client = as(app, actor, projectId);
  const categories = (await client.get('/categories').expect(200)).body as {
    id: string;
    name: string;
  }[];
  const units = (await client.get('/units').expect(200)).body as { id: string; code: string }[];
  const find = <T extends { id: string }>(rows: T[], pred: (r: T) => boolean, what: string) => {
    const row = rows.find(pred);
    if (!row) throw new Error(`${what} not found`);
    return row.id;
  };
  return {
    categoryId: (name) => find(categories, (c) => c.name === name, `category ${name}`),
    unitId: (code) => find(units, (u) => u.code === code, `unit ${code}`),
  };
}
