# KAVACH v2.1 – Environment Setup

You fill in the real values yourself. Claude Code only edits `.env.example` and must never read your `.env`.

Variable names below are suggestions. In Prompt 1, Claude Code renames them to match your project's existing naming style and updates this file.

## 1. New variables

| Variable | Needed for | Required when | Example / how to get it |
|---|---|---|---|
| `APP_TIMEZONE` | Background jobs, Weekly Exception Report, "required by" checks | Always | `Asia/Kolkata` |
| `JOBS_ENABLED` | Hourly and daily jobs (expiry, overdue, escalation) | Always in production; `false` on extra app instances so jobs run once | `true` |
| `PWA_BASE_URL` | Links in notifications that open the Site Engineer app | `requisition_enabled` | `https://app.kavach.example.com/se` |
| `VAPID_PUBLIC_KEY` | Web push to the SE app | `requisition_enabled` | Generate once: `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Web push | `requisition_enabled` | From the same command. Secret. |
| `VAPID_SUBJECT` | Web push | `requisition_enabled` | `mailto:admin@yourcompany.com` |
| `WHATSAPP_API_BASE_URL` | WhatsApp alerts | `whatsapp_enabled` | Your WhatsApp Business API provider's URL |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp alerts | `whatsapp_enabled` | From provider. Secret. |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp alerts | `whatsapp_enabled` | From provider |
| `WHATSAPP_TEMPLATE_LANG` | WhatsApp template messages | `whatsapp_enabled` | `en` |
| `REPORT_EMAIL_FROM` | Weekly Exception Report email | `requisition_enabled` | `kavach-reports@yourcompany.com` |
| `UPLOAD_MAX_PHOTO_MB` | Acknowledgement and work-progress photos | `requisition_enabled` | `5` |

Probably existing already from v2.0 (check, don't duplicate): database URL, auth/JWT secret, SMTP settings, file storage (S3 or local) settings, OpenAI key.

## 2. Feature flags

Default values come from env; per-project overrides live in the `settings` table so a flag can be turned on for one pilot site.

| Variable | Default | Turn on when |
|---|---|---|
| `FEATURE_REQUISITION_ENABLED` | `false` | Phase 2A passes UAT |
| `FEATURE_MR_REQUIRED_FOR_ISSUE` | `false` | 2 weeks after the pilot goes live |
| `FEATURE_CONTROL_ENABLED` | `false` | Client norm data is loaded |
| `FEATURE_INDENTS_ENABLED` | `false` | Phase 4A UAT |
| `FEATURE_TOOL_CUSTODY_ENABLED` | `false` | Phase 4A UAT |
| `FEATURE_WHATSAPP_ENABLED` | `false` | WhatsApp Business API approved and templates approved |

## 3. Business settings (database, not env)

These go in the `settings` table, editable by Project Admin: `buffer_days` (7), `mr_expiry_days` (3), `ack_overdue_hours` (24), `emergency_regularise_hours` (24), `emergency_rate_threshold_pct` (10), `return_request_overdue_days` (3), `se_stock_visibility` (`status`).

Do not put these in env files. They are business rules the client will want to change without a deploy.

## 4. Checklist before running each phase

- [ ] `.env` is in `.gitignore` (check before your first commit on the branch).
- [ ] Separate `.env` for development, staging and production. Never reuse production secrets in development.
- [ ] VAPID keys generated once per environment and stored securely. Regenerating them breaks existing push subscriptions.
- [ ] WhatsApp: message templates submitted and approved by Meta before turning the flag on. Approval takes days.
- [ ] `JOBS_ENABLED=true` on exactly one instance in production.
- [ ] Start the app with a required variable missing and confirm it refuses to start with a clear error.
