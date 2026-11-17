# KAVACH – AI-Powered Construction Material Inventory Management System

Product Requirements Document (PRD) v2.1 · Nov 17, 2026 · KAVACH team

## DOCUMENT INFORMATION

| Document Information | Details |
| --- | --- |
| Product | KAVACH |
| Version | 2.1 |
| Date | 17 November 2026 |
| Supersedes | PRD v2.0 (12 November 2026) |
| Product Type | Web Application + Mobile Application |
| Industry | Real Estate / Construction |
| Primary Roles | Project Admin, Store Manager, Site Engineer |
| Core Technology | AI-Powered Invoice Processing |
| Document Status | Consolidated Draft – contradictions C1–C16 decided; open questions (Section 31) and residual issues R1–R9 pending. Not approved for build. |

### Revision History

| Version | Date | Change |
| --- | --- | --- |
| 2.0 | 12 November 2026 | Updated requirements |
| 2.1 (merge) | 17 November 2026 | Merged Site Engineer & Material Requisition addendum (new Section 16 and Section 3.3). Applied Part B amendments in place. Renumbered Sections 16–33 to 17–35. Added Section 31 (Open Questions and Risks). Contradictions C1–C16 flagged. |
| 2.1 (decisions) | 17 November 2026 | Owner decisions on C1–C16 applied throughout. Consistency edits accepted. Residual issues R1–R9 recorded. |

### Section Renumbering Map

| v2.0 Section | v2.1 Section |
| --- | --- |
| 3.3 Important Permission Rule | 3.4 |
| Addendum 3.3A Site Engineer Role | 3.3 |
| Addendum 15A Site Engineer & Material Requisition | 16 |
| 16 Current Stock | 17 |
| 17 Stock Verification | 18 |
| 18 Transaction History and Audit | 19 |
| 19 Reports | 20 |
| 20 Web Application Design | 21 |
| 21 Mobile Application | 22 |
| 22 Technical Architecture | 23 |
| 23 Database Requirements | 24 |
| 24 AI Limitations and Solutions | 25 |
| 25 Non-Functional Requirements | 26 |
| 26 Security and Business Rules | 27 |
| 27 Out of Scope | 28 |
| 28 Development Phases | 29 |
| 29 Testing and Acceptance Criteria | 30 |
| Addendum 15A.16 Open Questions and Risks | 31 (new) |
| 30 Future Enhancements | 32 |
| 31 Final End-to-End Workflows | 33 |
| 32 Final Product Experience | 34 |
| 33 Final Product Principle | 35 |

Addendum material placement: 15A.14 Database Entities → Section 24.4. 15A.15 Business Rules → Section 27 (rules 21–39 after decisions). 15A.16 Phasing → Section 29. 15A.16 Acceptance → Section 30.3. 15A.16 Open Questions and Risks → Section 31. Addendum reference to "Section 27" (Out of Scope) now reads Section 28.

Contradictions C1–C16 have been decided by the product owner and the decisions are applied in the body. Inline flag markers have been removed. Residual issues that the decisions leave open are marked **\[R1\]**–**\[R9\]** in the body and listed at the end of this preamble.

### Contradiction Decisions (Applied 17 November 2026)

Each conflict between v2.0 and the addendum, and its decision, is listed below with the sections it changed.

| ID | Conflict | Decision | Applied In |
| --- | --- | --- | --- |
| C1 | Addendum added many Admin approval queues; conflicted with Sections 28 and 35. | One Approvals inbox. Action items only: over-limit MRs, disputes, losses and write-offs, and indents. Urgent-MR and emergency-issue review become a Weekly Exception Report. Indent approval stays per indent because it authorises purchase spend. Approver may be a Project Manager. Section 35 reworded to "not involved in routine issues". | 3.1, 5.1, 16.5, 16.10, 16.13, 20, 21.2, 28, 35 |
| C2 | Value-threshold approval needed valuation that does not exist. | Removed from MVP. If reintroduced later: valuation = last confirmed purchase rate, labelled "indicative value, not accounting". | 16.5, 28 |
| C3 | Activity budget undefined; norms not available in Phase 2A. | Phase 2A: optional per-material maximum quantity per MR, set by Admin; above it → approval. Budget routing (planned quantity × norm) arrives in Phase 4A. | 16.5, 16.9, 29 |
| C4 | Phase 3 referenced Indents built in Phase 4A. | Indent reference on Material In moved to Phase 4A. | 10.2, 10.3, 29 |
| C5 | SE actions needed on site in Phase 2A; SE app was Phase 4. | SE screens built as a responsive mobile web app (PWA) in Phase 2A. Native SE app may follow in Phase 4. | 16.13, 22.6, 29 |
| C6 | No way to regularise an emergency issue; no consequence. | Retrospective MR type, created only from an emergency issue, past dates allowed, activity mandatory. Emergency issues capture activity. Unregularised after 24h → escalated to Admin and in Weekly Exception Report. Emergency issues above 10% in a week → flagged for Admin review. | 14.2, 16.5, 16.6, 27 |
| C7 | Reversal of a disputed issue inflated store stock. | Reversal only for store posting errors (material never left the store). Short / not received at site: store stock unchanged; Admin-approved Site Loss entry against the issue. Reconciliation uses acknowledged quantity. Site Loss added as a ledger type and as a separate line in the movement formula. | 16.7, 16.9, 19.1, 20.1, 27 |
| C8 | Contractor mandatory but no master. | Contractor Master (name, trade, contact, status), Admin-managed. Always selected, never typed. Store Manager can quick-add as Pending for Admin review. | 3, 4, 14.2, 16.5, 24 |
| C9 | Norms keyed on Activity Type, which did not exist. | Activity Type master (e.g., M25 Concrete, 200mm Blockwork). Activity references Activity Type. Norms keyed on Activity Type + Material. | 16.9, 24.4 |
| C10 | Days of cover needed lead time and buffer that did not exist. | Lead Time (days) on Material Master, optional override on supplier mapping, global Buffer Days in Settings. Missing lead time → Minimum Stock alerts. | 5.1, 6.2, 9.2, 16.10, 16.12 |
| C11 | Tools in custody counted as consumption; no write-off type. | Separate Tool Issue / Tool Return / Tool Write-off transaction types, excluded from consumption, Material Out reports and reconciliation. In Custody shown as its own line. Returnable set per material, default No; category default removed. | 6.2, 16.11, 19.1, 20.1 |
| C12 | Part B confused WhatsApp notifications with WhatsApp invoice submission. | Future item 2 unchanged. WhatsApp notifications are a separate scope item in Section 16.12. | 32 |
| C13 | Suggested indents duplicated Future item 8. | MVP: rule-based days of cover only. Future item 8 renamed "ML-based predictive stock forecasting". | 16.10, 32 |
| C14 | Single header status could not represent multi-line MRs. | Line-level statuses; header status derived; defined dispute exits. | 16.5 |
| C15 | Sections Part B did not touch restated the old Material Out flow. | Consistency edits accepted. Approvals added to Admin navigation; Request Queue added to Store Manager navigation. | 21, 22, 33, 34 |
| C16 | Modules missing; location hierarchy undefined. | Modules added for Issue Acknowledgement, Return Requests, Returnable Tools (and Contractor Management). Hierarchy Tower → Floor → Work Area; assignment at any level covers everything below it. | 3.3, 4 |

### Review Findings Not Addressed by the Addendum

The earlier review identified these gaps. The addendum does not close them, and v2.1 still does not:

- **Stock valuation** – explicitly deferred (C2). No inventory value or wastage in rupees in MVP.
- **Offline support** – still a Future Enhancement (32, item 11). The Phase 2A PWA is online-only unless R6 is accepted.
- **Separation of duties** – the Store Manager still receives, issues, creates Material Master records without approval (3.4), and counts their own stock in Stock Verification (18). Site acknowledgement checks issues only.

### Residual Issues After Decisions

These are weaknesses the C1–C16 decisions leave open or introduce. Each needs an owner decision.

| ID | Issue | Where | Recommendation |
| --- | --- | --- | --- |
| R1 | The per-material MR maximum (C3) is bypassed by splitting one requirement into several MRs. The open-MR warning only warns. | 16.5 | Apply the maximum cumulatively per material, per location, per day; or accept it is a weak control until Phase 4A. |
| R2 | "Approver may be a Project Manager" (C1) — there is no Project Manager role or approver permission. | 3, 16.5, 16.10 | Add an assignable "Approver" permission to a user, rather than a fourth role. |
| R3 | Site Loss cannot be added to the store closing-stock formula without double-counting: the quantity already left the store at issue. | 20.1 | Applied as a separate issue-accountability line, not in store closing stock. Confirm. |
| R4 | "Wrong Material" disputes: the wrong item is physically at site. "Resolved – Reissued" without recovering it loses that item from the record. | 16.7 | Require a linked Return Request for the wrong item before a Wrong Material dispute can be Resolved – Reissued. |
| R5 | Returnable default No (C11): a tool created without the flag is issued as consumption and disappears from custody tracking. AI-created materials make this likely. | 6.2, 16.11 | Prompt for Returnable when a material in Tools and Equipment or Safety Equipment is created; do not default it silently either way. |
| R6 | The PWA (C5) is online-only. Acknowledgement happens in basements and upper floors; overdue-acknowledgement flags will become noise. | 16.13 | Queue acknowledgements and MRs offline in the PWA (service-worker background sync) with server-side idempotency. Cheaper than full offline support. |
| R7 | The nominated Site Supervisor who acknowledges receipt is not a role or user. | 3.3, 16.7 | Decide: supervisor gets a restricted login (acknowledge only), or the SE acknowledges on their behalf with a named receiver. |
| R8 | If the PWA works in Phase 2A, the Phase 4 native SE app may be unnecessary. | 29 | Decide on the native app after Phase 2A adoption data, not now. |
| R9 | Phase 2A has grown: PWA, Contractor Master, Retrospective MR, line-level status, escalation and exception reporting. | 29 | Re-estimate Phase 2A before committing dates. |

## 1. PRODUCT OVERVIEW

### 1.1 Introduction

KAVACH is an AI-powered construction material inventory management system designed for ongoing real-estate construction projects.

The application will help project teams manage construction materials across their project stores through a simple and user-friendly interface.

The system will provide:

- Material Master Management.
- AI-powered invoice and challan scanning.
- Automatic material identification.
- Intelligent Material Master matching.
- Automatic new material creation.
- Material In management.
- Material Out management.
- Material Return management.
- Material Requisition from site.
- Site Acknowledgement of issued material.
- Consumption Reconciliation against work done.
- Indent (advance material requirement).
- Tool Custody tracking.
- Real-time stock tracking.
- Physical stock verification.
- Inventory reports.
- Role-based access control.

The primary objective is to eliminate repetitive manual inventory entry and make inventory management accessible to store personnel without requiring ERP knowledge.

### 1.2 Product Vision

"Just scan the invoice. AI understands the materials. Confirm and update inventory."

The application should minimise manual data entry while maintaining accurate inventory records.

### 1.3 Core Product Philosophy

