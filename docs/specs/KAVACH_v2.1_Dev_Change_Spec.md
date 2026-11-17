# KAVACH v2.0 → v2.1 Developer Change Spec

2026-11-17 · KAVACH team · Source: KAVACH PRD v2.1 (Consolidated)

## 0. Read First

### 0.1 What this is

The delta between the existing v2.0 codebase and PRD v2.1. It covers only what changes or is added. Anything not mentioned here behaves as in v2.0. Where this spec and the PRD disagree, the PRD wins; raise it rather than guessing.

### 0.2 Branch, do not clone

Do not copy the v2.0 project into a separate "2.0" folder or repository. Two copies of the same codebase drift within weeks, and every v2.0 bug fix has to be made twice. Create a `release/2.1` branch (or feature branches off main), put new behaviour behind feature flags, and keep one codebase.

Feature flags to create:

| Flag                    | Controls                                                                      | Default                                   |
|-------------------------|-------------------------------------------------------------------------------|-------------------------------------------|
| `requisition_enabled`   | Phase 2A: MR, store queue, acknowledgement, disputes, return requests, SE PWA | Off until UAT passes                      |
| `mr_required_for_issue` | Block Material Out without MR or Emergency flag                               | Off for first 2 weeks of go-live, then On |
| `control_enabled`       | Phase 4A: activities, norms, reconciliation, budget routing                   | Off until client provides norm data       |
| `indents_enabled`       | Indents and suggested indents                                                 | Off                                       |
| `tool_custody_enabled`  | Tool Issue / Return / Write-off                                               | Off                                       |
| `whatsapp_enabled`      | WhatsApp channel                                                              | Off until API approved                    |

### 0.3 Build order

Build strictly in this order. Each step must pass its acceptance tests before the next starts.

1.  **Phase 1 additions** (Section 3): role, location hierarchy, contractor master, material master fields, approver permission. Small, unblocks everything.

2.  **Phase 2A** (Section 4): the requisition loop and the Site Engineer PWA. This is the core of v2.1.

3.  **Pilot Phase 2A on one site for 2–4 weeks.** Measure emergency-issue % and acknowledgement within 24h before building anything else.

4.  **Phase 4A** (Section 5): only after the client has supplied activity-wise quantities and mix designs.

5.  **Reports** (Section 6.4).

Do not build "all new features" in one pass. Phase 4A without client norm data is dead code.

### 0.4 Assumed defaults for unresolved items

The PRD leaves R1–R9 open. This spec assumes the defaults below so work can start. Each is isolated so it can be changed cheaply. Product owner to confirm.

| ID  | Assumed default                                                                                                                                                                               |
|-----|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| R1  | Per-material MR maximum is applied cumulatively per material, per location, per calendar day (sum of open + issued MR lines that day).                                                        |
| R2  | Approver is a permission (`can_approve`) assignable to any Project Admin or a named user, not a new role.                                                                                     |
| R3  | Site Loss is not deducted from store stock; it appears only in the issue-accountability line.                                                                                                 |
| R4  | A Wrong Material dispute cannot be closed as Reissued until a linked Return Request for the wrong item is confirmed.                                                                          |
| R5  | When a material is created in Tools and Equipment or Safety Equipment (manual or AI-assisted), the Returnable field must be explicitly answered; no default is accepted for those categories. |
| R6  | The SE PWA queues MR submissions and acknowledgements offline and syncs when online, using client-generated idempotency keys.                                                                 |
| R7  | No Site Supervisor login in v2.1. The SE (or Store Manager at handover) records the physical receiver's name in "Received By".                                                                |
| R8  | No native SE app. PWA only.                                                                                                                                                                   |
| R9  | Estimate Phase 2A from this spec before committing dates.                                                                                                                                     |

## 1. Data Model Changes

All new tables carry: `id`, `project_id`, `store_id` (where stock-related), `created_by`, `created_at`, `updated_by`, `updated_at`. All status changes are written to `audit_logs`. Soft delete only; nothing posted is ever hard-deleted.

### 1.1 Altered Tables

