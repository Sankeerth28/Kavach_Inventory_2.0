import type { PrismaClient } from '@kavach/db';
import type { DocumentStorage } from '@kavach/storage';

/**
 * Document retention (PRD §25.3, DECISIONS Q25): documents of posted receipts are kept for the
 * life of the project. Files of uploads that were discarded, failed, never finished or were
 * sent back for a better photo are removed after `days` days. The database row stays, so the
 * AI log and the history still make sense; only the stored file goes.
 */
export async function purgeExpiredDocuments(
  db: PrismaClient,
  storage: DocumentStorage,
  days: number,
  limit = 200,
): Promise<number> {
  // A system job across projects, so it reads with SQL and writes one row at a time by id.
  const pages = await db.$queryRaw<{ id: string; storage_key: string }[]>`
    SELECT p.id, p.storage_key
    FROM invoice_pages p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE p.purged_at IS NULL
      AND i.status IN ('DISCARDED', 'FAILED', 'NEEDS_RECAPTURE', 'UPLOADING')
      AND i.updated_at < now() - make_interval(days => ${days}::int)
    ORDER BY i.updated_at
    LIMIT ${limit}`;
  let purged = 0;
  for (const page of pages) {
    await storage.delete(page.storage_key);
    await db.$executeRaw`UPDATE invoice_pages SET purged_at = now() WHERE id = ${page.id}::uuid AND purged_at IS NULL`;
    purged += 1;
  }
  return purged;
}