- Simple user experience.
- AI-assisted operations.
- Minimal manual entry.
- Accurate inventory calculations.
- Complete transaction traceability.
- Human verification for uncertain AI results.
- No unnecessary ERP complexity.

## 2. BUSINESS OBJECTIVES

1. Reduce manual material entry.
2. Automate invoice and challan processing.
3. Reduce duplicate Material Master records.
4. Maintain accurate stock availability.
5. Track material movement across construction locations.
6. Identify low-stock materials.
7. Maintain supplier-wise material records.
8. Provide management with project inventory visibility.
9. Support mobile-based store operations.
10. Reduce dependence on administrative personnel for routine inventory activities.
11. Link every material issue to a site requirement.
12. Track material consumption against work completed.
13. Enable advance material planning through indents.

### 2.1 Success Metrics

| Metric | Initial Target |
| --- | --- |
| Invoice processing success | At least 95% on supported test documents |
| Critical field extraction accuracy | At least 95% on validated test set |
| Material matching accuracy | At least 95% on validated test set |
| Duplicate invoice posting | Zero |
| Duplicate material creation | Less than 1% |
| Typical invoice processing time | Under 2 minutes, excluding exceptions |
| Inventory calculation accuracy | 100% according to posted ledger transactions |
| User training | Basic operations understandable after short training |

These are target acceptance metrics, not guaranteed AI performance. Actual accuracy must be measured using representative supplier documents.

Success metrics for the Site Engineer & Material Requisition module are defined in Section 16.4.

## 3. USER ROLES AND PERMISSIONS

Initially, KAVACH will support three roles.

### 3.1 Project Admin

Project Admin has complete administrative control over the project inventory.

#### Responsibilities

- Manage materials.
- Manage categories.
- Manage project locations.
- Create and manage Store Manager accounts.
- Monitor inventory.
- View all transactions.
- View all reports.
- Perform stock adjustments.
- Approve physical stock discrepancies.
- Reverse incorrect transactions.
- Monitor AI processing activities.
- Manage system settings.
- Approve over-limit Material Requests.
- Approve indents.
- Resolve disputes.
- Configure activities and consumption norms.
- Assign Site Engineers to locations.
- Review emergency issues.

All approval and review items arrive in one Approvals inbox (Section 16.13). Items needing action: over-limit MRs, disputes, Site Loss and tool write-off approvals, and indents. Urgent MRs and emergency issues are reviewed through the Weekly Exception Report, not as queue items. Indent and MR approval may be delegated to a Project Manager. **\[R2\]**

#### Permission Matrix

| Module | Project Admin |
| --- | --- |
| Dashboard | Full Access |
| Material Master | Full Access |
| Material In | View All |
| Material Out | View All |
| Material Return | View All |
| Current Stock | Full Access |
| Stock Verification | Review and Approve |
| Stock Adjustment | Full Access |
| Transactions | View All |
| Reports | Full Access |
| User Management | Full Access |
| Location Management | Full Access |
| Category Management | Full Access |
| Supplier Mapping | Manage |
| AI Processing Logs | View All |
| Audit Logs | Full Access |
| Settings | Full Access |
| Material Request | View All, Approve |
| Indent | Approve |
| Disputes | Resolve |
| Site Loss / Tool Write-off | Approve |
| Approvals Inbox | Full Access |
| Activities, Activity Types & Norms | Full Access |
| Contractor Management | Full Access; Approve Pending Contractors |
| Consumption Reports | Full Access |

### 3.2 Store Manager

Store Manager handles all regular inventory operations.

#### Responsibilities

- Scan supplier invoices.
- Upload printed invoices.
- Upload handwritten challans.
- Review AI-extracted details.
- Confirm material matches.
- Create new materials through Material In.
- Receive materials.
- Issue materials.
- Record material returns.
- View current stock.
- View transaction history.
- Submit physical stock discrepancies.
- View operational reports.
- Fulfil Material Requests.
- Record emergency issues with reason.
- Confirm return requests.
- Manage tool custody.

#### Permission Matrix

| Module | Store Manager |
| --- | --- |
| Dashboard | Operational View |
| Material Master | View; Create Through Material In |
| Material In | Create and View |
| Material Out | Create and View (against MR, or Emergency Issue with reason) |
| Material Return | Create and View |
| Current Stock | View |
| Stock Verification | Submit Discrepancy |
| Stock Adjustment | No Direct Access |
| Transactions | View |
| Reports | Operational Reports |
| User Management | No Access |
| Location Management | No Access |
| Category Management | No Direct Access |
| Supplier Mapping | Automatic Learning |
| AI Processing Logs | Own Processing Activity |
| Audit Logs | No Access |
| Settings | No Access |
| Material Request | View Queue, Issue, Reject |
| Return Request | Confirm |
| Indent | View |
| Returnable Tools | Tool Issue, Tool Return; request Write-off |
| Contractor Management | View; Quick-add as Pending |

### 3.3 Site Engineer

#### Role Definition

The Site Engineer is responsible for one or more assigned work locations (Tower, Floor, Work Area). The Site Engineer requests material, confirms receipt at site, reports work completed, and initiates returns.

The Site Engineer does not hold stock, receive supplier deliveries, or approve their own requests.

#### Responsibilities

- Raise Material Requests for assigned locations.
- Track request status.
- Acknowledge material received at site.
- Raise disputes for short or wrong issues.
- Raise return requests for unused material.
- Report work progress for tracked activities.
- Raise indents for upcoming requirements.
- Request and return returnable tools.
- View stock availability.

#### Location Assignment

- Each Site Engineer is assigned one or more locations by the Project Admin.
- A Site Engineer can raise requests only for assigned locations.
- A location can have multiple Site Engineers.
- A Site Engineer can nominate a Site Supervisor to acknowledge receipt on their behalf.

**Location hierarchy:** Tower → Floor → Work Area. Assignment at any level covers every location below it. A Site Engineer assigned to Tower A can request for every floor and work area in Tower A.

The nominated Site Supervisor is not yet a system user. **\[R7\]**

#### Permission Matrix

| Module | Site Engineer |
| --- | --- |
| Dashboard | Own Locations Only |
| Material Master | View |
| Current Stock | View Availability Status |
| Material Request | Create, View Own, Cancel Own |
| Material In | No Access |
| Material Out | View Issues Against Own Requests |
| Issue Acknowledgement | Acknowledge, Dispute |
| Return Request | Create, View Own |
| Work Progress | Create for Assigned Locations |
| Indent | Create, View Own |
| Returnable Tools | Request, View Own Custody |
| Stock Verification | No Access |
| Stock Adjustment | No Access |
| Transactions | View Own Location Transactions |
| Reports | Own Location Reports |
| User / Location / Category Management | No Access |
| Supplier Mapping | No Access |
| AI Processing Logs | No Access |
| Audit Logs | No Access |
| Settings | No Access |

**Stock visibility setting:** Project Admin can configure whether Site Engineers see exact quantities or only status (Available / Low / Out of Stock).

### 3.4 Important Permission Rule

Store Manager should be able to create a new Material Master record directly during AI-assisted Material In.

Project Admin approval should not be required for routine material creation.

However:

- New material records must be audited.
- Existing material specifications must not be changed silently.
- Material deactivation remains an administrative action.
- Stock corrections require Project Admin authorisation.

## 4. APPLICATION MODULES

The application will contain:

1. Dashboard.
2. Material Master.
3. Material In.
4. Material Out.
5. Material Return.
6. Current Stock.
7. Stock Verification.
8. Transaction History.
9. Supplier Management.
10. Reports.
11. User Management.
12. Location Management.
13. Category Management.
14. AI Processing History.
15. Settings.
16. Audit Logs.
17. Material Requests.
18. Indents.
19. Work Progress & Consumption (including Activity Types and Norms).
20. Notifications.
21. Issue Acknowledgement.
22. Return Requests.
23. Returnable Tools.
24. Contractor Management.

## 5. DASHBOARD

### 5.1 Project Admin Dashboard

Display the following statistics:

- Total Material Types.
- Total Available Stock.
- Low Stock Materials.
- Out of Stock Materials.
- Today's Material In.
- Today's Material Out.

#### Dashboard Sections

**A. Stock Overview**

Display material counts and availability.

**B. Recent Transactions**

Show:

- Transaction ID.
- Material.
- Transaction Type.
- Quantity.
- User.
- Date.

**C. Low Stock Alerts**

Where consumption history and a lead time exist, low-stock status is based on Days of Cover (Section 16.12). Otherwise, show materials below configured minimum stock.

**D. Material Movement**

Display Material In, Material Out, Returns and Adjustments over a selected period.

**E. AI Processing Overview**

Display:

- Total invoices processed.
- Successful extractions.
- Matched materials.
- New materials created.
- Items requiring review.
- Failed processing attempts.

**F. Pending Approvals**

Count of open items in the Approvals inbox: over-limit MRs, Site Loss and tool write-off approvals, and indents.

**G. Open Disputes**

Acknowledgement disputes awaiting resolution.

**H. Emergency Issues**

Emergency issues not regularised within 24 hours (escalated), and the weekly emergency-issue rate. A rate above 10% of issues in a week is flagged for review. Full detail is in the Weekly Exception Report.

**I. Consumption Variance Alerts**

Activities flagged for excess or under-consumption (Section 16.9).

### 5.2 Store Manager Dashboard

The Store Manager dashboard must prioritise daily activities.

Four large quick-action buttons:

1. Material In.
2. Material Out.
3. Return Material.
4. View Stock.

Additional sections:

- Pending Material Requests queue (sorted by Required By).
- Pending Return Requests.
- Today's Receipts.
- Today's Issues.
- Low Stock Alerts.
- Recent Transactions.
- Frequently Used Materials.

### 5.3 Site Engineer Dashboard

The Site Engineer dashboard shows own assigned locations only. Its layout is defined in Section 16.13 (Mobile Home).

## 6. MATERIAL MASTER MANAGEMENT

### 6.1 Purpose

Material Master is the central database of all construction materials used in the project.

Every posted inventory transaction must reference a valid Material Master record.

### 6.2 Material Master Fields

| Field | Description | Required |
| --- | --- | --- |
| Material ID | Unique generated identifier | Yes |
| Material Name | Standardised material name | Yes |
| Category | Material category | Yes |
| Subcategory | Optional classification | No |
| Brand | Manufacturer | No |
| Specification | Technical specification | No |
| Grade | Material grade | No |
| Size | Diameter, thickness, dimensions | No |
| Primary Unit | Bags, Kg, Tons, Nos, etc. | Yes |
| Pack Size | Example: 50 KG per bag | No |
| Minimum Stock | Low-stock threshold | Configurable |
| Lead Time (days) | Typical supplier lead time, used for Days of Cover | No |
| Returnable | Yes / No. Set per material; default No (Section 16.11) | Yes |
| Description | Additional details | No |
| Status | Active / Inactive | Yes |
| Created By | User or AI-assisted workflow | Yes |
| Created Date | Timestamp | Yes |

Lead Time can be overridden per supplier mapping (Section 9.2). Buffer Days is a global setting. If Lead Time is missing, low-stock alerts fall back to Minimum Stock. Returnable has no silent default: see **\[R5\]**.