| Table                        | Change                                                                                                                                                                                                                                                                                                  | Notes                                                                                  |
|------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|
| `roles`                      | Add row `site_engineer`                                                                                                                                                                                                                                                                                 | Seed migration                                                                         |
| `users`                      | Add `can_approve` boolean, default false                                                                                                                                                                                                                                                                | R2                                                                                     |
| `locations`                  | Add `parent_id` (self FK, nullable), `level` enum (`tower`, `floor`, `work_area`)                                                                                                                                                                                                                       | Existing flat locations become `tower` level with null parent. Migrate before go-live. |
| `materials`                  | Add `lead_time_days` int null; `returnable` boolean not null default false                                                                                                                                                                                                                              | R5 rule enforced in API, not DB                                                        |
| `supplier_material_mappings` | Add `lead_time_override_days` int null                                                                                                                                                                                                                                                                  |                                                                                        |
| `material_transactions`      | Add `transaction_type` values (see 1.3); add `mr_item_id` FK null; `is_emergency` boolean default false; `emergency_reason` text null; `contractor_id` FK null; `activity_id` FK null; `indent_item_id` FK null; `custody_person` text null; `expected_return_date` date null; `idempotency_key` unique | Existing free-text `issued_to` kept read-only for history                              |
| `settings`                   | Add keys: `buffer_days` (default 7), `mr_expiry_days` (3), `ack_overdue_hours` (24), `emergency_regularise_hours` (24), `emergency_rate_threshold_pct` (10), `return_request_overdue_days` (3), `se_stock_visibility` (`status` / `quantity`)                                                           | Per project                                                                            |

### 1.2 New Tables

**Phase 1**

| Table                       | Key Columns                                                                                                        |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------|
| `contractors`               | `name`, `trade`, `contact_name`, `phone`, `status` (`active`, `pending`, `inactive`), `approved_by`, `approved_at` |
| `user_location_assignments` | `user_id`, `location_id` (any level), unique (`user_id`, `location_id`)                                            |

**Phase 2A**

| Table                      | Key Columns                                                                                                                                                                                                                                                                                                          |
|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `material_requests`        | `mr_number`, `mr_type` (`standard`, `retrospective`), `location_id`, `activity_id` null (2A) / required (4A), `contractor_id`, `priority` (`normal`, `urgent`), `required_by`, `notes`, `header_status` (derived, stored for query), `emergency_txn_id` null (retrospective only), `submitted_at`, `idempotency_key` |
| `material_request_items`   | `mr_id`, `material_id`, `requested_qty`, `unit_id`, `issued_qty` (derived), `line_status`, `approval_status` (`not_required`, `pending`, `approved`, `rejected`), `approved_by`, `approved_at`, `reject_reason`, `expires_at`                                                                                        |
| `material_mr_limits`       | `material_id`, `max_qty_per_location_per_day`                                                                                                                                                                                                                                                                        |
| `issue_acknowledgements`   | `material_txn_id` unique, `received_qty`, `received_by_name`, `acknowledged_by`, `acknowledged_at`, `photo_url`, `remarks`, `idempotency_key`                                                                                                                                                                        |
| `issue_disputes`           | `acknowledgement_id` unique, `reason` (`short`, `wrong_material`, `damaged`, `not_received`, `other`), `disputed_qty`, `status` (`open`, `resolved`), `exit` (`accepted`, `loss_recorded`, `reissued`, `posting_error_reversed`), `resolved_by`, `resolved_at`, `linked_return_request_id` null                      |
| `site_losses`              | `dispute_id` unique, `material_txn_id`, `qty`, `reason`, `approved_by`, `approved_at`                                                                                                                                                                                                                                |
| `return_requests`          | `rr_number`, `location_id`, `contractor_id`, `mr_id` null, `reason` (`excess`, `work_changed`, `wrong_material`, `other`), `status` (`pending`, `confirmed`, `cancelled`), `material_return_txn_id` null                                                                                                             |
| `return_request_items`     | `return_request_id`, `material_id`, `requested_qty`, `confirmed_qty`, `variance_reason`                                                                                                                                                                                                                              |
| `notifications`            | `user_id`, `event_type`, `entity_type`, `entity_id`, `channel`, `status`, `sent_at`, `read_at`, `is_critical`                                                                                                                                                                                                        |
| `notification_preferences` | `user_id`, `event_type`, `channel`, `muted` (critical events cannot be muted)                                                                                                                                                                                                                                        |

