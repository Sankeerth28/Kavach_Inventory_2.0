-- KAVACH least-privilege database roles (ARCHITECTURE §3.4; PROGRESS "Must fix before production" item 1).
--
-- Run as the database owner (the role that runs `prisma migrate deploy`), in the KAVACH database:
--
--   psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/db/roles.sql
--
-- Then give the two roles a password and allow them to log in (once, outside version control):
--
--   ALTER ROLE kavach_api    LOGIN PASSWORD '…';
--   ALTER ROLE kavach_worker LOGIN PASSWORD '…';
--
-- and point the processes at them: the API's DATABASE_URL uses kavach_api, the worker's uses
-- kavach_worker, and only migrations use the owner. The script is idempotent: run it again after
-- every migration so new tables get their grants. It is one statement, so any client can run it.
--
-- What it enforces, in the database rather than in code:
-- - kavach_api can never UPDATE or DELETE the ledger, the postings, the audit log or the AI log
--   (CLAUDE.md invariants 1 and 10). The append-only triggers stay as a second wall.
-- - kavach_worker (the AI side) can write only the document draft tables and the AI log, and can
--   never touch stock, the ledger, postings, adjustments, counts or supplier mappings
--   (PRD §22.4, §24.1; CLAUDE.md "AI code must never … call inventory-posting services").
--   It may READ supplier mappings, because matching step 1 looks them up (PRD §22.3); it cannot
--   create or change one. This is the one difference from ARCHITECTURE §3.4, which said "no grant".
-- - Neither role can change the schema, and neither owns anything.

DO $roles$
DECLARE
  t text;
  -- Append-only: insert and read, never change.
  append_only text[] := ARRAY['material_transactions', 'postings', 'audit_logs', 'ai_processing_logs'];
  -- What the worker may write.
  worker_write text[] := ARRAY['invoices', 'invoice_pages', 'invoice_items'];
  worker_insert_only text[] := ARRAY['ai_processing_logs'];
  -- What the worker may read: masters and the documents it processes.
  worker_read text[] := ARRAY[
    'projects', 'stores', 'materials', 'material_categories', 'material_specifications',
    'units', 'unit_conversions', 'suppliers', 'supplier_aliases', 'supplier_material_mappings',
    'invoices', 'invoice_pages', 'invoice_items', 'ai_processing_logs'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kavach_api') THEN
    CREATE ROLE kavach_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kavach_worker') THEN
    CREATE ROLE kavach_worker NOLOGIN;
  END IF;

  EXECUTE format('GRANT CONNECT ON DATABASE %I TO kavach_api, kavach_worker', current_database());
  GRANT USAGE ON SCHEMA public TO kavach_api, kavach_worker;
  -- Start from nothing on every run, so a grant removed from this file is removed from the database.
  REVOKE ALL ON ALL TABLES IN SCHEMA public FROM kavach_api, kavach_worker;
  REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM kavach_api, kavach_worker;
  REVOKE CREATE ON SCHEMA public FROM kavach_api, kavach_worker;

  -- API: ordinary read and write on every table except Prisma's migration history ...
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO kavach_api', t);
  END LOOP;
  -- ... but the append-only tables are insert and read only.
  FOREACH t IN ARRAY append_only LOOP
    EXECUTE format('REVOKE UPDATE, DELETE ON TABLE public.%I FROM kavach_api', t);
  END LOOP;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kavach_api;

  -- Worker.
  FOREACH t IN ARRAY worker_read LOOP
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO kavach_worker', t);
  END LOOP;
  FOREACH t IN ARRAY worker_write LOOP
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO kavach_worker', t);
  END LOOP;
  FOREACH t IN ARRAY worker_insert_only LOOP
    EXECUTE format('GRANT INSERT ON TABLE public.%I TO kavach_worker', t);
  END LOOP;
END
$roles$;
