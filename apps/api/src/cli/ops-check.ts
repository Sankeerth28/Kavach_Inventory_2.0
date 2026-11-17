import { createPrismaClient } from '@kavach/db';

/**
 * Monitoring check for a scheduler (cron, a systemd timer, a container job):
 *
 *   pnpm ops:check            prints one JSON line and exits 0 (healthy) or 1 (act on it)
 *
 * It looks at the things that must never be wrong or stuck:
 * - every stock balance equals the sum of its ledger rows, in every project;
 * - no document has been waiting to be read, or "being read", for too long;
 * - how many documents failed in the last 24 hours (reported; alarming only above a threshold).
 *
 * Thresholds: OPS_MAX_QUEUE_MINUTES (default 30), OPS_MAX_FAILED_24H (default 20).
 */
async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const maxQueueMinutes = Number(process.env.OPS_MAX_QUEUE_MINUTES ?? 30);
  const maxFailed = Number(process.env.OPS_MAX_FAILED_24H ?? 20);
  try {
    const mismatches = await prisma.$queryRaw<
      { project_id: string; store_id: string; material_id: string; bucket: string }[]
    >`
      WITH ledger AS (
        SELECT project_id, store_id, material_id, bucket, SUM(quantity) AS qty
        FROM material_transactions GROUP BY 1, 2, 3, 4
      ), held AS (
        SELECT project_id, store_id, material_id, 'AVAILABLE' AS bucket, available_qty AS qty FROM stock_balances
        UNION ALL
        SELECT project_id, store_id, material_id, 'DAMAGED', damaged_qty FROM stock_balances
        UNION ALL
        SELECT project_id, store_id, material_id, 'SCRAP', scrap_qty FROM stock_balances
      )
      SELECT COALESCE(h.project_id, l.project_id) AS project_id,
             COALESCE(h.store_id, l.store_id) AS store_id,
             COALESCE(h.material_id, l.material_id) AS material_id,
             COALESCE(h.bucket, l.bucket::text) AS bucket
      FROM held h
      FULL JOIN ledger l
        ON l.store_id = h.store_id AND l.material_id = h.material_id AND l.bucket::text = h.bucket
      WHERE COALESCE(h.qty, 0) <> COALESCE(l.qty, 0)
      LIMIT 50`;

    const [stuck] = await prisma.$queryRaw<{ n: bigint; oldest_minutes: number | null }[]>`
      SELECT COUNT(*) AS n,
             MAX(EXTRACT(EPOCH FROM (now() - COALESCE(processing_started_at, updated_at))) / 60)::float8 AS oldest_minutes
      FROM invoices
      WHERE status IN ('QUEUED', 'PROCESSING')
        AND COALESCE(next_attempt_at, updated_at) < now() - make_interval(mins => ${maxQueueMinutes}::int)`;

    const [failed] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM invoices
      WHERE status = 'FAILED' AND updated_at > now() - interval '24 hours'`;

    const stuckDocuments = Number(stuck?.n ?? 0);
    const failedDocuments24h = Number(failed?.n ?? 0);
    const problems = [
      ...(mismatches.length > 0 ? ['LEDGER_MISMATCH'] : []),
      ...(stuckDocuments > 0 ? ['DOCUMENTS_STUCK'] : []),
      ...(failedDocuments24h > maxFailed ? ['MANY_FAILED_DOCUMENTS'] : []),
    ];
    console.log(
      JSON.stringify({
        level: problems.length > 0 ? 'error' : 'info',
        time: new Date().toISOString(),
        msg: 'ops-check',
        healthy: problems.length === 0,
        problems,
        ledgerMismatches: mismatches,
        stuckDocuments,
        oldestStuckMinutes: stuck?.oldest_minutes ? Math.round(stuck.oldest_minutes) : null,
        failedDocuments24h,
      }),
    );
    process.exitCode = problems.length > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e: unknown) => {
  console.log(
    JSON.stringify({
      level: 'error',
      time: new Date().toISOString(),
      msg: 'ops-check',
      healthy: false,
      problems: ['CHECK_FAILED'],
      error: e instanceof Error ? e.message : String(e),
    }),
  );
  process.exit(2);
});