**Phase 4A**

| Table                         | Key Columns                                                                                                                                                                       |
|-------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `activity_types`              | `name` (e.g., M25 Concrete), `work_unit_id`                                                                                                                                       |
| `activities`                  | `name`, `activity_type_id`, `location_id`, `planned_qty`, `status` (`not_started`, `in_progress`, `completed`)                                                                    |
| `consumption_norms`           | `activity_type_id`, `material_id`, `norm_per_work_unit`, `allowed_variance_pct`, `source_reference` (mix design / spec ref, required), unique (`activity_type_id`, `material_id`) |
| `work_progress`               | `activity_id`, `qty_completed`, `progress_date`, `status`, `photo_url`                                                                                                            |
| `consumption_reconciliations` | `activity_id`, `material_id`, `theoretical_qty`, `acknowledged_net_qty`, `variance_qty`, `variance_pct`, `result` (`within`, `excess`, `under`), `run_at`                         |
| `indents`                     | `indent_number`, `location_id`, `activity_id` null, `status`, `justification`, `approved_by`, `approved_at`, `is_system_suggested`                                                |
| `indent_items`                | `indent_id`, `material_id`, `qty`, `required_by`, `approved_qty`, `received_qty` (derived)                                                                                        |
| `tool_custody`                | `tool_issue_txn_id`, `person_name`, `location_id`, `expected_return_date`, `status` (`in_custody`, `returned`, `written_off`), `closing_txn_id`                                   |

### 1.3 Enums

**Transaction types:** `material_in`, `material_out`, `material_return`, `stock_adjustment`, `reversal`, `site_loss`, `tool_issue`, `tool_return`, `tool_write_off`.

**MR line status:** `open`, `partially_issued`, `issued`, `acknowledged`, `disputed`, `resolved`, `rejected`, `cancelled`, `expired`. An MR in Draft has no lines in the store queue; Draft is a header-only state before submission.

**MR header status (derived):** `draft`, `open`, `in_progress`, `completed`, `closed`.

| Header        | Rule                                                                           |
|---------------|--------------------------------------------------------------------------------|
| `open`        | No line has any issue                                                          |
| `in_progress` | Any line is `partially_issued`, `issued` or `disputed`                         |
| `completed`   | Every line is `acknowledged`, `resolved`, `rejected`, `cancelled` or `expired` |
| `closed`      | `completed` and locked by system after 7 days or by Admin                      |

Recompute header status in the same DB transaction as any line change.

## 2. Roles and Permissions

Enforce every rule in the backend. The UI hiding a button is not a permission.

| Capability                                   | Project Admin         | Store Manager              | Site Engineer                                                |
|----------------------------------------------|-----------------------|----------------------------|--------------------------------------------------------------|
| Manage contractors                           | Full; approve Pending | View; quick-add as Pending | View (select only)                                           |
| Manage location hierarchy and SE assignments | Full                  | –                          | –                                                            |
| Create / copy / cancel MR                    | –                     | –                          | Own, within assigned locations                               |
| View MRs                                     | All                   | Queue                      | Own                                                          |
| Approve / reject MR lines                    | If `can_approve`      | –                          | –                                                            |
| Issue against MR / reject MR line            | –                     | Yes                        | –                                                            |
| Emergency issue                              | –                     | Yes                        | –                                                            |
| Create Retrospective MR                      | –                     | –                          | Yes, for emergency issues at own locations                   |
| Acknowledge / dispute                        | –                     | –                          | Own locations                                                |
| Resolve dispute / approve Site Loss          | If `can_approve`      | –                          | –                                                            |
| Raise Return Request                         | –                     | –                          | Own locations                                                |
| Confirm Return Request                       | –                     | Yes                        | –                                                            |
| Activity Types, Activities, Norms            | Full                  | View                       | View own locations                                           |
| Work progress                                | View                  | View                       | Own locations                                                |
| Raise indent                                 | –                     | –                          | Own locations                                                |
| Approve indent                               | If `can_approve`      | View                       | Own only                                                     |
| Tool Issue / Tool Return                     | –                     | Yes                        | Request via MR                                               |
| Approve Tool Write-off                       | If `can_approve`      | Request                    | –                                                            |
| Stock view                                   | Full                  | Full                       | Status only, or quantity if `se_stock_visibility = quantity` |

