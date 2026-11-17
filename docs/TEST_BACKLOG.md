# KAVACH v2.1 – Test Backlog

Tests to write in the Testing stage (Prompts 10–11). Each task's "Done when" line plus edge cases noticed during Development. v2.0 tests broken by an intended v2.1 change are also logged here.

## T0 – Config and feature flags

- With every `FEATURE_*` unset, api and worker start with no new variables set (v2.0 behaviour).
- `FEATURE_REQUISITION_ENABLED=true` with `SE_PWA_URL` missing → startup fails, message names `SE_PWA_URL` and `requisition_enabled`.
- `FEATURE_WHATSAPP_ENABLED=true` while requisition is off → no WhatsApp variables required; `isFeatureEnabled(p, 'whatsapp_enabled')` is false.
- Malformed values fail even when the flag is off: `FEATURE_X=yes`, `JOBS_TIMEZONE=India`, `SE_PWA_URL=http://…` in production, `SMTP_USER` without `SMTP_PASSWORD`, `PHOTO_MAX_MB=0`.
- Project override `features.requisition_enabled=true` with env missing → API `onApplicationBootstrap` and worker startup refuse to start, naming the project code.
- `isFeatureEnabled`: override true beats env false; override false beats env true; missing key → env default; unknown project → env default.
- Cache: second call within 30 s does not query; after `invalidate(projectId)` the new override is visible; after TTL it re-reads.
- Migration `20261117120000_v21_t0_business_settings`: existing projects get all 7 keys; a pre-existing key (and `confidence`) is not overwritten; `down.sql` removes exactly the 7 keys + `features` and keeps `confidence`; up → down → up is clean.
- `createProject` writes the default business settings.
- `parseBusinessSettings`: out-of-range / non-integer / wrong-type values fall back per key; `se_stock_visibility` accepts only `status` | `quantity`.
- v2.0 `GET/PATCH /settings/confidence` still works and PATCH keeps the v2.1 keys.

## T1 – Site Engineer role

## T2 – Location hierarchy and SE assignment

## T3 – Contractor Master

## T4 – Material Master fields

## T5 – Approver permission

## T6 – Material Request: create, copy, cancel

## T7 – Approval routing (Phase 2A rules)

## T8 – Store Request Queue and issue against MR

## T9 – Approvals inbox

## T10 – Emergency issue and Retrospective MR

## T11 – Issue acknowledgement

## T12 – Disputes and Site Loss

## T13 – Return Requests

## T14 – Notifications

## T15 – Weekly Exception Report

## T16 – Site Engineer PWA

## T17 – Dashboards, navigation, Material Out changes

## T18 – Activity Types, Activities, Norms

## T19 – Work progress

## T20 – Consumption reconciliation

## T21 – Budget-based MR routing

## T22 – Tool custody

## T23 – Indents

## T24 – System-suggested indents