### 6.3 Initial Material Categories

- Cement.
- Steel.
- Sand and Aggregate.
- Bricks and Blocks.
- Electrical.
- Plumbing.
- Tiles and Flooring.
- Paint and Finishing.
- Hardware.
- Safety Equipment.
- Tools and Equipment.
- Other Materials.

Project Admin can manage categories.

### 6.4 Material Creation Methods

#### Method A: Manual Creation

Project Admin opens Material Master and creates a material manually.

#### Method B: AI-Assisted Creation

1. Store Manager scans an invoice.
2. AI identifies an unfamiliar material.
3. AI prepares material details.
4. System checks for duplicates.
5. Store Manager reviews the proposed master record.
6. On confirmation, the system creates the Material Master and Material In transaction.

No separate Material Master navigation is required.

### 6.5 Duplicate Material Detection

The system must compare:

- Normalised name.
- Brand.
- Category.
- Grade.
- Size.
- Specification.
- Unit.
- Pack size.

Example:

Existing: OPC Cement 53 Grade – 50 KG.

Invoice: ULTRATECH OPC 53 50KG.

Suggested result: Existing Material – OPC Cement 53 Grade.

However, similar names with different specifications must remain separate.

Example:

- TMT Steel 12mm.
- TMT Steel 16mm.
- TMT Steel 20mm.

These must never be merged based only on name similarity.

## 7. AI-POWERED INVOICE PROCESSING

This is the primary differentiating feature of KAVACH.

### 7.1 Objective

Convert printed invoices, handwritten invoices and delivery challans into structured inventory transactions with minimal manual effort.

### 7.2 Supported Documents

Initial supported formats:

- JPG.
- JPEG.
- PNG.
- PDF.

Supported document types:

1. Printed supplier invoices.
2. Handwritten invoices.
3. Handwritten delivery challans.
4. Mixed printed and handwritten documents.
5. Multi-page invoices.
6. Photographed paper documents.

### 7.3 Complete AI Processing Workflow

#### STEP 1 – Upload / Scan

Store Manager opens Material In.

Options:

- Scan Invoice.
- Upload Image.
- Upload PDF.
- Quick Receive.

Mobile camera integration must be available.

The system should support multiple images for multi-page documents.

#### STEP 2 – Document Quality Check

Before AI extraction, check:

- Image blur.
- Low resolution.
- Poor lighting.
- Incorrect orientation.
- Cropped document.
- Missing pages.
- Excessive shadows.

If image quality is insufficient, display a clear warning and request a better image.

Do not reject a document solely because it is handwritten.

#### STEP 3 – OCR and Document Understanding

The document processing layer extracts text and layout.

The system must support:

- Printed text recognition.
- Handwriting recognition.
- Table recognition.
- Multi-page extraction.
- Mixed document layouts.
- Multiple languages where supported.

Recommended implementation:

- OpenAI vision/document understanding for interpretation and structured extraction.
- Dedicated OCR/document processing service as an optional fallback for difficult handwriting or document layouts.

The initial implementation should be validated against actual supplier documents before selecting additional OCR services.

#### STEP 4 – AI Data Extraction

AI extracts the following information.

**Invoice Header**

- Supplier Name.
- Supplier Address.
- Invoice Number.
- Invoice Date.
- Challan Number.
- GSTIN.
- Invoice Total.
- Tax Details, if available.

**Material Lines**

- Original Invoice Description.
- Suggested Material Name.
- Brand.
- Category.
- Specification.
- Grade.
- Size.
- Pack Size.
- Invoice Quantity.
- Unit.
- Unit Price.
- Line Total.
- HSN Code.

All extracted data must be returned in a predefined structured JSON schema.

AI must also identify uncertain or unreadable fields.

#### STEP 5 – Material Matching

The extracted invoice items are compared against Material Master.

Matching priority:

1. Previously confirmed supplier-specific mapping.
2. Exact material and specification match.
3. Normalised text matching.
4. Database search for similar records.
5. Semantic similarity matching.
6. AI-assisted candidate selection.

The system must compare technical specifications and unit compatibility.

#### STEP 6 – Three Matching Outcomes

**A. MATCHED**

An existing Material Master record has been identified.

Example: Invoice: ULTRATECH OPC 53 50KG. Existing Master: OPC Cement 53 Grade. Status: MATCHED.

**B. NEW MATERIAL**

No suitable existing record has been found.

AI prepares:

- Material Name.
- Category.
- Brand.
- Specification.
- Unit.
- Pack Size.

Status: NEW MATERIAL.

Store Manager can create it through the same Material In confirmation process.

**C. REVIEW REQUIRED**

AI cannot reliably identify the correct material.

Example: Invoice Description: GI FITTING HEAVY.

Possible matches:

- GI Fitting 1 Inch.
- GI Fitting 1.5 Inch.
- GI Fitting 2 Inch.

The user must choose or enter the correct specification.

AI must never silently assign a technically incompatible material.

## 8. AI CONFIDENCE AND VALIDATION ENGINE

### 8.1 Field-Level Confidence

Confidence must be tracked separately for individual fields.

Example:

| Field | Extracted Value | Confidence |
| --- | --- | --- |
| Supplier | ABC Traders | High |
| Invoice Number | INV-1045 | High |
| Material Name | OPC Cement | High |
| Quantity | 500 | Medium |
| Unit | Bags | High |
| Challan Number | 1045 | Low |

The user should only need to correct uncertain fields.

### 8.2 Initial Confidence Rules

These are initial configurable operating thresholds.

| Confidence | Action |
| --- | --- |
| 95–100% | Suggest high-confidence match |
| 70–94% | Require user confirmation |
| Below 70% | Require manual review |

Confidence alone must not determine whether a transaction is safe.

Hard business validations override AI confidence.

For example, a 99% match must still be rejected for automatic selection if the steel diameter conflicts with the Material Master.

### 8.3 AI Must Not Decide

AI must not independently:

- Verify actual physical quantities.
- Decide whether materials are interchangeable.
- Approve damaged material.
- Change technical specifications.
- Perform stock adjustments.
- Post inventory transactions.
- Override duplicate invoice protection.

## 9. SUPPLIER MAPPING AND AI LEARNING

### 9.1 Objective

Allow the system to improve its matching behaviour based on confirmed user decisions.

### 9.2 Supplier Material Mapping

Maintain a database containing:

- Supplier ID.
- Supplier Invoice Description.
- Normalised Description.
- Material ID.
- Lead Time Override (days, optional).
- Confirmation Status.
- Confirmed By.
- Confirmation Date.

Example:

| Supplier Description | Standard Material |
| --- | --- |
| ULTR OPC53 50KG | OPC Cement 53 Grade |
| TMT FE550 12MM | TMT Steel 12mm |
| CPVC SDR11 25MM | CPVC Pipe 25mm |

### 9.3 Learning Workflow

1. AI identifies a material.
2. System suggests a Material Master match.
3. Store Manager confirms the match.
4. Supplier mapping is saved.
5. Future invoices reuse the mapping.
6. If a mapping produces a specification conflict, the system requests review.

The system must not automatically retrain an AI model after each transaction.

Learning initially happens through saved mappings and verified records.

## 10. MATERIAL IN MODULE

### 10.1 Objective

Receive materials with minimal manual entry.

AI-powered invoice scanning is the primary receiving method.

### 10.2 Web Workflow

#### SCREEN 1 – MATERIAL IN

Display:

- Scan Invoice.
- Upload Invoice.
- Quick Receive.

Below:

- Recent Receipts.
- Pending Reviews.
- Processing Status.

#### SCREEN 2 – DOCUMENT PROCESSING

Display progress:

1. Uploading.
2. Checking Document Quality.
3. Reading Invoice.
4. Identifying Materials.
5. Matching Material Master.
6. Preparing Receipt.

Processing should happen asynchronously.

#### SCREEN 3 – REVIEW AND CONFIRM

Display invoice header information.

Example:

Supplier: ABC Traders.

Invoice Number: INV-1045.

Invoice Date: 09/11/2026.

Display the extracted material table.

| Invoice Description | KAVACH Material | Category | Invoice Qty | Received Qty | Status |
| --- | --- | --- | --- | --- | --- |
| OPC 53 Grade 50KG | OPC Cement 53 Grade | Cement | 500 Bags | 500 Bags | Matched |
| TMT FE550 12MM | TMT Steel 12mm | Steel | 2.5 Tons | 2.5 Tons | Matched |
| CPVC Pipe 25MM | CPVC Pipe 25mm | Plumbing | 100 Nos | 100 Nos | New |
| GI Fitting | GI Fitting | Plumbing | 25 Nos | 25 Nos | Review |

The user can edit:

- Material mapping.
- Material name for new records.
- Category.
- Specification.
- Unit, where appropriate.
- Actual received quantity.
- Indent reference, optional, per line (Section 16.10).
- Notes.

New materials should be clearly marked.

The user should be able to view the original invoice alongside the extracted information.

#### SCREEN 4 – ACTUAL RECEIVED QUANTITY

Invoice Quantity and Actual Received Quantity must be separate fields.

Example:

Invoice Quantity: 500 Bags.

Actual Received Quantity: 490 Bags.

Difference: 10 Bags.

Possible reasons:

- Short Supply.
- Damaged.
- Rejected.
- Other.

The system must capture the reason when there is a discrepancy.

Only accepted usable quantity increases available stock.

#### SCREEN 5 – CONFIRM & RECEIVE

Before confirmation, display:

- Supplier.
- Invoice Number.
- Total Material Lines.
- New Materials.
- Items Requiring Review.
- Accepted Quantities.
- Damaged / Rejected Quantities.

Primary button:

CONFIRM & RECEIVE

After confirmation:

1. Validate all materials.
2. Check duplicate invoices.
3. Create approved new Material Master records.
4. Create Material In transactions.
5. Update stock balances.
6. Save supplier mappings.
7. Store invoice document reference.
8. Record user and timestamp.
9. Generate receipt reference.

These operations must be committed atomically.

If any critical posting operation fails, no partial stock update should remain.

#### SCREEN 6 – SUCCESS

Display:

MATERIAL RECEIVED SUCCESSFULLY.

- Supplier.
- Invoice Number.
- Receipt Reference.
- Number of Materials.
- Received Quantities.

Actions:

- View Receipt.
- Download Receipt.
- Receive Another.

### 10.3 Quick Receive

For material received without an invoice:

Fields:

- Material.
- Quantity.
- Unit.
- Supplier (optional).
- Reference Number (optional).
- Indent Number (optional).
- Notes (optional).

Action: RECEIVE MATERIAL.

Indent reference fields on Material In and Quick Receive are delivered in Phase 4A, with Indents.

## 11. HANDWRITTEN INVOICE PROCESSING

### 11.1 Objective

Support handwritten documents without requiring a separate manual workflow.

### 11.2 Workflow

1. User scans or uploads document.
2. System checks image quality.
3. OCR/AI identifies printed and handwritten text.
4. AI extracts material details.
5. Matching engine compares extracted items with Material Master.
6. Confidence is assigned field by field.
7. Uncertain fields are highlighted.
8. Store Manager corrects only uncertain information.
9. Confirm & Receive.