Hard rules:

- A user can never approve a record they created (`created_by = approver` → 403).

- SE location check: requested `location_id` must equal or descend from one of the user's assignments. Implement as a recursive query or a materialised path on `locations`.

- Every endpoint filters by `project_id` from the session, never from the request body.

## 3. Phase 1 Additions

### T1 – Site Engineer role

- Seed `site_engineer` role with the permissions in Section 2.

- Admin can create SE users from User Management.

- **Done when:** an SE can log in, sees only the SE navigation (Dashboard, My Requests, Returns, Work Progress, Indents, Stock, Reports), and gets 403 on every Store Manager and Admin endpoint.

### T2 – Location hierarchy and SE assignment

- Migrate `locations` to Tower → Floor → Work Area (`parent_id`, `level`). Existing flat locations become towers.

- Location Management UI: tree view; add child; move is not allowed once transactions exist.

- Assignment screen: pick SE → pick one or more nodes at any level.

- Helper `user_can_access_location(user, location)` = location equals or descends from any assignment. Use it everywhere.

- **Done when:** SE assigned to Tower A can request for Tower A → 7F → Slab Area; SE assigned only to Tower A → 7F gets 403 for Tower A → 8F.

### T3 – Contractor Master

- CRUD for Admin. Fields: name, trade, contact name, phone, status.

- Store Manager quick-add from any contractor picker: creates `status = pending`, usable immediately, appears in Admin Approvals inbox.

- Pickers show `active` and `pending`; never `inactive`.

- Material Out, MR, emergency issue and return request use `contractor_id`. Free text is rejected by the API.

- **Done when:** issuing without a contractor ID fails; quick-added contractor shows as Pending in the Admin inbox.

### T4 – Material Master fields

- Add Lead Time (days) and Returnable to create/edit forms and to the AI-assisted new-material review (Material In Screen 3).

- R5: if category is Tools and Equipment or Safety Equipment, the Returnable control starts unanswered and must be set before save.

- Supplier mapping edit: optional Lead Time Override.

- Settings: Buffer Days and the other keys in Section 1.1.

- **Done when:** AI-proposed drill machine cannot be confirmed until Returnable is answered.

### T5 – Approver permission

- `can_approve` toggle in User Management (Admin only).

- Approvals inbox (built in T9) shows only to users with `can_approve`.

- **Done when:** a non-approver gets 403 on every approve/reject/resolve endpoint, and nobody can approve their own record.

## 4. Phase 2A – Requisition

All of Phase 2A sits behind `requisition_enabled`.

### T6 – Material Request: create, copy, cancel

**Create (SE):** location (from assignments), activity (optional in 2A), contractor, priority, required_by, notes, one or more lines (material, qty in stock unit).

Validation (reject with field-level errors):

- qty \> 0; material active; unit = material stock unit.

- `user_can_access_location`.

- contractor `active` or `pending`.

- `required_by >= now` for `standard` MRs.

- Returnable materials allowed (they become Tool Issues at fulfilment).

- Warning (not error) if an open line exists for the same material + location.

**Copy:** clones lines and header from any own MR; required_by reset; location must still be assigned.

**Cancel:** SE can cancel lines still `open` with zero issued. Cancelling all lines cancels the MR.

**Drafts:** saved server-side and in PWA local storage.

**Idempotency:** client sends `Idempotency-Key`; duplicate key returns the original MR.

**Done when:** repeat MR from "Copy previous" can be submitted in under 30 seconds on a mid-range Android phone on 3G.

### T7 – Approval routing (Phase 2A rules)

On submit, for each line:

1.  Look up `material_mr_limits.max_qty_per_location_per_day`.

2.  Sum today's quantity for that material + location across all non-cancelled, non-rejected lines including this one (R1).

