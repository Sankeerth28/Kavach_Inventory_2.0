# KAVACH v2.1 – Decisions

Assumptions, deviations and spec-to-codebase name mappings, with reasons. One heading per task.

## T0 – Config and feature flags

**D0.1 Spec "settings table" = `projects.settings` (JSONB).** v2.0 has no key/value `settings` table; per-project settings already live in `projects.settings` (read via `parseProjectSettings`, holds `confidence`). The v2.1 business settings and flag overrides are added there instead of a new table (CLAUDE.md: use the existing structure).

**D0.2 Key names are the spec's, verbatim (snake_case).** `buffer_days`, `mr_expiry_days`, `ack_overdue_hours`, `emergency_regularise_hours`, `emergency_rate_threshold_pct`, `return_request_overdue_days`, `se_stock_visibility`; flag overrides under `features.<flag>` with the spec flag names (`requisition_enabled`, …). No mapping layer to maintain. The v2.0 `confidence` key is untouched.

**D0.3 Business settings are parsed key by key** (`parseBusinessSettings`, `packages/shared/src/feature-flags.ts`): an invalid or missing key falls back to its own default and never affects the others or the v2.0 `confidence` parse. Bounds are in `BUSINESS_SETTING_LIMITS` (e.g. `mr_expiry_days` 1–30); adjust there if the client needs more.

**D0.4 Down migrations.** Prisma has no `down`. Each v2.1 migration folder carries a `down.sql` next to `migration.sql` (Prisma ignores extra files). `pnpm db:migrate:down <folder>` runs it and marks the migration rolled back (`packages/db/scripts/migrate-down.mjs`). Roll back newest first. The T0 down also removes any `features` overrides and values edited after the migration.

**D0.5 Seeding.** The migration adds defaults to existing projects without overwriting existing keys (`defaults || settings`). `createProject` (used by `pnpm db:seed` and `pnpm project:create`) writes the defaults for new projects. Code also falls back to defaults, so a project without the keys behaves the same.

**D0.6 Env variable renames** (docs/ENV_SETUP.md suggestion → used). Existing style: SCREAMING_SNAKE_CASE grouped by service prefix (`S3_*`, `OPENAI_*`, `DOCUMENT_*`), booleans `true`/`false` without `_ENABLED` except where already suggested.

| Suggested | Used | Why |
|---|---|---|
| `APP_TIMEZONE` | `JOBS_TIMEZONE` | No `APP_` prefix in the codebase; it only drives job schedules. Business dates use the existing per-project `projects.timezone`. |
| `JOBS_ENABLED` | `JOBS_ENABLED` | Already fits. |
| `PWA_BASE_URL` | `SE_PWA_URL` | Names which app; matches `WEB_ORIGIN` / `*_URL` style. |
| `VAPID_PUBLIC_KEY` / `_PRIVATE_KEY` / `_SUBJECT` | unchanged | Standard web-push names, already service-prefixed. |
| `WHATSAPP_API_BASE_URL` | `WHATSAPP_BASE_URL` | Matches `OPENAI_BASE_URL`. |
| `WHATSAPP_ACCESS_TOKEN`, `_PHONE_NUMBER_ID`, `_TEMPLATE_LANG` | unchanged | Already fit. |
| `REPORT_EMAIL_FROM` | `SMTP_FROM` | v2.0 has no mail settings at all, so a new `SMTP_*` group was needed (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`). |
| `UPLOAD_MAX_PHOTO_MB` | `PHOTO_MAX_MB` | Prefix by subject like `DOCUMENT_*`; capped at 15 to stay under the v2.0 15 MB upload limit. |
| `FEATURE_*` | unchanged | `FEATURE_` + upper-cased spec flag name: derivable, no mapping. |

**D0.7 What is required when.** With every flag off nothing new is required, so a v2.0 deployment starts unchanged. `requisition_enabled` requires `JOBS_ENABLED` (explicit), `SE_PWA_URL`, `VAPID_*`, `SMTP_HOST`, `SMTP_FROM`. `whatsapp_enabled` requires `WHATSAPP_BASE_URL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`. `JOBS_TIMEZONE` (Asia/Kolkata), `PHOTO_MAX_MB` (5), `SMTP_PORT` (587), `WHATSAPP_TEMPLATE_LANG` (en) have defaults. ENV_SETUP said `JOBS_TIMEZONE`/`JOBS_ENABLED` are "always" required; making them hard-required would break v2.0 startup, which the backward-compatibility rule forbids. Any variable that is set is validated (URL, time zone, port, boolean, mailto) whatever the flags.

**D0.8 Flag dependencies.** `mr_required_for_issue` and `whatsapp_enabled` are forced off while `requisition_enabled` is off (`FEATURE_PARENT`). Blocking issues without MRs before MRs exist would stop all Material Out.

**D0.9 Fail fast covers project overrides.** Env defaults are checked in `loadConfig` / `loadWorkerConfig`. Overrides are checked against the DB at startup (`FeatureFlagsService.onApplicationBootstrap` in the API, `assertProjectOverridesConfigured` in the worker), so turning a flag on for one pilot project without its env also stops startup with a message naming the variable, the flag and the project. `assertCanEnable(flag)` is provided for the future override-editing endpoint.

**D0.10 One helper.** `FeatureFlags` (`packages/db/src/feature-flags.ts`) is used by both api (`FeatureFlagsService`, global) and worker. Cache: in-process, 30 s per project, `invalidate(projectId)` after a write. With multiple API instances another instance sees a change within 30 s.

**D0.11 Repo hygiene.** This copy had no `.gitignore`, no `.env.example` (README tells users to copy it) and no Prettier config (236 files failed `format:check`). Added `.gitignore` (ignores `.env*` except `.env.example`), a full `.env.example` covering v2.0 and v2.1 variables, `.prettierrc.json` with the options the existing code is formatted with (single quotes, width 100, trailing commas: 0 code files changed by it) and `.prettierignore` (excludes `docs/` and `test-docs/` so the hand-written specs and fixtures are not rewritten).

**D0.12 Git.** The folder was not a git repository. `main` = the v2.0 code as received; T0 is committed on `release/2.1` (spec §0.2). Remote: the GitHub repo given by the product owner.