### 11.3 Handwriting Limitations

Potential issues:

- Unclear handwriting.
- Similar-looking digits.
- Unusual abbreviations.
- Regional language variations.
- Overwritten quantities.
- Poor-quality photographs.

### 11.4 Recommended Interface

For uncertain fields, show:

- Original document crop.
- Extracted value.
- Confidence indicator.
- Editable value.

Example:

Original handwritten value: unclear.

AI suggested quantity: 500.

Status: REVIEW REQUIRED.

The user corrects the value and continues.

The system should support English and other required regional languages based on actual supplier document testing.

### 11.5 Partial Extraction

If an invoice contains 10 material lines and only 2 are unclear:

- Preserve all successfully extracted lines.
- Highlight only the 2 uncertain lines.
- Allow manual correction.
- Do not reject the entire invoice.

If an item cannot be understood, allow manual entry for that item.

## 12. UNIT CONVERSION ENGINE

### 12.1 Objective

Ensure that quantities are stored and calculated consistently.

AI extracts the original invoice quantity and unit.

Backend conversion rules handle valid conversions.

### 12.2 Unit Master

Initial units:

- Bags.
- Kg.
- Grams.
- Tons / MT.
- Nos.
- Pieces.
- Meters.
- Feet.
- Running Feet.
- Litres.
- Rolls.
- Boxes.
- Bundles.
- Cubic Feet.
- Cubic Meters.

Project Admin can configure supported units.

### 12.3 Unit Conversion Rules

Example:

Invoice: 500 Bags × 50 KG.

System stores:

- Transaction Quantity: 500 Bags.
- Pack Size: 50 KG.
- Equivalent Quantity: 25,000 KG.

The material's stock unit remains Bags if Bags is its configured inventory unit.

For steel:

Invoice: 2.5 MT.

Equivalent weight: 2,500 KG.

If the stock unit is Tons, the stock balance remains 2.5 Tons, with the equivalent weight stored for reporting if required.

### 12.4 Conversion Validation

- Only approved conversions are allowed.
- Material-specific pack sizes must be maintained.
- Incompatible units must trigger review.
- Variable-weight materials must not use assumed conversions.
- AI must never invent missing pack sizes.

## 13. DUPLICATE INVOICE PROTECTION

### 13.1 Objective

Prevent the same invoice from increasing stock more than once.

### 13.2 Duplicate Detection

Check:

- Project ID.
- Supplier ID.
- Invoice Number.
- Invoice Date.
- Document Fingerprint.

### 13.3 Duplicate Warning

Example:

POSSIBLE DUPLICATE INVOICE.

Invoice: INV-1045.

Supplier: ABC Traders.

Previously Processed: 10 November 2026.

The user should not be able to receive the same invoice again without authorised resolution.

The system must also support backend idempotency to prevent duplicate posting caused by retries, repeated clicks or network failures.

## 14. MATERIAL OUT MODULE

### 14.1 Objective

Record materials issued from the store to construction locations.

### 14.2 Workflow

1. Select an MR from the Store Request Queue (Section 16.6), **or** select Emergency Issue and enter reason, location, activity and contractor.
2. Select Material (pre-filled from the MR line where an MR is selected).
3. Display Available Stock.
4. Enter Issue Quantity.
5. Select Destination (pre-filled from the MR where an MR is selected).
6. Select Contractor from the Contractor Master (pre-filled from the MR where an MR is selected).
7. Add Notes (optional).
8. Confirm Issue.

### 14.3 Destination Locations

Examples:

- Tower A.
- Tower B.
- Tower C.
- Basement.
- Club House.
- External Works.
- Site Office.

Project Admin manages locations.

### 14.4 Validation

- Quantity must be greater than zero.
- Issue quantity cannot exceed available stock.
- Material must be active.
- Destination must be valid.
- Unit must be compatible with Material Master.
- Must reference an MR or be flagged as Emergency Issue.
- Contractor must be selected from the Contractor Master; free text is not allowed.
- Materials marked Returnable are issued as Tool Issue, not Material Out (Section 16.11).

### 14.5 Stock Calculation

Available Stock = Previous Stock - Issued Quantity.

### 14.6 Issue Against MR, Partial Issue and Emergency Issue

Defined in Section 16.6.

## 15. MATERIAL RETURN MODULE

### 15.1 Objective

Record unused materials physically returned from construction locations.

### 15.2 Workflow

1. Select Material.
2. Enter Return Quantity.
3. Select Returned From.
4. Select Contractor / Person, if applicable.
5. Select Material Condition.
6. Confirm Return.

### 15.3 Material Condition

- Good / Reusable.
- Damaged.
- Scrap.

Only reusable materials should automatically increase available stock.

Damaged and scrap materials should be recorded separately and excluded from available stock until an authorised disposition.

### 15.4 Link to Site Return Request

A Material Return may be linked to a Site Engineer Return Request (Section 16.8). Store-initiated returns without a Return Request remain allowed.

## 16. SITE ENGINEER AND MATERIAL REQUISITION

### 16.1 Purpose

In v2.0, Material Out was recorded by the Store Manager with no record of who asked for the material, why, or whether it reached the site. Material left the store and the trail stopped.

This module adds the Site Engineer (Section 3.3) as the person who requests, receives, and accounts for material at the work location. It connects:

**Requirement → Request → Issue → Site Acknowledgement → Consumption → Return**

### 16.2 Objectives

1. Every material issue is linked to a documented site requirement.
2. Material custody is confirmed at the site, not assumed.
3. Material consumption is compared against work completed.
4. Unused material returns are initiated by the site and verified by the store.
5. Future material needs are raised in advance as indents.
6. The store has a visible queue of pending requests instead of phone calls.

### 16.3 Problems Solved

| Problem | Current State | With This Module |
| --- | --- | --- |
| Who asked for material | Not recorded | Material Request (MR) linked to every issue |
| Did material reach site | Unknown | Site acknowledgement |
| Was material used properly | Unknown | Consumption vs work-done reconciliation |
| Material shortage planning | Reactive, verbal | Indent with required-by date |
| Store workload visibility | Phone calls, verbal requests | Request queue |
| Returns | Store-only record | Site-initiated, store-verified |

### 16.4 Success Metrics

| Metric | Initial Target |
| --- | --- |
| Material Out linked to an MR | At least 90% |
| Emergency issues without MR | Below 10% of total issues |
| Issues acknowledged within 24 hours | At least 90% |
| Time to raise an MR on mobile | Under 30 seconds for repeat requests |
| Unresolved disputes older than 7 days | Zero |
| Key materials with consumption variance tracking | Cement, steel, sand, aggregate, blocks, tiles |

If emergency issues exceed 10%, the request process is being bypassed and must be investigated, not ignored.

### 16.5 Material Request (MR)

#### Workflow

```
Site Engineer creates Material Request
        ↓
System validates location, materials, quantities
        ↓
System checks stock availability and limits
  Phase 2A: per-material maximum quantity per MR
  Phase 4A: activity budget (planned quantity × norm)
        ↓
Within limits → Store Manager request queue
Over limits  → Approvals inbox → Store Manager request queue
Urgent       → Store Manager request queue; listed in Weekly Exception Report
        ↓
Store Manager issues per line (Full / Partial / Reject with reason)
        ↓
Material Out transaction posted and linked to MR line
        ↓
Site Engineer or nominated Supervisor acknowledges receipt per issue
        ↓
Header status derived from line statuses
```

#### MR Fields

| Field | Description | Required |
| --- | --- | --- |
| MR Number | System generated | Yes |
| MR Type | Standard / Retrospective (Retrospective only from an emergency issue) | Yes |
| Project / Store | Auto from user context | Yes |
| Location | Tower / Floor / Work Area | Yes |
| Activity | Work activity (e.g., Slab Casting 7F) | Yes |
| Contractor | Selected from Contractor Master | Yes |
| Material | From Material Master | Yes |
| Requested Quantity | Quantity in material's stock unit | Yes |
| Required By | Date and time slot | Yes |
| Priority | Normal / Urgent | Yes |
| Notes | Additional information | No |
| Requested By | Logged-in user | Yes |
| Requested Date | Timestamp | Yes |

An MR can contain multiple material lines.

#### MR Statuses

Status is tracked per MR line. The header status is derived from its lines.

**Line Statuses**

| Status | Meaning |
| --- | --- |
| Open | Submitted or approved; awaiting issue |
| Partially Issued | Some quantity issued; balance open |
| Issued | Full quantity issued; awaiting acknowledgement |
| Acknowledged | All issued quantity confirmed at site |
| Disputed | Site reported short, wrong, damaged or not received |
| Resolved | Dispute closed (see exits below) |
| Rejected | Rejected by approver or store, with reason |
| Cancelled | Cancelled by Site Engineer before issue |
| Expired | Unissued balance expired after configured period |

A line awaiting approval is shown as Pending Approval in the Approvals inbox. Draft applies to the whole MR before submission.

**Dispute Exits**

| Exit | Meaning |
| --- | --- |
| Resolved – Accepted | Issue confirmed correct as posted |
| Resolved – Loss Recorded | Admin-approved Site Loss recorded against the issue (Section 16.7) |
| Resolved – Reissued | Shortfall reissued through a new Material Out on the same line |

**Header Status (Derived)**

| Header Status | Rule |
| --- | --- |
| Open | No line issued yet |
| In Progress | At least one line partially issued, issued, or disputed |
| Completed | Every line is Acknowledged, Resolved, Rejected, Cancelled or Expired |
| Closed | Completed and locked; no further action allowed |

#### Approval Rules

Approval must be exception-based. Routine requests must not wait for approval.

| Condition | Phase | Action |
| --- | --- | --- |
| Within per-material MR maximum (or none set) and stock available | 2A | Direct to store queue |
| Exceeds per-material maximum quantity per MR set by Admin | 2A | Approval required (Approvals inbox) |
| Exceeds activity budget (planned quantity × norm) | 4A | Approval required (Approvals inbox) |
| Activity has no budget configured | 4A | Per-material maximum applies |
| Urgent priority | 2A | Direct to store queue; listed in Weekly Exception Report |

Value-threshold approval is removed from MVP. If reintroduced, valuation uses the last confirmed purchase rate, labelled "indicative value, not accounting". The approver may be the Project Admin or a delegated Project Manager. **\[R1\] \[R2\]**

#### Validation

- Quantity must be greater than zero.
- Material must be active.
- Location must be within the requesting Site Engineer's assignment (Section 3.3).
- Unit must match the material's stock unit.
- Contractor must be selected from the Contractor Master.
- Required By cannot be in the past, except for a Retrospective MR.
- Quantity above the per-material MR maximum routes the line to approval.
- System must warn if an open MR exists for the same material and location.

#### Repeat Request

- Site Engineer can copy a previous MR.
- Recent and frequently requested materials appear first.
- Assigned location is pre-filled.

### 16.6 Store Fulfilment

#### Store Request Queue