3.  Above limit → `approval_status = pending`, line not visible in store queue.

4.  Otherwise → `not_required`, line goes to store queue.

5.  Priority `urgent` never waits for approval; it goes to the queue and is logged for the Weekly Exception Report.

No value-threshold rule. No activity-budget rule (that is T21).

### T8 – Store Request Queue and issue against MR

- Queue lists lines with `approval_status in (not_required, approved)` and `line_status in (open, partially_issued)`.

- Sort: urgent first, then `required_by` ascending.

- Columns: MR number, location path, activity, contractor, requested by, material, requested qty, issued so far, available stock, required by, priority.

- Issue: Store Manager enters qty per line (≤ balance, ≤ available stock). Posts one `material_out` per line with `mr_item_id`, `contractor_id`, `activity_id`, location. Returnable materials post `tool_issue` instead (T22 if enabled; otherwise as `material_out` with a warning).

- Partial issue leaves balance open. Line becomes `partially_issued` or `issued`.

- Reject line: reason from list (Insufficient Stock, Wrong Material Requested, Duplicate Request, Not Approved, Other + text). If Insufficient Stock and `indents_enabled`, offer "Raise indent".

- Notify SE on issue and on reject.

### T9 – Approvals inbox

One screen for users with `can_approve`. Tabs/filters:

| Item                      | Actions                                              |
|---------------------------|------------------------------------------------------|
| MR lines pending approval | Approve (optionally reduce qty) / Reject with reason |
| Open disputes             | Resolve (T12)                                        |
| Site Loss approvals       | Approve / Reject                                     |
| Tool write-off requests   | Approve / Reject (Phase 4A)                          |
| Indents                   | Approve / Modify / Reject (Phase 4A)                 |
| Pending contractors       | Approve / Deactivate                                 |

Urgent MRs and emergency issues are **not** inbox items; they go to the Weekly Exception Report (T15).

### T10 – Emergency issue and Retrospective MR

**Emergency issue (Store Manager):** from Material Out, "Emergency Issue" requires location, activity, contractor, reason. Posts `material_out` with `is_emergency = true`. Notifies the SE(s) assigned to that location.

**Retrospective MR (SE):** created only from an emergency transaction at an assigned location. Pre-fills everything; `mr_type = retrospective`; `required_by` may be past; activity mandatory; links `emergency_txn_id`. Submitting it links the line to the existing transaction (no new stock movement) and sets the line to `issued`, so acknowledgement proceeds normally.

**Escalation job (hourly):** emergency transactions with no retrospective MR after `emergency_regularise_hours` → notify Admin (critical) and mark `escalated`.

**Weekly rate:** emergency issues ÷ all issues for the week \> `emergency_rate_threshold_pct` → flag on Admin dashboard and in the Weekly Exception Report.

### T11 – Issue acknowledgement

- SE sees "Pending Acknowledgements" for own locations.

- Per Material Out: issued qty (read-only), received qty, received-by name (R7), photo optional, remarks.

- received qty = issued → line moves to `acknowledged` when all its transactions are acknowledged.

- received qty \< issued, or wrong/damaged → creates dispute (T12); line → `disputed`.

- Overdue job (hourly): unacknowledged after `ack_overdue_hours` → flag + notify SE and Admin. Never auto-acknowledge.

- Works offline in the PWA (R6).

### T12 – Disputes and Site Loss

Approver resolves a dispute with exactly one exit:

| Exit                     | Ledger effect                                                                                                                                              | Line status                                    |
|--------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------|
| `accepted`               | None                                                                                                                                                       | `resolved`                                     |
| `loss_recorded`          | Insert `site_loss` transaction against the Material Out for the disputed qty. **No change to store stock.** Requires approval.                             | `resolved`                                     |
| `reissued`               | New `material_out` on the same line for the shortfall (normal stock check). For `wrong_material`, blocked until a linked Return Request is confirmed (R4). | `issued` again, then `acknowledged` on new ack |
| `posting_error_reversed` | `reversal` of the original Material Out. Only allowed when approver confirms material never left the store. Restores store stock.                          | `open` (balance re-opens)                      |

All exits record approver and timestamp. A dispute cannot be resolved by its creator.

