import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { PrismaClient, syncSystemData } from '@kavach/db';

/**
 * Integration tests run against a real PostgreSQL (CLAUDE.md: constraints, triggers and locks are
 * part of what is tested). Each run creates a throwaway database on the server named by
 * TEST_DATABASE_URL (or DATABASE_URL), migrates it, and drops it afterwards.
 */
const root = path.resolve(__dirname, '../../..');

function baseUrl(): URL {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    // CI provides the environment.
  }
  const raw = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!raw) {
    throw new Error(
      'Integration tests need PostgreSQL. Set TEST_DATABASE_URL or DATABASE_URL (see .env.example).',
    );
  }
  return new URL(raw);
}

export default async function setup(): Promise<() => Promise<void>> {
  const adminUrl = baseUrl();
  const dbName = `kavach_test_${Date.now()}_${process.pid}`;
  const testUrl = new URL(adminUrl);
  testUrl.pathname = `/${dbName}`;

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

  const dbPackage = path.join(root, 'packages/db');
  const prismaCli = createRequire(path.join(dbPackage, 'package.json')).resolve(
    'prisma/build/index.js',
  );
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: dbPackage,
    env: { ...process.env, DATABASE_URL: testUrl.toString() },
    stdio: 'pipe',
  });

  const client = new PrismaClient({ datasourceUrl: testUrl.toString() });
  await syncSystemData(client);
  await client.$disconnect();

  // Test workers are started after this function returns and inherit the environment.
  process.env.DATABASE_URL = testUrl.toString();
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
  process.env.WEB_ORIGIN = 'http://localhost:3000';
  // Uploaded documents go to a throwaway directory, and no Redis is needed.
  process.env.STORAGE_DRIVER = 'local';
  process.env.STORAGE_LOCAL_DIR = path.join(os.tmpdir(), `kavach-api-test-${process.pid}`);
  process.env.DOCUMENT_QUEUE = 'db';
  // Tests send X-Forwarded-For to act from different addresses (rate limits are per address).
  process.env.TRUST_PROXY = '1';
  process.env.REQUEST_LOG = 'off';

  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}