Store Manager sees pending MRs sorted by Required By and Priority.

Display:

- MR Number.
- Location.
- Activity.
- Contractor.
- Requested By.
- Materials and Quantities.
- Required By.
- Priority.
- Stock Availability per line.

#### Issue Against MR

1. Store Manager opens MR.
2. System shows requested quantity and available stock.
3. Store Manager enters issue quantity per line.
4. Store Manager confirms issue.
5. Material Out transaction is posted with MR reference.
6. Site Engineer is notified.

#### Partial Issue

- Store Manager can issue less than requested.
- Each issue creates a separate Material Out linked to the same MR.
- Unissued balance remains open until issued, cancelled, or expired.
- Default expiry: 3 days (configurable).

#### Rejection Reasons

- Insufficient Stock.
- Wrong Material Requested.
- Duplicate Request.
- Not Approved.
- Other (reason mandatory).

If rejected for insufficient stock, the system must offer to raise an indent.

#### Emergency Issue (Without MR)

For urgent situations where an MR cannot be raised in time:

- Store Manager can issue material without an MR.
- Location, activity, contractor, and reason are mandatory.
- Transaction is flagged as **Emergency Issue**.
- Site Engineer of that location is notified.
- The emergency issue must be regularised within 24 hours by a Retrospective MR.
- Unregularised after 24 hours: escalated to Project Admin and listed in the Weekly Exception Report.
- If emergency issues exceed 10% of issues in a week, the week is flagged for Admin review.

#### Retrospective MR

- Created only from an existing emergency issue; cannot be raised on its own.
- Raised by the Site Engineer of that location.
- Location, activity, contractor, material and quantity are pre-filled from the emergency issue.
- Required By may be in the past.
- Activity is mandatory.
- On submission, the emergency issue is linked and its regularisation flag clears.
- A Retrospective MR does not post a new Material Out.

### 16.7 Issue Acknowledgement

#### Purpose

Confirm that issued material reached the site in the issued quantity.

#### Workflow

```
Material Out posted against MR
        ↓
Site Engineer / Supervisor notified
        ↓
Acknowledge:
   Received in full → Acknowledged
   Short / Wrong    → Disputed (enter actual quantity and reason)
        ↓
Disputes visible to Project Admin
```

#### Acknowledgement Fields

- Issued Quantity (read-only).
- Received Quantity.
- Received By (name).
- Acknowledgement Timestamp.
- Photo (optional).
- Remarks.

#### Dispute Reasons

- Short Quantity.
- Wrong Material.
- Damaged.
- Not Received.
- Other.

#### Dispute Resolution

- Project Admin (or delegated approver) reviews the dispute in the Approvals inbox.
- **Store posting error** (material never left the store): correct through reversal of the Material Out. This is the only case where reversal is used.
- **Short / Not Received / Damaged at site:** store stock is not changed, because the material already left the store. The approver records an Admin-approved **Site Loss** entry against the issue for the missing or damaged quantity. Exit: Resolved – Loss Recorded.
- **Shortfall to be made good:** a new Material Out on the same MR line. Exit: Resolved – Reissued.
- **Issue found correct:** Exit: Resolved – Accepted.
- Consumption reconciliation uses acknowledged quantity, not issued quantity (Section 16.9).

Wrong Material disputes leave an unrecorded item at site if reissued without a return. **\[R4\]**

#### Pending Acknowledgement

- Issues not acknowledged within the configured period (default 24 hours) are flagged.
- Flagged issues appear on Site Engineer and Project Admin dashboards.
- Unacknowledged issues must not auto-close.

### 16.8 Return Request

#### Workflow

```
Site Engineer raises Return Request
        ↓
Material physically returned to store
        ↓
Store Manager inspects and records condition
        ↓
Material Return posted (linked to Return Request)
        ↓
Good / Reusable → increases available stock
Damaged / Scrap → recorded separately
```

#### Return Request Fields

- Return Request Number (system generated).
- Material.
- Quantity.
- Returned From (Location).
- Related MR (optional).
- Contractor.
- Reason: Excess / Work Changed / Wrong Material / Other.
- Notes.

#### Rules

- Site Engineer initiates; Store Manager confirms quantity and condition.
- Store Manager may record a different quantity than requested, with reason.
- Return Request remains Pending until confirmed by store.
- Pending returns older than the configured period are flagged.

### 16.9 Work Progress and Consumption Reconciliation

#### Purpose

Compare material issued for an activity against material that should have been consumed for the work completed. This is the primary control for wastage and pilferage.

#### Scope for Initial Release

Track only high-value materials:

- Cement.
- Steel.
- Sand.
- Aggregate.
- Blocks / Bricks.
- Tiles.

#### Activity Master

Project Admin configures activities:

| Field | Example |
| --- | --- |
| Activity Name | Slab Casting |
| Activity Type | M25 Concrete (from Activity Type master) |
| Location | Tower A – 7th Floor |
| Work Unit | Cubic Meter |
| Planned Quantity | 120 m³ |
| Linked Materials | Cement, Sand, Aggregate, Steel |
| Material Budget (derived, Phase 4A) | Planned Quantity × Norm, per linked material |

#### Activity Type Master

Project Admin maintains Activity Types (e.g., M25 Concrete, 200mm Blockwork, Vitrified Flooring 600×600). Each activity references one Activity Type. Consumption norms are keyed on Activity Type + Material, so one norm applies to every activity of that type.

The derived Material Budget drives MR approval routing from Phase 4A (Section 16.5).

#### Consumption Norms

Project Admin configures standard consumption per work unit.

| Activity Type | Material | Norm per Work Unit | Allowed Variance |
| --- | --- | --- | --- |
| M25 Concrete | Cement | Configured per mix design | ±5% |
| Blockwork | Blocks | Configured per block size | ±5% |
| Flooring | Tiles | Configured per tile size | ±8% |

Norm values must be entered from the project's own mix designs and specifications. The system must not assume default norms.

#### Work Progress Entry

Site Engineer records:

- Activity.
- Work Completed Quantity.
- Date.
- Status: In Progress / Completed.
- Photo (optional).

#### Reconciliation

```
Theoretical Consumption = Work Completed × Norm (Activity Type + Material)
Actual Received (Net)   = Acknowledged Quantity − Reusable Returns
Variance                = Actual Received (Net) − Theoretical Consumption
Variance %              = Variance ÷ Theoretical Consumption × 100
```

Reconciliation uses acknowledged quantity, not issued quantity. Site Loss quantities are reported separately and are not counted as consumption. Tool transactions are excluded.

| Result | Action |
| --- | --- |
| Within allowed variance | No action |
| Above allowed variance | Flag to Project Admin as Excess Consumption |
| Below allowed variance | Flag as Possible Unreported Return or Data Error |

#### Rules

- Reconciliation runs when an activity is marked Completed, and optionally weekly for in-progress activities.
- Flags are informational; the system does not adjust stock.
- Reconciliation is only available for activities with norms configured.

### 16.10 Indent (Advance Material Requirement)

#### Purpose

Allow Site Engineers to raise future material requirements so procurement can be planned before stock runs out.

An Indent is different from a Material Request:

|  | Material Request | Indent |
| --- | --- | --- |
| Purpose | Issue from existing stock | Procure new material |
| Timeframe | Today / next few days | Upcoming weeks |
| Fulfilled By | Store Manager | Purchase (outside system in MVP) |

#### Workflow

```
Site Engineer raises Indent
        ↓
Project Admin reviews → Approve / Modify / Reject
        ↓
Approved Indent marked "Sent to Purchase"
        ↓
Purchase handled outside KAVACH (MVP)
        ↓
Material In can reference Indent Number
        ↓
Indent status updates: Partially Received / Fully Received
```

Indent approval applies to every indent, not only exceptions, because an approved indent authorises purchase spending outside the system. The approver may be the Project Admin or a delegated Project Manager. **\[R2\]**

#### Indent Fields

- Indent Number (system generated).
- Location and Activity.
- Material.
- Quantity.
- Required By Date.
- Current Stock (auto-displayed).
- Justification.
- Raised By.

#### Indent Statuses

Draft → Submitted → Approved / Modified / Rejected → Sent to Purchase → Partially Received → Fully Received → Closed

#### System-Suggested Indents

The system may suggest an indent when projected stock is insufficient:

```
Days of Cover = Available Stock ÷ Average Daily Consumption (last 14 days)
Suggest indent when Days of Cover < Supplier Lead Time + Buffer Days
```

Suggestions require human action. The system must not raise indents automatically.

- Supplier Lead Time = supplier mapping override where set, otherwise Material Master Lead Time.
- Buffer Days = global setting.
- If no Lead Time exists, no indent is suggested; Minimum Stock alerts apply.
- Average Daily Consumption uses Material Out only; Tool Issue transactions are excluded.
- This is rule-based calculation only. ML-based forecasting is a Future Enhancement (Section 32, item 8).

#### Scope Note

Purchase Order management remains out of scope for MVP (Section 28). The Indent is the requirement record only. Linking Material In to Indent provides basic visibility of whether requested material arrived.

### 16.11 Returnable Tools and Equipment

#### Purpose

Track custody of tools and equipment that are issued and expected back.

#### Material Master Change

Add field **Returnable: Yes / No** to Material Master (Section 6.2). It is set per material and defaults to No. There is no category default. **\[R5\]**

#### Workflow

1. Site Engineer requests tool through MR.
2. Store Manager posts a **Tool Issue** to a named person with expected return date.
3. Tool appears in the person's custody list.
4. On return, Store Manager posts a **Tool Return** with condition.
5. Overdue tools are flagged.
6. A lost tool is closed by a **Tool Write-off**, approved in the Approvals inbox.

#### Rules

- Tool Issue, Tool Return and Tool Write-off are separate transaction types (Section 19.1).
- They are excluded from consumption, Material Out reports, average daily consumption, and reconciliation.
- Available stock reduces on Tool Issue and increases on Tool Return in Good condition.
- In Custody is shown as its own line in stock and movement reports (Section 20.1).
- Lost items require approval of a Tool Write-off.

### 16.12 Notifications and Alerts

#### Channels

| Channel | Use |
| --- | --- |
| In-app / Push | All operational notifications |
| WhatsApp | Urgent and daily summary alerts (if configured) |
| Email | Daily / weekly summaries for Project Admin |

Email must not be the only channel for site-level users.

#### Notification Events

| Event | Recipient |
| --- | --- |
| MR submitted | Store Manager |
| MR line needs approval | Approver (Approvals inbox) |
| MR approved / rejected | Site Engineer |
| Material issued | Site Engineer / Supervisor |
| Acknowledgement overdue | Site Engineer, Project Admin |
| Dispute raised | Approver, Store Manager |
| Site Loss / tool write-off awaiting approval | Approver |
| Emergency issue made | Site Engineer, Project Admin |
| Emergency issue unregularised after 24 hours | Project Admin (escalation) |
| Return request raised | Store Manager |
| Indent submitted | Approver |
| Excess consumption flagged | Project Admin |
| Tool return overdue | Site Engineer, Store Manager |
| Low stock / low days of cover | Store Manager, Project Admin |
| Pending contractor added | Project Admin |
| Weekly Exception Report | Project Admin (email / in-app) |