### T13 – Return Requests

- SE raises: location, contractor, related MR (optional), reason, lines (material, qty).

- Store Manager confirms from "Pending Return Requests": per line confirmed qty, condition (Good / Damaged / Scrap), variance reason if qty differs. Posts the existing v2.0 `material_return` linked to the request. Good increases stock; Damaged/Scrap tracked separately as in v2.0.

- Overdue job: pending beyond `return_request_overdue_days` → flag.

- Store-initiated returns without a request still work.

### T14 – Notifications

- Event bus: every event in PRD 16.12 publishes `{event_type, entity, recipients}`.

- Channels: in-app (always), web push (PWA), WhatsApp (if `whatsapp_enabled`), email (Admin summaries only).

- Critical events (cannot be muted): MR needs approval, emergency issue unregularised, acknowledgement overdue, dispute raised.

- Group repeated low-stock alerts for the same material into one daily summary.

### T15 – Weekly Exception Report

Generated every Monday 08:00 project time, in-app and email to Admin. Contents: urgent MRs (with time from raise to issue), emergency issues (regularised / escalated), weekly emergency rate vs threshold, acknowledgements overdue, disputes older than 7 days.

### T16 – Site Engineer PWA

- Responsive web app, installable to home screen, same backend and auth.

- Screens: Home (4 actions: Request Material, Return Material, Report Work Done \[hidden until 4A\], Raise Indent \[hidden until 4A\]; lists: Pending Acknowledgements, My Open Requests, Tools in My Custody, Alerts), Request Material, My Requests, Acknowledge, Return Request.

- Offline (R6): service worker caches app shell, assigned locations, contractors, recent materials; queues MR submit, acknowledgement and return request in IndexedDB with idempotency key; background sync on reconnect; shows "Waiting to send" state.

- Large touch targets, minimal typing, recent/frequent materials first.

### T17 – Dashboards, navigation, Material Out changes

- Material Out (web and mobile): first step is "Select from Request Queue" or "Emergency Issue". With `mr_required_for_issue` on, direct issue without either is blocked.

- Admin dashboard: add Approvals count, Open Disputes, Emergency Issues (escalated + weekly rate), Consumption Variance (4A).

- Store Manager dashboard: Pending Material Requests (sorted by required_by), Pending Return Requests.

- Admin nav: add Approvals, Contractors, Activities & Norms (4A). Store Manager nav: add Request Queue, Tool Custody (4A).

## 5. Phase 4A – Control

Start only after the client has supplied activity-wise planned quantities and mix designs. Behind `control_enabled`, `indents_enabled`, `tool_custody_enabled`.

### T18 – Activity Types, Activities, Norms

- Admin CRUD for Activity Types (name, work unit).

- Activities: name, type, location (any level), planned qty, status.

- Norms: per Activity Type + Material; norm per work unit, allowed variance %, source reference (required). No seeded default norms.

- Bulk import from Excel template for activities and norms (clients will have BOQ in Excel).

- Once `control_enabled`, MR activity becomes mandatory for standard MRs.

### T19 – Work progress

- SE PWA "Report Work Done": pick activity at assigned location, qty completed, date, status, photo optional.

- Cumulative completed qty may not exceed planned qty by more than 10% without Admin override.

### T20 – Consumption reconciliation

Run when an activity is marked Completed, and weekly (Sunday night) for In Progress activities. Only for activities whose type has norms. Only for tracked materials (cement, steel, sand, aggregate, blocks/bricks, tiles; configurable).

    theoretical  = sum(work_progress.qty_completed) × norm
    ack_net      = sum(acknowledged received_qty for material_out linked to the activity)
                 − sum(Good returns linked to the activity)
    variance     = ack_net − theoretical
    variance_pct = variance ÷ theoretical × 100

- Exclude `site_loss`, all tool transactions, and unacknowledged issues (report the unacknowledged qty alongside so it is visible).

- Emergency issues count only once regularised (they then carry an activity).

- Result `excess` / `under` → notify Admin. Never post a stock transaction.

### T21 – Budget-based MR routing

