# KAVACH – Project Rules for Claude Code

KAVACH is a construction material inventory system (web + mobile) for real-estate projects in India.
The codebase currently implements PRD v2.0. We are upgrading it to **PRD v2.1**.

## Source of truth

| File | Purpose |
|---|---|
| `docs/specs/KAVACH_v2.1_Dev_Change_Spec.md` | **What to build.** Tasks T1–T24, data model, permissions, jobs, APIs, tests. |
| `docs/specs/KAVACH_PRD_v2.1.md` | **Why / full product context.** Wins if it conflicts with the change spec. |
| `docs/PROGRESS.md` | Task-by-task status log. Update after every task. |
| `docs/DECISIONS.md` | Every assumption, deviation and spec-to-codebase name mapping, with reason. |

There is no separate planning phase. Read the existing code you are about to change, then build.
Follow the existing codebase's naming and structure. If a spec table or column already exists under another name (e.g., spec `material_transactions` = our `stock_ledger`), use the existing one and record the mapping in `docs/DECISIONS.md`.

If the spec is ambiguous or conflicts with existing code on anything that touches stock, **stop and ask**. For anything else, pick the option closest to the PRD, log it in `docs/DECISIONS.md`, and continue.

## Non-negotiable rules

### Inventory ledger
- `material_transactions` is the authoritative ledger. Stock balances must always equal the ledger.
- Posted transactions are never updated or deleted. Corrections use new transactions.
- Every stock-changing operation runs in ONE database transaction, locks the stock row, checks balance, and is idempotent on an idempotency key.
- Negative stock is impossible.
- `site_loss` and `tool_write_off` never change store stock.
- MRs, acknowledgements, disputes, unconfirmed return requests, indents and reconciliations never change stock.
- Reversal is used only for store posting errors.

### Backward compatibility
- All v2.1 behaviour sits behind feature flags (see spec §0.2). With every flag OFF, the app must behave exactly as v2.0.
- Migrations are additive and reversible. No column drops or renames of v2.0 columns in this release. Each migration has a working `down`.
- Do not refactor v2.0 code unless a task requires it. If you must, note it in `docs/DECISIONS.md`.

### Security
- Every permission is enforced in the backend. Hidden UI is not a permission.
- `project_id` always comes from the authenticated session, never from the request body.
- A user can never approve a record they created.

### Secrets and environment files
- **Never open, read, print, or commit `.env`, `.env.local`, `.env.production` or any real secrets file.**
- Only edit `.env.example` (placeholder values). Document every new variable in `docs/ENV_SETUP.md`.
- The app must fail fast at startup with a clear message if a required variable for an ENABLED feature is missing.

### Working style
- Two stages: **Development** (Prompts 1–9) builds every feature. **Testing** (Prompts 10–11) writes the new test suites and fixes bugs.
- Work one task (T-number) at a time, in the order given in the prompt.
- For every task in Development: implement (migration with `down`, backend, permission checks, UI) → build, type-check and lint pass → the EXISTING v2.0 test suite still passes → update `docs/PROGRESS.md` → commit.
- Do not write new test files during Development. Instead, add each task's "Done when" line and any edge case you notice to `docs/TEST_BACKLOG.md` under its T-number, so the Testing stage has a complete list.
- Commit message format: `feat(T7): MR approval routing with daily cumulative limit`.
- Never leave the existing v2.0 suite worse than you found it. If a v2.0 test fails because of an intended v2.1 change, do not delete or weaken it: log it in `docs/TEST_BACKLOG.md` and tell me.
- At the end of each prompt, STOP and give a summary: what was done, files changed, migrations added, anything skipped, open questions.
- Do not start the next prompt's tasks on your own.

## Domain glossary
- **MR** – Material Request raised by a Site Engineer (SE).
- **SE** – Site Engineer. **SM** – Store Manager. **Approver** – user with `can_approve`.
- **Emergency issue** – Material Out without an MR; must be regularised by a **Retrospective MR** within 24h.
- **Site Loss** – Admin-approved record that issued material did not reach site intact. No store stock change.
- **Indent** – advance requirement for procurement (procurement itself is outside KAVACH).
- **Location hierarchy** – Tower → Floor → Work Area. Assignment at any level covers everything below.