#### Alert Rules

- Low-stock alerts must be based on Days of Cover where consumption history exists, and Minimum Stock otherwise.
- Repeated alerts for the same material must be grouped into a daily summary.
- Users can mute non-critical notifications; critical alerts cannot be muted.

### 16.13 Site Engineer Application Screens

#### Mobile Home

Four large actions:

1. Request Material.
2. Return Material.
3. Report Work Done.
4. Raise Indent.

Below:

- Pending Acknowledgements.
- My Open Requests.
- Tools in My Custody.
- Alerts for My Locations.

#### Request Material Screen

- Location pre-filled.
- Activity selection.
- Contractor selection.
- Recent / Frequent materials first.
- Stock availability indicator per material.
- Quantity entry with unit shown.
- Required By and Priority.
- Copy Previous Request.
- Submit.

Target: repeat request in under 30 seconds.

#### My Requests Screen

- Filters: Open / Issued / Closed / Rejected.
- Status chips.
- Tap to view issue history.

#### Acknowledge Screen

- MR Number and material.
- Issued quantity.
- Received quantity (editable).
- Confirm or Dispute.

#### Work Progress Screen

- Activity list for assigned locations.
- Enter completed quantity.
- Mark completed.
- Optional photo.

#### Web Views

- Store Manager: Request Queue (own navigation item).
- Project Admin: one Approvals inbox (over-limit MRs, disputes, Site Loss and tool write-off approvals, indents, pending contractors); Weekly Exception Report (urgent MRs, emergency issues and regularisation status); Consumption Variance view.

#### Mobile UX Requirements

- Minimal typing.
- Large touch controls.
- Works on slow networks.
- Draft saving if submission fails.
- Safe retry with idempotency.

**Delivery:** In Phase 2A these screens are built as a responsive mobile web app (PWA) that installs to the phone home screen. A native Site Engineer app may follow in Phase 4. **\[R6\] \[R8\]**

### 16.14 Database Entities, Business Rules, Phasing and Acceptance

- Database entities and relationships for this module: Section 24.4.
- Business rules for this module: Section 27, rules 21–39.
- Phasing: Section 29 (Phases 2A and 4A).
- Acceptance criteria: Section 30.3.
- Open questions and risks: Section 31.

## 17. CURRENT STOCK MODULE

### 17.1 Stock Listing

Display:

- Material ID.
- Material Name.
- Category.
- Specification.
- Unit.
- Available Quantity.
- Minimum Stock.
- Stock Status.

### 17.2 Stock Status

- Available.
- Low Stock.
- Out of Stock.
- Inactive.

### 17.3 Search and Filters

- Material Name.
- Material Category.
- Stock Status.
- Store Location.
- Supplier.
- Date Range, where relevant.

### 17.4 Material Details

Display:

- Material Information.
- Current Stock.
- Total Received.
- Total Issued.
- Total Reusable Returns.
- Total Adjustments.
- Recent Transactions.
- Supplier History.
- Stock Movement History.

## 18. STOCK VERIFICATION

### 18.1 Objective

Compare physical stock with the system stock.

### 18.2 Workflow

1. Select Material.
2. Display System Stock.
3. Enter Physical Quantity.
4. Calculate Difference.
5. Enter Reason.
6. Submit for Project Admin Approval.

Example:

System Stock: 500 Bags.

Physical Stock: 490 Bags.

Difference: -10 Bags.

### 18.3 Permissions

Store Manager:

- View stock.
- Enter physical count.
- Submit discrepancy.

Project Admin:

- Review discrepancy.
- Approve or reject.
- Create stock adjustment.

All approved adjustments must generate ledger entries.

## 19. TRANSACTION HISTORY AND AUDIT

### 19.1 Transaction Types

- Material In.
- Material Out.
- Material Return.
- Stock Adjustment.
- Transaction Reversal (store posting errors only).
- Site Loss (Admin-approved; recorded against a Material Out; does not change store stock).
- Tool Issue.
- Tool Return.
- Tool Write-off (Admin-approved; closes custody; does not change store stock).

Reference fields added in v2.1:

- Material Out: MR Number; Emergency Issue flag.
- Material In: Indent reference (optional).

### 19.2 Transaction Fields

- Transaction ID.
- Project ID.
- Store ID.
- Material ID.
- Material Name.
- Transaction Type.
- Quantity.
- Unit.
- Reference Number.
- Supplier / Destination.
- User.
- Date and Time.
- Status.
- Notes.

### 19.3 Audit Requirements

- Posted transactions cannot be deleted.
- Corrections must use reversal transactions.
- Reversals must reference original transactions.
- Every stock change must be traceable.
- New materials created through AI must retain their creation source.
- AI extraction results and user corrections must be auditable.
- Every approval must capture the approving user and timestamp.

## 20. REPORTS

Initial reports:

1. Current Stock Report.
2. Material In Report.
3. Material Out Report (excludes tool transactions).
4. Material Return Report.
5. Material Movement Report.
6. Supplier-wise Report.
7. Low Stock Report.
8. Physical Stock Discrepancy Report.
9. AI Processing Report.
10. New Material Creation Report.
11. Material Request Report.
12. Pending Acknowledgement Report.
13. Dispute Report (including Site Loss).
14. Emergency Issue Report.
15. Consumption Variance Report.
16. Indent Status Report.
17. Tool Custody Report.
18. Weekly Exception Report (urgent MRs, emergency issues, unregularised emergency issues, weekly emergency-issue rate).

All reports should support date filters and Excel/PDF export.

### 20.1 Material Movement Formula

**Store stock:**

Opening Stock + Material In + Reusable Returns + Tool Returns (Good) - Material Out - Tool Issues + Adjustments = Closing Stock.

**Issue accountability (separate line):**

Material Out = Acknowledged at Site + Site Loss + Pending Acknowledgement / Open Disputes.

Site Loss is shown on its own line. It is not deducted again from store stock, because the quantity already left the store when issued. **\[R3\]**

**Tools in custody (separate line):**

In Custody = Tool Issues - Tool Returns - Tool Write-offs.

Damaged and scrap materials must be tracked separately and must not be counted as available stock.

## 21. WEB APPLICATION DESIGN

### 21.1 General Layout

- Left-side navigation.
- Top navigation.
- Project selector.
- Notification area.
- User profile.
- Main workspace.

### 21.2 Project Admin Navigation

1. Dashboard.
2. Approvals.
3. Material Master.
4. Stock.
5. Transactions.
6. Reports.
7. User Management.
8. Locations.
9. Suppliers.
10. Contractors.
11. Activities & Norms.
12. AI Processing.
13. Settings.

### 21.3 Store Manager Navigation

1. Dashboard.
2. Request Queue.
3. Material In.
4. Material Out.
5. Return Material (including Pending Return Requests).
6. Tool Custody.
7. Current Stock.
8. Transactions.
9. Reports.

### 21.4 Site Engineer Navigation

1. Dashboard.
2. My Requests.
3. Returns.
4. Work Progress.
5. Indents.
6. Stock.
7. Reports.

### 21.5 Material In Interface

The screen should contain:

**A. Invoice Upload Area**

- Drag and Drop.
- Browse Files.
- Scan Invoice.
- Supported formats information.

**B. AI Processing Status**

- Uploading.
- Document Checking.
- Reading.
- Material Identification.
- Matching.

**C. Invoice Information**

- Supplier.
- Invoice Number.
- Invoice Date.
- Challan Number.

**D. Material Review Table**

- Invoice Description.
- Standard Material.
- Category.
- Specification.
- Invoice Quantity.
- Received Quantity.
- Unit.
- Match Status.
- Confidence.
- Actions.

**E. Original Document Preview**

Show the original invoice alongside the extracted data.

**F. Final Confirmation**

CONFIRM & RECEIVE.

The user should be able to edit information inline without navigating away.

## 22. MOBILE APPLICATION

### 22.1 Store Manager Home

Four large actions:

- Material In.
- Material Out.
- Return.
- View Stock.

Below:

- Pending Material Requests.
- Today's Activity.
- Low Stock.
- Recent Transactions.

### 22.2 Mobile Material In

1. Tap Material In.
2. Scan Invoice.
3. Capture multiple pages if necessary.
4. AI checks document quality.
5. AI processes invoice.
6. Material Master matching occurs.
7. Display extracted items.
8. Highlight uncertain fields.
9. Review actual received quantity.
10. Confirm & Receive.

### 22.3 Mobile Material Out

1. Open Request Queue and select an MR, or select Emergency Issue and enter reason.
2. Search / Scan Material (pre-filled from MR).
3. View Available Stock.
4. Enter Quantity.
5. Select Destination (pre-filled from MR).
6. Confirm Issue.

### 22.4 Mobile Stock

- Search.
- Material List.
- Available Quantity.
- Stock Status.
- Material Details.

### 22.5 Mobile UX

- Large touch-friendly controls.
- Minimal typing.
- Camera support.
- Simple navigation.
- Responsive layout.
- Clear success/error messages.
- Slow network support.
- Safe retry mechanisms.

### 22.6 Site Engineer Mobile Application

The Site Engineer screens are specified in Section 16.13. Phase 2A delivers them as a responsive mobile web app (PWA). A native app may follow in Phase 4, subject to Phase 2A adoption. **\[R6\] \[R8\]**

## 23. TECHNICAL ARCHITECTURE

### 23.1 Recommended Architecture

The system should separate AI processing from inventory operations.

```
Application Layer
Web Application / Mobile Application
        ↓
Backend API
Authentication, permissions, validation and business rules
        ↓
Document Processing Layer
Image processing, OCR and document understanding
        ↓
AI Intelligence Layer
OpenAI API for: invoice interpretation, material extraction,
material classification, matching suggestions, new material proposals
        ↓
Material Matching Engine
Supplier mapping, database search, normalisation,
specification comparison, semantic search when required
        ↓
Human Review Layer
Store Manager reviews and confirms
        ↓
Inventory Engine
Material Master creation, Material In posting, stock balance updates,
transaction ledger, audit records
```

### 23.2 AI Integration

Recommended initial AI service: OpenAI API.

The backend should send invoice images or supported documents for structured extraction.

Use structured JSON output.

Example:

```
{ "supplier": "ABC Traders", "invoice_no": "INV-1045", "invoice_date": "2026-11-09", "items": [ { "invoice_description": "ULTRATECH OPC 53 50KG", "suggested_name": "OPC Cement 53 Grade", "category": "Cement", "quantity": 500, "unit": "Bags", "pack_size": "50 KG" } ] }
```

This is an illustrative data structure. The actual API schema should include extraction confidence, specification attributes, page references and validation status.

### 23.3 Recommended Matching Strategy

Do not call AI for every matching operation.

Use this sequence:

1. Check confirmed supplier mapping.
2. Search exact material descriptions.
3. Search normalised descriptions.
4. Compare technical specifications.
5. Use semantic matching when needed.
6. Ask AI to resolve ambiguous candidates.
7. Suggest new material when no valid match exists.