With `control_enabled`, add to T7: for each line, if the activity's type has a norm for the material, `budget = planned_qty × norm`. If (already issued to activity + open lines + this line) \> budget → approval. If no norm, T7 per-material limit applies.

### T22 – Tool custody

- Materials with `returnable = true` fulfil MR lines through `tool_issue` (person name, expected return date) instead of `material_out`.

- `tool_return` with condition: Good → stock up; Damaged → separate, as v2.0 returns.

- `tool_write_off`: Store Manager requests, approver approves in inbox. Closes custody. No store stock change (already out).

- Overdue job (daily): past expected return date → notify SE and Store Manager.

- Tool transactions excluded from Material Out reports, average daily consumption and reconciliation.

### T23 – Indents

- SE raises indent: location, activity optional, lines (material, qty, required by), justification. Current stock shown.

- Approver: Approve / Modify (change qty) / Reject. Every indent needs approval.

- Approved → `sent_to_purchase`. Purchase happens outside KAVACH.

- Material In (Screen 3 line and Quick Receive): optional Indent reference per line. Received qty rolls up to `indent_items.received_qty`; status → Partially Received / Fully Received.

### T24 – System-suggested indents

Daily job per material per store:

    avg_daily = sum(material_out qty, last 14 days) ÷ 14   (tool_issue excluded)
    days_of_cover = available_stock ÷ avg_daily
    lead_time = supplier mapping override (most recent supplier) else materials.lead_time_days
    suggest if lead_time is not null and days_of_cover < lead_time + buffer_days

- Creates a suggestion card for Admin / Store Manager with a prefilled draft indent. A human must submit it. Never auto-submit.

- If `lead_time` is null, fall back to Minimum Stock alert only.

- Skip materials with fewer than 7 days of issue history.

## 6. Cross-Cutting

### 6.1 Ledger invariants (write tests for each)

1.  Store stock = Σ material_in + Σ Good material_return + Σ Good tool_return − Σ material_out − Σ tool_issue ± Σ stock_adjustment ± Σ reversal.

2.  `site_loss` and `tool_write_off` never change store stock.

3.  For every Material Out: issued = acknowledged + site loss + pending/disputed.

4.  In Custody = Σ tool_issue − Σ tool_return − Σ tool_write_off, per material and per person.

5.  MRs, acknowledgements, disputes, return requests (until confirmed), indents and reconciliations never change stock.

6.  Negative stock is impossible: issue, tool issue and reissue lock the stock row (`SELECT … FOR UPDATE` or equivalent) and check balance in the same transaction.

7.  Every stock-changing endpoint is idempotent on `idempotency_key`.

### 6.2 Background jobs

| Job                      | Schedule                        | Action                                                                   |
|--------------------------|---------------------------------|--------------------------------------------------------------------------|
| MR line expiry           | Hourly                          | Lines `open`/`partially_issued` past `expires_at` → `expired`; notify SE |
| Acknowledgement overdue  | Hourly                          | Flag + notify SE, Admin                                                  |
| Emergency regularisation | Hourly                          | Escalate after 24h                                                       |
| Return request overdue   | Daily                           | Flag                                                                     |
| Tool return overdue      | Daily                           | Notify SE, Store Manager                                                 |
| Reconciliation           | Weekly + on activity completion | T20                                                                      |
| Suggested indents        | Daily                           | T24                                                                      |
| Weekly Exception Report  | Monday 08:00                    | T15                                                                      |
| Low-stock daily summary  | Daily 07:00                     | Grouped alerts                                                           |
| MR header close          | Daily                           | `completed` older than 7 days → `closed`                                 |

All jobs idempotent and safe to re-run.

### 6.3 API endpoints (REST, suggested)

