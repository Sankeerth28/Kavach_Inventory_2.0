import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PrismaClient, syncSystemData } from '@kavach/db';

/**
 * The pipeline is tested against a real PostgreSQL, like the API (constraints, triggers and
 * `FOR UPDATE SKIP LOCKED` are part of what is tested). Each run creates a throwaway database on
 * the server named by TEST_DATABASE_URL (or DATABASE_URL), migrates it, and drops it afterwards.
 */
const root = path.resolve(__dirname, '../../..');

export default async function setup(): Promise<() => Promise<void>> {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch {
    // CI provides the environment.
  }
  const rawUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error('Pipeline tests need PostgreSQL. Set TEST_DATABASE_URL or DATABASE_URL.');
  }
  const adminUrl = new URL(rawUrl);
  const dbName = `kavach_worker_test_${Date.now()}_${process.pid}`;
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

  process.env.DATABASE_URL = testUrl.toString();

  return async () => {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$disconnect();
  };
}