### 23.4 AI Safety

AI must never directly write into the inventory database.

Backend must validate:

- Material identity.
- Specifications.
- Units.
- Quantities.
- Duplicate invoices.
- Permissions.
- Transaction status.

Only confirmed and validated operations should update stock.

## 24. DATABASE REQUIREMENTS

Recommended initial entities:

| Table | Purpose |
| --- | --- |
| users | User accounts |
| roles | Project Admin, Store Manager and Site Engineer |
| permissions | Role permissions |
| projects | Project information |
| stores | Physical project stores |
| locations | Towers, blocks, floors and work areas |
| material\_categories | Material classifications |
| units | Unit master |
| materials | Material Master |
| material\_specifications | Structured material attributes |
| suppliers | Supplier records |
| supplier\_aliases | Supplier name variations |
| supplier\_material\_mappings | Confirmed supplier mappings |
| invoices | Uploaded invoice documents |
| invoice\_items | Extracted invoice line items |
| ai\_processing\_logs | AI extraction and matching logs |
| material\_transactions | Stock movement ledger |
| stock\_balances | Current stock balances |
| stock\_verifications | Physical stock verification |
| stock\_adjustments | Approved stock corrections |
| audit\_logs | System activity |

Entities added for the Site Engineer & Material Requisition module are listed in Section 24.4.

### 24.1 Important Data Relationships

- A project can have multiple stores.
- A store can have multiple stock locations.
- A project can have multiple materials.
- A supplier can provide multiple materials.
- An invoice can contain multiple invoice items.
- An invoice item can map to one Material Master record.
- A material can have multiple transactions.
- A material can have multiple supplier mappings.
- A user can create multiple transactions.

### 24.2 Inventory Ledger

Material transactions must be the authoritative inventory record.

Current stock balances should be maintained consistently with the ledger.

Use database transactions, concurrency controls and idempotency to prevent:

- Duplicate stock posting.
- Negative stock.
- Race conditions.
- Partial inventory updates.

### 24.3 Multi-Store Inventory

The initial architecture should support multiple stores within a project.

Stock must be tracked at store level.

Project-wide stock should be the sum of individual store balances, not a separate manually maintained balance.

Store transfers should be treated as a future or separately scoped feature unless required for the initial deployment.

### 24.4 Site Engineer & Material Requisition Entities

| Table | Purpose |
| --- | --- |
| user\_location\_assignments | Site Engineer to location mapping (any hierarchy level) |
| contractors | Contractor Master: name, trade, contact, status (Active / Pending / Inactive) |
| activity\_types | Activity Type master |
| activities | Work activities per location, referencing an activity type |
| consumption\_norms | Norm per Activity Type + Material |
| material\_requests | MR header (type: Standard / Retrospective; derived status) |
| material\_request\_items | MR lines with line status |
| issue\_acknowledgements | Site receipt confirmations |
| issue\_disputes | Disputes, resolution and exit |
| site\_losses | Admin-approved Site Loss entries against issues |
| return\_requests | Site-initiated returns |
| work\_progress | Work completed entries |
| consumption\_reconciliations | Variance results |
| indents | Indent header |
| indent\_items | Indent lines |
| tool\_custody | Returnable item custody records |
| notifications | Notification log |
| notification\_preferences | User channel settings |

#### Relationships

- Locations form a hierarchy: Tower → Floor → Work Area.
- A Material Request has multiple request items.
- A request item can have multiple Material Out transactions (partial issues and reissues).
- A Retrospective MR links to exactly one emergency-issue Material Out.
- A Material Out transaction can have one acknowledgement.
- An acknowledgement can have one dispute.
- A dispute can have one Site Loss entry.
- A Return Request links to one Material Return transaction.
- An activity belongs to one location and one activity type.
- An activity can have multiple work progress entries.
- A consumption norm links an activity type and a material, in the activity type's work unit.
- An MR, emergency issue and return request each reference one contractor.
- An indent has multiple indent items.
- A Material In transaction can reference an indent item.
- A tool custody record links a Tool Issue to its Tool Return or Tool Write-off.

## 25. AI LIMITATIONS AND SOLUTIONS

| Challenge | Solution |
| --- | --- |
| Handwritten text | OCR + AI + field-level review |
| Blurry images | Image quality checks and recapture |
| Multi-page invoices | Page-wise extraction and consolidation |
| Different invoice formats | Document understanding |
| Different material descriptions | Supplier mapping and normalisation |
| Similar material names | Specification-based matching |
| Different brands | Brand attributes and matching rules |
| Unit conversion | Centralised conversion engine |
| Missing pack sizes | Manual verification |
| Incorrect quantities | Actual received quantity verification |
| Duplicate material records | Duplicate detection |
| Duplicate invoice uploads | Invoice deduplication |
| Partial extraction | Line-level correction |
| Poor regional language support | Multilingual OCR testing and fallback |
| Incorrect AI suggestions | Human confirmation |
| Network interruption | Asynchronous processing and idempotent retries |

### 25.1 Important Principle

AI proposes.

Backend validates.

Store Manager confirms.

Inventory Engine posts.

This separation is mandatory.

## 26. NON-FUNCTIONAL REQUIREMENTS

### 26.1 Performance

- Normal application pages should load quickly.
- Stock search should be responsive.
- AI processing should happen asynchronously.
- Processing status should be visible.
- Users should be able to navigate other modules during AI processing.

### 26.2 Security

- Secure authentication.
- Backend-enforced permissions.
- HTTPS.
- Secure document storage.
- API key protection.
- Audit logging.
- Input validation.
- Secure file upload handling.

### 26.3 Reliability

- Duplicate invoice protection.
- Idempotent transaction posting.
- Consistent stock balances.
- Safe retry mechanisms.
- Failed processing recovery.
- Document retention.

### 26.4 Usability

- Minimal data entry.
- Simple language.
- Large controls.
- Clear status indicators.
- Consistent layouts.
- Mobile-friendly interface.
- Minimal training requirement.

### 26.5 Scalability

Support multiple construction projects, stores, users and suppliers.

Project-level data separation must be built into the database and API architecture.

## 27. SECURITY AND BUSINESS RULES

1. Every material must have a unique ID.
2. Every posted transaction must reference a valid material.
3. AI-generated masters must be reviewed before creation.
4. Invoice quantity and actual received quantity must remain separate.
5. Negative stock is prohibited.
6. Material Out requires a destination.
7. Material Return requires a source location.
8. Damaged materials are excluded from available stock.
9. Posted transactions cannot be deleted.
10. Reversals must reference original transactions.
11. Stock adjustments require Project Admin authorisation.
12. Duplicate invoices must be detected.
13. Units must be validated against the Material Master.
14. AI must not silently modify technical specifications.
15. Every transaction must record its creator and timestamp.
16. All posted inventory movements must be auditable.
17. Supplier mappings must originate from verified user decisions.
18. A failed transaction must not partially update stock.
19. All stock operations must be project- and store-aware.
20. Supplier invoices must not be automatically treated as proof of actual physical receipt.
21. Every Material Out must reference an MR, or be marked as Emergency Issue with a reason and activity.
22. Emergency issues must be regularised by a Retrospective MR within 24 hours, or be escalated to Project Admin.
23. A Retrospective MR can be created only from an existing emergency issue.
24. Site Engineers can request material only for locations within their assignment.
25. A user cannot approve their own request or indent.
26. Material Requests do not change stock. Only Material Out changes stock.
27. Acknowledgements and disputes do not change store stock. Reversal is used only for store posting errors where the material never left the store.
28. Short, damaged or not-received material at site is recorded as an Admin-approved Site Loss; store stock is not changed.
29. Unacknowledged issues must not auto-close.
30. Return Requests do not change stock until confirmed by Store Manager.
31. Only Good / Reusable returns increase available stock.
32. Consumption reconciliation uses acknowledged quantity. Consumption flags are informational and must not adjust stock.
33. Consumption norms must come from project data, not system defaults.
34. System-suggested indents require human submission.
35. Returnable items are issued and returned only through Tool Issue and Tool Return; these are excluded from consumption.
36. Lost returnable items require an approved Tool Write-off.
37. Contractors must be selected from the Contractor Master; free-text contractor entry is not allowed.
38. All requests, approvals, acknowledgements, disputes and losses must record user and timestamp.
39. All module actions must be project-, store-, and location-aware.

## 28. OUT OF SCOPE – INITIAL MVP

The following features are excluded from the first release:

- Purchase Order Management.
- Vendor Quotation Comparison.
- Procurement Management.
- Accounting Integration.
- GST Filing.
- Payment Processing.
- Vendor Payment Tracking.
- Complex Approval Workflows.
- Warehouse Bin Management.
- Advanced Batch Costing.
- AI Price Forecasting.
- Advanced Procurement Automation.

These can be considered in future releases.

**Note (v2.1):** Indent captures requirements only; procurement execution and Purchase Orders are outside the system. Approvals are single-level and arrive in one Approvals inbox: over-limit MRs, disputes, Site Loss and tool write-offs, and indents. Indent approval applies to every indent because it authorises purchase spending. Stock valuation is not part of MVP; any future value-based rule uses last confirmed purchase rate as indicative value, not accounting.

## 29. DEVELOPMENT PHASES

### 29.1 Revised Phase Plan

| Phase | Scope |
| --- | --- |
| Phase 1 – Foundation | As v2.0; add Site Engineer role, location hierarchy and assignment, Contractor Master |
| Phase 2 – Inventory Engine | As v2.0 |
| **Phase 2A – Requisition** | Site Engineer PWA; Material Request with line-level status; per-material MR maximum; Approvals inbox; store queue; partial issue; emergency issue and Retrospective MR; acknowledgement; disputes with Site Loss; return requests; notifications; Weekly Exception Report |
| Phase 3 – AI Invoice Processing | As v2.0 |
| Phase 4 – Mobile Application | As v2.0; native Site Engineer app optional, decided on Phase 2A adoption |
| **Phase 4A – Control** | Activity Types, activities, consumption norms, budget-based MR routing, work progress, reconciliation, indents (with indent reference on Material In), system-suggested indents, tool custody |
| Phase 5 – Reports and Finalisation | As v2.0; add new reports |

Rationale: Phase 2A has no external data dependency. Phase 4A depends on the client providing activity and norm data, so it is placed later.

Phase 2A has grown since the addendum. **\[R9\]**

### PHASE 1 – FOUNDATION

Develop:

- Authentication.
- Three roles (Project Admin, Store Manager, Site Engineer).
- Project setup.
- Store setup.
- Dashboard.
- Material Categories.
- Unit Master.
- Material Master (including Lead Time and Returnable).
- Location Management (Tower → Floor → Work Area).
- User Management.
- Site Engineer location assignment.
- Contractor Master.

Deliverable: Functional application foundation.

### PHASE 2 – INVENTORY ENGINE

Develop:

- Material In (manual).
- Material Out.
- Material Return.
- Current Stock.
- Transaction Ledger.
- Stock Validation.
- Low Stock Alerts.
- Duplicate transaction protection.
- Stock Verification.

Deliverable: Fully working inventory engine without AI.