| Method & Path                                                                      | Purpose                               | Role                  |
|------------------------------------------------------------------------------------|---------------------------------------|-----------------------|
| `GET/POST/PATCH /contractors`                                                      | List, create, quick-add, approve      | Admin, SM (quick-add) |
| `GET/POST /locations`, `POST /users/{id}/location-assignments`                     | Hierarchy, assignment                 | Admin                 |
| `POST /material-requests`                                                          | Create (with Idempotency-Key)         | SE                    |
| `POST /material-requests/{id}/copy`                                                | Copy                                  | SE                    |
| `POST /material-requests/{id}/lines/{lineId}/cancel`                               | Cancel line                           | SE                    |
| `GET /material-requests?scope=mine`                                                | My requests                           | SE                    |
| `GET /store-queue`                                                                 | Queue                                 | SM                    |
| `POST /store-queue/lines/{lineId}/issue`                                           | Issue (partial allowed)               | SM                    |
| `POST /store-queue/lines/{lineId}/reject`                                          | Reject                                | SM                    |
| `POST /material-out/emergency`                                                     | Emergency issue                       | SM                    |
| `POST /material-requests/retrospective`                                            | From emergency txn                    | SE                    |
| `GET /approvals`                                                                   | Inbox                                 | Approver              |
| `POST /approvals/mr-lines/{id}/approve` · `/reject`                                | MR approval                           | Approver              |
| `GET /acknowledgements/pending`                                                    | Pending list                          | SE                    |
| `POST /material-out/{txnId}/acknowledge`                                           | Acknowledge or dispute                | SE                    |
| `POST /disputes/{id}/resolve`                                                      | Exit + Site Loss / reissue / reversal | Approver              |
| `POST /return-requests` · `POST /return-requests/{id}/confirm`                     | Raise, confirm                        | SE, SM                |
| `GET/POST /activity-types`, `/activities`, `/consumption-norms`                    | Masters, Excel import                 | Admin                 |
| `POST /activities/{id}/progress`                                                   | Work progress                         | SE                    |
| `GET /reconciliations`                                                             | Variance results                      | Admin                 |
| `POST /indents` · `POST /indents/{id}/decision`                                    | Raise, approve/modify/reject          | SE, Approver          |
| `GET /indent-suggestions`                                                          | Suggestions                           | Admin, SM             |
| `POST /tools/issue` · `/tools/{custodyId}/return` · `/tools/{custodyId}/write-off` | Tool custody                          | SM, Approver          |
| `GET /notifications` · `PATCH /notifications/preferences`                          | Notifications                         | All                   |
| `GET /reports/{reportKey}`                                                         | Reports                               | Per role              |

### 6.4 Reports to add

Material Request · Pending Acknowledgement · Dispute (incl. Site Loss) · Emergency Issue · Consumption Variance · Indent Status · Tool Custody · Weekly Exception (Phase 2A). Change existing Material Out Report and Material Movement Report to exclude tool transactions and show In Custody and Site Loss as separate lines. All with date filters and Excel/PDF export, as v2.0.

### 6.5 Test checklist (minimum before UAT)

**Phase 1**

- SE blocked from all SM/Admin endpoints.

- Tower-level assignment covers child floors; sibling floor blocked.

- Contractor free text rejected; Pending quick-add appears in inbox.

- Tools-category material cannot be saved without Returnable answered.

- Self-approval returns 403 everywhere.

**Phase 2A**

- MR submitted twice with same Idempotency-Key creates one MR.

- Daily cumulative limit routes the third MR of the day to approval (R1).

- Urgent MR skips approval and appears in Weekly Exception Report.

- Partial issue leaves balance; header goes Open → In Progress → Completed correctly.

- Issue above available stock fails; concurrent issues cannot drive stock negative.

- Emergency issue without activity fails; Retrospective MR links without a second stock movement; 24h escalation fires.

- Acknowledgement queued offline syncs once, not twice.

- Dispute exits: Accepted (no ledger), Loss Recorded (site_loss, store stock unchanged), Reissued (new Material Out), Posting error (reversal restores stock).

- Wrong Material cannot be Reissued before return confirmed (R4).

- Return Request with different confirmed qty requires variance reason.

- Critical notifications cannot be muted.

- With `mr_required_for_issue` on, direct Material Out is blocked.

**Phase 4A**

- Reconciliation uses acknowledged qty; excludes site loss and tools; flags excess and under.

- Budget routing sends over-budget line to approval.

- Tool issue excluded from Material Out report and average daily consumption.

- Suggested indent appears only when lead time exists; never auto-submitted.

- Material In with indent reference updates indent received qty and status.
