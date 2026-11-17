# KAVACH v2.1 – Progress

## Stack

- **Monorepo:** pnpm 12 workspaces + Turborepo, Node 22.12–22.x, TypeScript 6. `apps/{api,web,mobile,worker}`, `packages/{db,shared,storage,matching,api-client,config}`.
- **Backend:** NestJS 12 (`apps/api`, Express). Zod validation. Shared isomorphic domain code in `packages/shared` (no I/O).
- **ORM / migrations:** Prisma 6 (`packages/db/prisma/schema.prisma`), SQL migrations in `packages/db/prisma/migrations`. Prisma has no down migrations: v2.1 migrations carry a `down.sql`, run with `pnpm db:migrate:down <name>` (DECISIONS T0).
- **Database:** PostgreSQL 16 (Supabase in production). Least-privilege roles `kavach_api` / `kavach_worker` in `infra/db/roles.sql`. Project isolation guard `withProjectScope` in `packages/db/src/scope.ts`.
- **Web:** Next.js 16 (`apps/web`, React Query, Tailwind), proxies the API under `/kapi`. Deployed on Vercel.
- **Mobile:** Expo 58 / React Native (`apps/mobile`), separate app. The v2.1 SE app is a PWA (R8), not this app.
- **Auth:** own JWT (`jose`) access token 15 min + refresh cookie 30 days, argon2 passwords, `AccessGuard` + `@RequirePermission`, permissions map in `packages/shared/src/permissions.ts`. `X-Project-Id` header selects the project.
- **Background jobs:** `apps/worker` — invoice AI pipeline, polls PostgreSQL (`DOCUMENT_QUEUE=db`) or BullMQ/Redis. No scheduled (cron) jobs in v2.0. On Render the worker runs in the same service as the API.
- **Config / env:** repo-root `.env` loaded with `process.loadEnvFile` (api/worker `main.ts`) or `node --env-file-if-exists` (CLIs); validated in `apps/api/src/common/config.ts`, `apps/worker/src/config.ts`, and (v2.1) `packages/shared/src/feature-flags.ts`.
- **Run:** `pnpm infra:up` (Docker Postgres) → `pnpm db:deploy` → `pnpm db:seed` → `pnpm dev`. Build `pnpm build`, lint `pnpm lint`, types `pnpm typecheck`, boundaries `pnpm depcruise`, format `pnpm format:check`.
- **Tests:** `pnpm test` (turbo). Vitest in api/worker/web/packages, Jest in mobile. api + worker suites are integration tests that need PostgreSQL (`TEST_DATABASE_URL` or `DATABASE_URL`, user with CREATEDB).

## Baseline (v2.0, before any change) — 2026-11-17

| Check | Result |
|---|---|
| build + lint + typecheck (26 turbo tasks) | 26/26 pass |
| Unit tests: shared 41, matching 18, api-client 9, storage 5, web 13, mobile 13 | **99 passed, 0 failed** |
| Integration tests: `apps/api` (12 spec files), `apps/worker` (1 spec file), ~180 cases | **Not run**: no PostgreSQL on this machine (Docker daemon not running, no local server, no `.env`). Global setup stops with "Integration tests need PostgreSQL". |
| `pnpm format:check` | Failed on 236 files: the repo had no Prettier config. Fixed in T0 (see DECISIONS). |

## Tasks

| Task | Status | Commit | Notes |
|---|---|---|---|
| T0 | Done | see `git log --grep "feat(T0)"` | Config & flags: v2.1 env vars + validation, `FeatureFlags.isFeatureEnabled`, business settings migration with `down.sql`. Integration suite not run (no PostgreSQL). |
| T1 | Not started | | Site Engineer role |
| T2 | Not started | | Location hierarchy and SE assignment |
| T3 | Not started | | Contractor Master |
| T4 | Not started | | Material Master fields |
| T5 | Not started | | Approver permission |
| T6 | Not started | | MR: create, copy, cancel |
| T7 | Not started | | Approval routing (Phase 2A) |
| T8 | Not started | | Store Request Queue and issue against MR |
| T9 | Not started | | Approvals inbox |
| T10 | Not started | | Emergency issue and Retrospective MR |
| T11 | Not started | | Issue acknowledgement |
| T12 | Not started | | Disputes and Site Loss |
| T13 | Not started | | Return Requests |
| T14 | Not started | | Notifications |
| T15 | Not started | | Weekly Exception Report |
| T16 | Not started | | Site Engineer PWA |
| T17 | Not started | | Dashboards, navigation, Material Out changes |
| T18 | Not started | | Activity Types, Activities, Norms |
| T19 | Not started | | Work progress |
| T20 | Not started | | Consumption reconciliation |
| T21 | Not started | | Budget-based MR routing |
| T22 | Not started | | Tool custody |
| T23 | Not started | | Indents |
| T24 | Not started | | System-suggested indents |
