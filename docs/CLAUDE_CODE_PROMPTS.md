# KAVACH v2.1 – Claude Code Prompts (run in order)

Flow: **Setup → Prompt 1 (env) → you fill `.env` → Development (Prompts 2–9) → Testing (Prompts 10–11) → Release (Prompt 12).**
No planning phase. Each prompt builds straight from the PRD and change spec.

## Setup (once)

1. In your existing KAVACH repo, create the branch: `git checkout -b release/2.1`
   (Branch, don't copy the project into a new folder. Two copies drift and every v2.0 fix gets done twice.)
2. Copy these into the repo root:
   - `CLAUDE.md` (Claude Code reads it automatically every session)
   - `docs/specs/KAVACH_PRD_v2.1.md`
   - `docs/specs/KAVACH_v2.1_Dev_Change_Spec.md`
   - `docs/ENV_SETUP.md`
3. Make sure `.env` is in `.gitignore`, then commit: `git add CLAUDE.md docs && git commit -m "docs: v2.1 specs and Claude Code rules"`
4. Open Claude Code in the repo root.

## How to run

- Paste ONE prompt per session. Run `/clear` before the next prompt. The files (`docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/TEST_BACKLOG.md`) carry the memory, not the chat.
- After each prompt: read the summary, skim `git diff`, open the app, then paste the next prompt.
- If Claude Code stops with a question, answer it and say "continue".

---

# STAGE 1 – DEVELOPMENT

## Prompt 1 – Stack check, config, env and feature flags

```
Read CLAUDE.md, docs/ENV_SETUP.md and docs/specs/KAVACH_v2.1_Dev_Change_Spec.md sections 0 and 1.

Start building now. No plan document.

1. Look at the repo just enough to know: backend framework, ORM/migration tool, database, frontend, mobile app (if separate), auth, how background jobs run (if at all), how config/env is loaded, the commands to run the app, build, lint and the existing tests. Write these as a short "Stack" section at the top of docs/PROGRESS.md (10–15 lines).
2. Run the existing test suite once and record the baseline pass/fail counts in docs/PROGRESS.md.
3. Create docs/PROGRESS.md table: Task | Status | Commit | Notes, rows T0 and T1–T24. Create docs/DECISIONS.md and docs/TEST_BACKLOG.md (empty templates with T-number headings).
4. Rename the variables in docs/ENV_SETUP.md to match this project's existing env naming style. Then add every new variable to .env.example with placeholder values and a one-line comment each. Never open, read or print .env or any real secrets file.
5. Add the variables to the config loader with validation: a variable is required only when its feature flag is on; if missing, the app refuses to start with a clear message naming the variable.
6. Implement feature flags: env default + per-project override in the settings table, one helper (e.g. isFeatureEnabled(projectId, flag)) used everywhere, short cache.
7. Add the business settings keys from docs/ENV_SETUP.md §3 to the settings table with defaults (migration with down + seed).
8. Build, lint, run the existing suite, update PROGRESS (T0 = config & flags), commit.

STOP. Give me:
- the stack summary,
- the exact list of variables I must fill in my .env before Prompt 2, which ones are secrets, and how to generate the VAPID keys,
- any existing v2.0 env variable that looks missing or misnamed.
```

### ➜ You now configure your `.env` files

Fill `.env` (and staging/production equivalents) using the list Claude Code gave you and `docs/ENV_SETUP.md`. Generate VAPID keys once per environment. Leave WhatsApp blank until the API is approved (its flag stays off). Start the app once to confirm it boots. Then continue.

## Prompt 2 – Phase 1 (T1–T5)

```
Read CLAUDE.md, spec §1 (Phase 1 tables and altered tables), §2 and §3, and PRD §3.

Build T1 → T5 in order, one task at a time, following "Working style" in CLAUDE.md:
- T1 Site Engineer role, SE navigation, 403 on SM/Admin endpoints.
- T2 Location hierarchy Tower → Floor → Work Area (migrate existing flat locations to tower level), SE location assignment, and one helper user_can_access_location used everywhere.
- T3 Contractor Master with Store Manager quick-add as Pending. Keep the old free-text "issued to" column read-only. Do NOT auto-create contractors from old free text; list the distinct old values in docs/DECISIONS.md for me to review.
- T4 Material Master: lead time, returnable (R5 rule: must be answered for Tools and Equipment / Safety Equipment), supplier mapping lead-time override.
- T5 can_approve permission and a reusable "cannot approve own record" guard.

Every migration has a working down. With all flags off, v2.0 behaviour must not change. Log every task's "Done when" line in docs/TEST_BACKLOG.md.

STOP after T5 with the summary.
```

## Prompt 3 – Phase 2A part 1: requests and store queue (T6–T9)

```
Read CLAUDE.md, spec §1 (Phase 2A tables, enums), §2, §4 T6–T9, §6.1 and §6.3, and PRD §16.5–16.6.

Build in order:
- T6 Material Request: create, copy, cancel, drafts, Idempotency-Key, line-level status with derived header status.
- T7 Approval routing with the R1 daily cumulative per-material limit; urgent skips approval.
- T8 Store Request Queue, issue against MR, partial issue, reject with reasons.
- T9 Approvals inbox (MR lines and pending contractors tabs now; other tabs as empty placeholders).

Ledger rules (non-negotiable):
- Issue against MR goes through the SAME stock-posting service the v2.0 Material Out uses. Extend it; never write a second posting path.
- Row lock + balance check + idempotency key in one DB transaction.
- MR line and header statuses change in the same transaction as the stock posting.

Everything behind requisition_enabled. Log test cases (including "two simultaneous issues exceeding stock → exactly one succeeds") in docs/TEST_BACKLOG.md.

STOP after T9.
```

## Prompt 4 – Phase 2A part 2: emergency, acknowledgement, disputes (T10–T12)

```
Read CLAUDE.md, spec §4 T10–T12, §6.1, §6.2, and PRD §16.6–16.7.

Build:
- T10 Emergency issue (reason, activity, contractor mandatory), Retrospective MR that links to the existing transaction with NO second stock movement, hourly escalation job, weekly emergency-rate calculation.
- T11 Acknowledgement (full, or short/wrong/damaged → dispute) and the overdue job. Never auto-acknowledge.
- T12 Dispute resolution with exactly the four exits in the spec table. Add the site_loss transaction type. Site Loss and dispute resolution never change store stock, except the posting_error_reversed exit. Enforce R4 for wrong_material.

Jobs must be idempotent and respect the jobs-enabled env variable.

Log every ledger case in docs/TEST_BACKLOG.md with the expected stock before and after.

STOP after T12.
```

## Prompt 5 – Phase 2A part 3: returns, notifications, exception report, screens (T13–T15, T17)

```
Read CLAUDE.md, spec §4 T13, T14, T15, T17, and PRD §16.8 and §16.12.

Build:
- T13 Return Requests (SE raises; SM confirms through the existing v2.0 return posting).
- T14 Notifications: event publisher, in-app, web push (VAPID), email for Admin summaries, WhatsApp adapter behind whatsapp_enabled (logs only when off). Critical events cannot be muted. Daily grouping of low-stock alerts.
- T15 Weekly Exception Report job, in-app view and email.
- T17 Material Out starts with Request Queue or Emergency Issue; mr_required_for_issue enforcement; dashboard tiles; navigation changes for all three roles.

STOP after T17.
```

## Prompt 6 – Site Engineer PWA (T16)

```
Read CLAUDE.md, spec §4 T16, and PRD §16.13.

Build the Site Engineer app as a responsive, installable PWA on the existing frontend stack:
- Screens: Home, Request Material (copy previous, recent/frequent materials first, stock status chip), My Requests, Acknowledge, Return Request. Report Work Done and Raise Indent stay hidden until their flags are on.
- Offline (R6): service worker caches the app shell and reference data (assigned locations, contractors, recent materials). Queue MR submit, acknowledgement and return request in IndexedDB with a client-generated idempotency key; background sync on reconnect; visible "Waiting to send" state; no duplicates after sync.
- Web push subscription using the VAPID public key from config.
- Mobile-first: large touch targets, minimal typing, usable on a mid-range Android phone on a slow network.

STOP and tell me how to install and try it on my phone.
```

> **Strong recommendation:** pilot Phases 1 and 2A on one site before relying on Phase 4A. You can keep building, because everything below stays behind flags that are off, but don't switch `control_enabled` on until the client gives you activity-wise planned quantities and mix designs. Without that data, Prompt 7's output is dead code.

## Prompt 7 – Phase 4A part 1: activities, norms, reconciliation (T18–T21)

```
Read CLAUDE.md, spec §5 T18–T21, §6.1, and PRD §16.9.

Build behind control_enabled:
- T18 Activity Types, Activities, Norms (keyed on Activity Type + Material, source reference required, no default norms), Excel import with a validation report.
- T19 Work progress entry in the PWA.
- T20 Reconciliation on acknowledged quantity, excluding site_loss and tool transactions. It must never post a stock transaction.
- T21 Budget-based MR routing (planned qty × norm); fall back to the T7 per-material limit when no norm exists.

Log a worked numeric example for T20 in docs/TEST_BACKLOG.md (e.g., 100 m³ M25, norm X bags/m³, issued Y, acknowledged Z, returned W → expected variance).

STOP after T21.
```

## Prompt 8 – Phase 4A part 2: tools and indents (T22–T24)

```
Read CLAUDE.md, spec §5 T22–T24, §6.1 invariants 4 and 6, and PRD §16.10–16.11.

Build:
- T22 Tool custody: tool_issue / tool_return / tool_write_off, excluded from consumption, average daily consumption and Material Out reports. Behind tool_custody_enabled.
- T23 Indents, plus optional indent reference on Material In and Quick Receive. Behind indents_enabled.
- T24 Rule-based suggested indents: never auto-submitted; skipped when there is no lead time or fewer than 7 days of history.

Add the remaining Approvals inbox tabs (tool write-off, indents).

STOP after T24.
```

## Prompt 9 – Reports (spec §6.4)

```
Read CLAUDE.md, spec §6.4, and PRD §20.

Add the new reports. Change the Material Out and Material Movement reports to exclude tool transactions and show In Custody and Site Loss as separate lines (PRD §20.1). Use the existing v2.0 report mechanism with date filters and Excel/PDF export. Respect role scoping (SE sees own locations only).

Update docs/PROGRESS.md so every task T0–T24 shows Done or a reason it isn't. STOP with a list of anything not built.
```

---

# STAGE 2 – TESTING

## Prompt 10 – Write the test suites

```
Read CLAUDE.md, docs/TEST_BACKLOG.md, spec §6.1 and §6.5, and PRD §30.3.

Development is complete. Now write the tests.

1. Create reusable ledger assertion helpers for every invariant in spec §6.1. Every test that posts a transaction calls them.
2. Write unit and API tests for every entry in docs/TEST_BACKLOG.md and every item in spec §6.5 and PRD §30.3, task by task from T0 to T24.
3. Run the full suite (v2.0 + new). For each failure: decide whether the test or the code is wrong against the spec. Fix code bugs one commit each (`fix(T12): ...`). Never weaken a test to make it pass.
4. Mark each backlog entry as covered, with the test file name.

STOP with: tests written per task, failures found, bugs fixed, anything you could not test automatically.
```

## Prompt 11 – Integration, concurrency, permissions, regression

```
Read CLAUDE.md, spec §2, §6.1, §6.5.

1. Seed a realistic dataset: 1 project, 2 stores, 2 towers × 10 floors, 3 SEs with different assignments, 5 contractors, 40 materials including tools, 30 days of mixed transactions including partial issues, emergency issues, every dispute exit, returns and tool issues.
2. Ledger audit: recompute every stock balance from the ledger and compare with stored balances. Zero difference required.
3. Concurrency: parallel issues on the same material; duplicate submissions with the same idempotency key; every background job run twice.
4. Permission matrix: every endpoint × role (Admin, Admin with can_approve, SM, SE with and without assignment) → allowed/denied as in spec §2.
5. Flags-off regression: with every v2.1 flag off, the original v2.0 suite passes unchanged.
6. Offline PWA: queue → reconnect → exactly one server record.
7. Migrations up and down on a copy of a v2.0 database dump (I will give you the path; never production).
8. Write docs/TEST_REPORT.md: coverage per task, pass/fail, bugs found and fixed, known gaps, and a manual UAT script for each role.

STOP with the test report summary.
```

---

# STAGE 3 – RELEASE

## Prompt 12 – Release readiness

```
Read CLAUDE.md and docs/TEST_REPORT.md.

Write docs/RELEASE_v2.1.md:
- Migration order, expected duration on a production-sized database, rollback steps.
- Data migration for existing locations and free-text contractors, and what the admin must review afterwards.
- Env variables required per environment (names only, never values).
- Flag rollout: requisition_enabled on for one pilot project first; mr_required_for_issue two weeks later; control_enabled only after norm data is loaded.
- Post-deploy smoke test checklist.

Do not deploy anything. STOP.
```

---

## Reusable prompts

**Resume after interruption**
```
Read CLAUDE.md and docs/PROGRESS.md. Check git status and the last commit. Tell me where we stopped and what is incomplete, then continue the current task only.
```

**Bug fix**
```
Read CLAUDE.md. Bug: <what happened, expected vs actual, steps>. Find the cause, fix it, run the existing suite, and add the case to docs/TEST_BACKLOG.md (or, once Stage 2 has started, write a failing test first). Log it in docs/PROGRESS.md.
```

**Spec change**
```
Read CLAUDE.md. Spec change: <describe>. Update docs/specs/KAVACH_v2.1_Dev_Change_Spec.md first, log the reason in docs/DECISIONS.md, list every task and file affected, and wait for my OK before changing code.
```