### PHASE 2A – REQUISITION

Develop:

- Site Engineer screens as a responsive mobile web app (PWA).
- Material Request (create, copy, cancel) with line-level status and derived header status.
- Per-material maximum quantity per MR and approval routing.
- Approvals inbox.
- Store Request Queue.
- Issue against MR, partial issue and line expiry.
- Emergency issue with reason and activity; Retrospective MR; 24-hour escalation.
- Issue acknowledgement; disputes with Accepted / Loss Recorded / Reissued exits.
- Site Loss transaction.
- Site-initiated return requests.
- Notifications (in-app / push; WhatsApp if configured).
- Weekly Exception Report.

Deliverable: Every Material Out linked to a site request or flagged as emergency.

### PHASE 3 – AI INVOICE PROCESSING

Develop:

- Invoice upload.
- Mobile camera scanning.
- Document quality checking.
- AI extraction.
- OCR/handwriting support.
- Structured JSON output.
- Material matching engine.
- New Material Master creation.
- Field-level confidence.
- Review and confirmation.
- Supplier mapping memory (including lead time override).
- Duplicate invoice detection.
- Partial extraction handling.

Deliverable: AI-powered Material In.

### PHASE 4 – MOBILE APPLICATION

Develop:

- Mobile dashboard.
- Material In.
- Material Out.
- Material Return.
- Current Stock.
- Camera integration.
- Transaction history.
- Responsive review screen.
- Native Site Engineer app (optional; decided on Phase 2A PWA adoption).

Deliverable: Mobile-operable inventory system.

### PHASE 4A – CONTROL

Develop:

- Activity Type master and Activity Master.
- Consumption norms (Activity Type + Material).
- Budget-based MR approval routing (planned quantity × norm).
- Work progress entry.
- Consumption reconciliation on acknowledged quantity, with variance flags.
- Indents, with indent reference on Material In and Quick Receive.
- Rule-based system-suggested indents (days of cover).
- Returnable tool custody: Tool Issue, Tool Return, Tool Write-off.

Deliverable: Consumption control and advance planning, gated on client activity and norm data.

### PHASE 5 – REPORTS AND FINALISATION

Develop:

- Current Stock Report.
- Material In Report.
- Material Out Report.
- Material Movement Report.
- Supplier-wise Report.
- Low Stock Report.
- AI Processing Report.
- Material Request Report.
- Pending Acknowledgement Report.
- Dispute Report.
- Emergency Issue Report.
- Consumption Variance Report.
- Indent Status Report.
- Tool Custody Report.
- Audit Logs.
- Excel/PDF exports.
- Security testing.
- Performance testing.

The Weekly Exception Report is delivered in Phase 2A.

Deliverable: Production-ready MVP.

## 30. TESTING AND ACCEPTANCE CRITERIA

### 30.1 AI Testing Dataset

Before production deployment, collect 50–100 actual supplier documents.

Suggested distribution:

- Printed invoices.
- Handwritten challans.
- Mixed printed and handwritten documents.
- Poor-quality photographs.
- Multiple-page invoices.
- Different supplier formats.
- Different languages.

Maintain manually verified expected results as ground truth.

### 30.2 Accuracy Testing

Measure separately:

1. Supplier extraction accuracy.
2. Invoice number accuracy.
3. Invoice date accuracy.
4. Material description accuracy.
5. Quantity accuracy.
6. Unit accuracy.
7. Specification accuracy.
8. Material matching accuracy.
9. New material classification accuracy.

Do not rely on one overall AI accuracy percentage.

### 30.3 Functional Acceptance

The system must successfully demonstrate:

- Uploading printed invoices.
- Uploading handwritten challans.
- Extracting multiple material lines.
- Matching existing materials.
- Detecting new materials.
- Highlighting uncertain fields.
- Correcting extracted quantities.
- Handling partial deliveries.
- Converting compatible units.
- Detecting duplicate invoices.
- Creating new Material Master records.
- Updating stock after confirmation.
- Preventing negative stock.
- Maintaining complete audit history.
- Operating from mobile devices.
- Site Engineer raising an MR from a phone through the PWA.
- Site Engineer assigned at Tower level raising an MR for a floor in that tower.
- Blocking MR for an unassigned location.
- MR line above the per-material maximum routed to the Approvals inbox.
- Urgent MR going straight to the store queue and appearing in the Weekly Exception Report.
- Partial issue against an MR line with balance remaining open; header status derived correctly.
- Contractor selected from the Contractor Master; free text rejected; Pending contractor quick-added by Store Manager.
- Emergency issue requiring reason and activity, regularised by a Retrospective MR.
- Unregularised emergency issue escalated after 24 hours.
- Site acknowledgement in full.
- Dispute resolved as Accepted, Loss Recorded and Reissued; Site Loss leaves store stock unchanged.
- Reversal used only for a store posting error.
- Overdue acknowledgement flagged.
- Return Request confirmed by store with condition.
- Consumption variance calculated on acknowledged quantity and flagged above the allowed threshold.
- Indent raised, approved, and referenced on Material In.
- Days-of-cover alert using supplier lead-time override; Minimum Stock fallback when lead time is missing.
- Returnable tool issued through Tool Issue, shown In Custody, excluded from consumption, and returned or written off.
- Notifications delivered for all listed events.

## 31. OPEN QUESTIONS AND RISKS – REQUISITION MODULE

### 31.1 Open Questions (Must Be Answered Before Build)

1. Who actually walks to the store to collect material on the client's sites: Site Engineer, foreman, or contractor supervisor?
2. Does the client have activity-wise BOQ quantities and mix designs in usable form? Who will enter them?
3. Who is the approver in practice: Project Admin, Project Manager, or Planning Engineer?
4. Is WhatsApp Business API approved and budgeted?
5. What is the acceptable time for an urgent request from raise to issue?

Question 2 decides whether Phase 4A is worth building at all.

### 31.2 Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| SEs find MR slower than a phone call | Process bypassed | 30-second repeat request target; track emergency issue % |
| Norms and BOQ data unavailable | Reconciliation unusable | Phase 4A gated on client data; start with 3–5 materials |
| Acknowledgement done without checking | False custody record | Allow supervisor acknowledgement; random dispute audits |
| Project Admin becomes approval bottleneck | Delayed site work | Exception-only approvals; urgent bypass |
| Indent seen as procurement system | Scope creep | Clear note that PO execution is out of scope |

## 32. FUTURE ENHANCEMENTS

1. Barcode and QR scanning.
2. WhatsApp invoice submission.
3. Voice-based material search.
4. AI purchase recommendations.
5. Multiple warehouse management.
6. Contractor-wise material consumption. Partly delivered through consumption reconciliation (Section 16.9).
7. Project-wise inventory comparison.
8. ML-based predictive stock forecasting. (MVP has rule-based days of cover only, Section 16.10.)
9. Accounting integration.
10. Advanced AI classification.
11. Offline transaction capture and synchronisation.
12. Advanced material analytics.
13. Purchase Order module linked to Indent.
14. Stock valuation (indicative value at last confirmed purchase rate).

WhatsApp notifications are delivered in Section 16.12.

## 33. FINAL END-TO-END WORKFLOWS

### 33.1 Material In – AI Workflow

```
Store Manager opens Material In.
        ↓
Scans or uploads invoice / handwritten challan.
        ↓
System checks document quality.
        ↓
AI reads the document.
        ↓
AI extracts supplier and material information.
        ↓
Material Matching Engine searches Material Master.
        ↓
Three possible outcomes:
  MATCHED – Existing material identified.
  NEW MATERIAL – New material proposed.
  REVIEW REQUIRED – User correction required.
        ↓
Store Manager reviews extracted information.
        ↓
Store Manager verifies actual received quantity and material condition.
        ↓
User clicks CONFIRM & RECEIVE.
        ↓
Backend validates the complete transaction.
        ↓
New Material Master records are created where applicable.
        ↓
Material In transactions are posted.
        ↓
Stock balances are updated.
        ↓
Supplier mappings are saved.
        ↓
Receipt is generated.
```

### 33.2 Material Out Workflow

```
Store Manager opens Request Queue / Material Out.
        ↓
Selects an MR line from the Request Queue,
or selects Emergency Issue and enters reason and activity.
        ↓
Searches or selects material (pre-filled from MR).
        ↓
System displays available stock.
        ↓
Enters issue quantity.
        ↓
Selects Tower / Floor / Work Area (pre-filled from MR).
        ↓
Selects contractor from Contractor Master (pre-filled from MR).
        ↓
Confirms Issue.
        ↓
Stock is reduced.
        ↓
Transaction is recorded with MR reference or Emergency flag.
        ↓
Site Engineer is notified to acknowledge.
        ↓
Emergency issue: Retrospective MR due within 24 hours.
```

### 33.3 Material Return Workflow

```
Store Manager opens Return
(optionally from a pending Site Engineer Return Request).
        ↓
Selects material.
        ↓
Enters quantity.
        ↓
Selects returned-from location.
        ↓
Selects condition.
        ↓
Confirms Return.
        ↓
Reusable stock is increased.
        ↓
Damaged / Scrap quantities are recorded separately.
```

### 33.4 Stock Verification Workflow

```
Store Manager opens Stock Verification.
        ↓
Selects material.
        ↓
Views system quantity.
        ↓
Enters physical quantity.
        ↓
System calculates difference.
        ↓
Submits discrepancy.
        ↓
Project Admin reviews.
        ↓
Approves or rejects adjustment.
        ↓
Approved adjustment updates stock ledger.
```

### 33.5 Material Requisition Workflow

Defined in Sections 16.5 to 16.8: Request → (Approval if over limit) → Store Queue → Issue → Site Acknowledgement → Close.

## 34. FINAL PRODUCT EXPERIENCE

**Project Admin**

Login → Dashboard → Approvals → Manage Materials → Monitor Inventory → Review Transactions → Manage Users → Reports → Settings.

**Store Manager**

Login → Dashboard → Request Queue / Material In / Material Out / Return / Current Stock.

**Site Engineer**

Login (phone) → Request Material → Acknowledge Receipt → Report Work Done → Return / Indent.

**Signature AI Experience**

SCAN → UNDERSTAND → EXTRACT → MATCH → REVIEW → CONFIRM → UPDATE STOCK

The Store Manager should never need to understand OCR, AI models, database matching, material codes or inventory calculations.

The software should handle those complexities internally.

## 35. FINAL PRODUCT PRINCIPLE

KAVACH should not feel like traditional ERP software.

It should feel like a simple assistant for construction store operations.

AI should remove repetitive work.

The backend should guarantee inventory correctness.

The Store Manager should handle only real-world decisions and physical verification.

The Project Admin should maintain control and visibility without getting involved in routine issues. Exceptions (over-limit requests, disputes, losses and write-offs) and indents come to one Approvals inbox; everything else is reviewed weekly.

**KAVACH – AI-POWERED CONSTRUCTION INVENTORY MANAGEMENT**

Less Manual Work. Smarter Inventory. Complete Control.

*"Don't make the store manager manage software. Make the software manage the inventory for the store manager."*
