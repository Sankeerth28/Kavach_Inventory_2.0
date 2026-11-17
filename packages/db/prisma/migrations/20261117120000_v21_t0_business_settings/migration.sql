-- PRD v2.1 / change spec §1.1 (T0): per-project business settings.
-- The spec's "settings table" is `projects.settings` (JSONB, one row per project) in this codebase.
-- Data-only and additive: adds each key with its default only where the project does not have it,
-- so existing values (and the v2.0 `confidence` key) are untouched. Per-project feature-flag
-- overrides live under `settings.features` and are NOT seeded: absent = use the FEATURE_* env default.
-- Rollback: down.sql in this folder (pnpm db:migrate:down 20261117120000_v21_t0_business_settings).

UPDATE "projects"
SET "settings" = jsonb_build_object(
      'buffer_days', 7,
      'mr_expiry_days', 3,
      'ack_overdue_hours', 24,
      'emergency_regularise_hours', 24,
      'emergency_rate_threshold_pct', 10,
      'return_request_overdue_days', 3,
      'se_stock_visibility', 'status'
    ) || "settings";
