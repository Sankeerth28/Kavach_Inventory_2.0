import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@kavach/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, rawDb } from './helpers';

/**
 * infra/db/roles.sql (ARCHITECTURE §3.4): the AI worker cannot touch stock, and the API cannot
 * rewrite history, as facts of the database. Runs the real script on the test database.
 */
describe('least-privilege database roles', () => {
  let app: INestApplication;
  let db: PrismaClient;

  const can = async (role: string, table: string, privilege: string): Promise<boolean> => {
    const rows = await db.$queryRawUnsafe<{ ok: boolean }[]>(
      'SELECT has_table_privilege($1, $2, $3) AS ok',
      role,
      `public.${table}`,
      privilege,
    );
    return rows[0]!.ok;
  };

  beforeAll(async () => {
    app = await createApp();
    db = rawDb(app);
    const sql = readFileSync(path.resolve(__dirname, '../../../infra/db/roles.sql'), 'utf8');
    await db.$executeRawUnsafe(sql);
    // Idempotent: a second run (after the next migration) must not fail.
    await db.$executeRawUnsafe(sql);
  });

  afterAll(async () => {
    await app.close();
  });

  it('the worker cannot write stock, the ledger, postings, counts, adjustments or mappings', async () => {
    for (const table of [
      'material_transactions',
      'postings',
      'stock_balances',
      'stock_adjustments',
      'stock_verifications',
      'supplier_material_mappings',
      'materials',
      'suppliers',
      'audit_logs',
      'users',
    ]) {
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE']) {
        expect(await can('kavach_worker', table, privilege), `${privilege} ${table}`).toBe(false);
      }
    }
    for (const table of ['material_transactions', 'postings', 'stock_balances', 'users']) {
      expect(await can('kavach_worker', table, 'SELECT'), `SELECT ${table}`).toBe(false);
    }
  });

  it('the worker can do its own job: read masters, write drafts, append to the AI log', async () => {
    expect(await can('kavach_worker', 'materials', 'SELECT')).toBe(true);
    expect(await can('kavach_worker', 'supplier_material_mappings', 'SELECT')).toBe(true);
    for (const table of ['invoices', 'invoice_pages', 'invoice_items']) {
      expect(await can('kavach_worker', table, 'UPDATE')).toBe(true);
    }
    expect(await can('kavach_worker', 'ai_processing_logs', 'INSERT')).toBe(true);
    expect(await can('kavach_worker', 'ai_processing_logs', 'UPDATE')).toBe(false);
  });

  it('the API can post but never rewrite the ledger, postings, audit or AI log', async () => {
    for (const table of ['material_transactions', 'postings', 'audit_logs', 'ai_processing_logs']) {
      expect(await can('kavach_api', table, 'INSERT'), table).toBe(true);
      expect(await can('kavach_api', table, 'UPDATE'), table).toBe(false);
      expect(await can('kavach_api', table, 'DELETE'), table).toBe(false);
    }
    expect(await can('kavach_api', 'stock_balances', 'UPDATE')).toBe(true);
    expect(await can('kavach_api', 'rate_limits', 'DELETE')).toBe(true);
    expect(await can('kavach_api', '_prisma_migrations', 'SELECT')).toBe(false);
  });

  /** Runs `sql` as `role` inside a transaction that is always rolled back. */
  const asRole = async (role: string, sql: string): Promise<string | null> => {
    try {
      await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$executeRawUnsafe(sql);
        throw new Error('ROLLBACK');
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return message.includes('ROLLBACK') ? null : message;
    }
    return null;
  };

  it('the database itself refuses the forbidden writes when acting as each role', async () => {
    expect(
      await asRole(
        'kavach_worker',
        `INSERT INTO stock_balances (project_id, store_id, material_id)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid())`,
      ),
    ).toMatch(/permission denied/);
    expect(await asRole('kavach_worker', 'DELETE FROM material_transactions')).toMatch(
      /permission denied/,
    );
    expect(await asRole('kavach_api', 'UPDATE audit_logs SET action = action')).toMatch(
      /permission denied/,
    );
    expect(await asRole('kavach_api', 'DELETE FROM postings')).toMatch(/permission denied/);
    // The worker's own claim query (apps/worker/src/pipeline/process-invoice.ts) is allowed.
    expect(
      await asRole(
        'kavach_worker',
        `UPDATE invoices SET status = 'PROCESSING' WHERE id IN (
           SELECT id FROM invoices WHERE status = 'QUEUED' FOR UPDATE SKIP LOCKED LIMIT 1)`,
      ),
    ).toBeNull();
    expect(
      await asRole(
        'kavach_worker',
        'SELECT i.id, p.settings FROM invoices i JOIN projects p ON p.id = i.project_id',
      ),
    ).toBeNull();
  });

  it('neither role can change the schema', async () => {
    for (const role of ['kavach_api', 'kavach_worker']) {
      const rows = await db.$queryRawUnsafe<{ ok: boolean }[]>(
        `SELECT has_schema_privilege($1, 'public', 'CREATE') AS ok`,
        role,
      );
      expect(rows[0]!.ok, role).toBe(false);
    }
  });
});
