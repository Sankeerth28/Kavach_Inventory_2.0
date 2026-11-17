# KAVACH v2.1 – Environment Setup

You fill in the real values yourself. Claude Code only edits `.env.example` and must never read your `.env`.

Names follow the existing v2.0 style (SCREAMING_SNAKE_CASE, grouped by a service prefix such as `S3_`, `OPENAI_`, `DOCUMENT_`). Renamed in Prompt 1 (T0); the mapping from the original suggestions is in `docs/DECISIONS.md` (T0). All variables are in `.env.example`.

Validation lives in `packages/shared/src/feature-flags.ts` (`loadFeatureEnv`) and runs at API and worker startup. A variable marked "required when X" is required only while flag X is on, either by its `FEATURE_*` env default or by a per-project override; if it is missing, the process refuses to start and names the variable and the flag.

## 1. New variables

| Variable | Needed for | Required when | Example / how to get it |
|---|---|---|---|
| `JOBS_ENABLED` | Hourly and daily jobs (expiry, overdue, escalation) | `requisition_enabled` (must be set explicitly). `true` on exactly one instance, `false` on the others | `true` |
| `JOBS_TIMEZONE` | Job schedules, Weekly Exception Report | Optional, default `Asia/Kolkata` (validated as an IANA zone). "Required by" checks use each project's own `projects.timezone` | `Asia/Kolkata` |
| `SE_PWA_URL` | Links in notifications that open the Site Engineer app | `requisition_enabled` | `https://app.kavach.example.com/se` (https:// in production) |
| `PHOTO_MAX_MB` | Acknowledgement and work-progress photos | Optional, default `5`, range 1–15 (the v2.0 upload cap is 15 MB) | `5` |
| `VAPID_PUBLIC_KEY` | Web push to the SE app | `requisition_enabled` | Generate once: `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Web push | `requisition_enabled` | From the same command. **Secret.** |
| `VAPID_SUBJECT` | Web push | `requisition_enabled` | `mailto:admin@yourcompany.com` (or an https:// URL) |
| `SMTP_HOST` | Weekly Exception Report email | `requisition_enabled` | Your mail relay, e.g. `smtp.sendgrid.net` |
| `SMTP_PORT` | Email | Optional, default `587` | `587` (STARTTLS) or `465` (TLS) |
| `SMTP_USER` | Email | Optional; set together with `SMTP_PASSWORD` | `apikey` |
| `SMTP_PASSWORD` | Email | Optional; set together with `SMTP_USER` | From the mail provider. **Secret.** |
| `SMTP_FROM` | Sender of the Weekly Exception Report | `requisition_enabled` | `kavach-reports@yourcompany.com` |
| `WHATSAPP_BASE_URL` | WhatsApp alerts | `whatsapp_enabled` | Your WhatsApp Business API provider's URL (https://) |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp alerts | `whatsapp_enabled` | From provider. **Secret.** |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp alerts | `whatsapp_enabled` | From provider |
| `WHATSAPP_TEMPLATE_LANG` | WhatsApp template messages | Optional, default `en` | `en` |

Already in v2.0 (not duplicated): `DATABASE_URL`, `JWT_SECRET`, `S3_*` / `STORAGE_*` file storage, `OPENAI_*` / `AI_PROVIDER`. v2.0 had **no** SMTP settings, so the `SMTP_*` group above is new.

## 2. Feature flags

Default values come from env; per-project overrides live in `projects.settings.features` (the spec's "settings table", see DECISIONS T0), e.g. `{"features": {"requisition_enabled": true}}`, so a flag can be turned on for one pilot site. Code asks one helper, `isFeatureEnabled(projectId, flag)` (`FeatureFlags` in `packages/db`, `FeatureFlagsService` in the API), cached 30 s per project. `mr_required_for_issue` and `whatsapp_enabled` only take effect while `requisition_enabled` is on.

| Variable | Default | Turn on when |
|---|---|---|
| `FEATURE_REQUISITION_ENABLED` | `false` | Phase 2A passes UAT |
| `FEATURE_MR_REQUIRED_FOR_ISSUE` | `false` | 2 weeks after the pilot goes live |
| `FEATURE_CONTROL_ENABLED` | `false` | Client norm data is loaded |
| `FEATURE_INDENTS_ENABLED` | `false` | Phase 4A UAT |
| `FEATURE_TOOL_CUSTODY_ENABLED` | `false` | Phase 4A UAT |
| `FEATURE_WHATSAPP_ENABLED` | `false` | WhatsApp Business API approved and templates approved |

## 3. Business settings (database, not env)

These go in `projects.settings` (JSONB, one per project; seeded by migration `20261117120000_v21_t0_business_settings` and for every new project), editable by Project Admin: `buffer_days` (7), `mr_expiry_days` (3), `ack_overdue_hours` (24), `emergency_regularise_hours` (24), `emergency_rate_threshold_pct` (10), `return_request_overdue_days` (3), `se_stock_visibility` (`status`).

Do not put these in env files. They are business rules the client will want to change without a deploy.

## 4. Checklist before running each phase

- [ ] `.env` is in `.gitignore` (check before your first commit on the branch).
- [ ] Separate `.env` for development, staging and production. Never reuse production secrets in development.
- [ ] VAPID keys generated once per environment and stored securely. Regenerating them breaks existing push subscriptions.
- [ ] WhatsApp: message templates submitted and approved by Meta before turning the flag on. Approval takes days.
- [ ] `JOBS_ENABLED=true` on exactly one instance in production.
- [ ] Start the app with a required variable missing and confirm it refuses to start with a clear error.
