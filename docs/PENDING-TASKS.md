# ACCAdminsuite — pending / ported notes

## Inherited from Loan Equipment Tracker (2026-07-14)

Ported in Phase 1 of the cross-suite useful-ports plan:

| Pattern | Status | Notes |
|---|---|---|
| Quiet `.vbs` + Hidden WFH | Done | `Start ACC Suite (quiet).vbs`; Desktop pin the `.vbs` |
| Tab-close lifecycle | Done | `launcherLifecycle.ts` + `lifecycle.ps1` + `/_acc/heartbeat`/`goodbye` |
| Typography hierarchy | Done | `.page-title` / `.card-title` / `SectionTitle` |
| Assumption banner shell | Done | ACC Inbox filters + remittance stale + I-drive staging |
| Help Center + FAQ | Done | Quiet / tab-close / Accept undo / remittance Remove |
| Accept undo | Done | Review Queue toast (~45s) + patient-side “Undo this accept” via `undoHrqAcceptFromDocument` |
| Remittance Remove + re-reconcile | Done | Batch history on Billing Imports tab |
| Attention badge labels + pin/tint | Done | Sidebar `"N due"` / `"N review"` / `"N queue"` |
| Billing tabs + pagination | Done | Invoices / Needs review / Import tools |
| I-drive `_Staging` (Admin path grammar) | Done | `Letters\year\month\{LAST, First} CLAIM\` under `_Staging` |
| Mail Reference | Done | Seeded from 2024 sheet; editable module |
| RQ search / byte-identical discard | Already present | Kept Admin HRQ SLA / auto-accept |
| Finder / smoke tools | Done | `scripts/tools/Smoke-AdminSetup.ps1`, `Find-RemittanceCsv.ps1` (Desktop reports — never commit) |

## Still for Remittance Tracker (Phase 2 — not this suite)

Quiet launcher, tab-close, typography, thin Help FAQs — see plan file. Do **not** re-port Accept undo / banners / batch remove (already in Remittance).

## Case-centric workflow (2026-07-22, plan `admin_case_workflow_4661b37f`)

Shipped end-to-end across schema, pure library, store, UI, dashboard, RQ hook, dupe surfacing, Approvals responsive, and Billing needs-review surfacing:

| Area | Status | Notes |
|---|---|---|
| D0 Modal focus bug | Done | `Modal.tsx`: `onCloseRef` stabilises `useEffect`; prefer inputs over chrome for initial focus |
| A Schema/migration v4 | Done | `CaseStage`, `MemoPurpose`, `CaseEventKind`, `caseEvents[]`; `migrateV3ToV4` + `normalizeData` defensive fill |
| B Pure `caseWorkflow.ts` | Done | Transitions, calendar/working-day math, follow-up queries |
| C Store orchestration | Done | `sendMemoStartingCase` (explicit `same_claim`/`new_claim`), `advanceCaseStage`, `attachCaseDocument`, `recordCaseChase` |
| D Patients UI | Done | `CaseStepTracker`, memo purpose + target UI, case-status filter chips, timeline in `CasePanel` |
| E Dashboard/Settings/FAQ | Done | Nurse & ACC follow-up action items, sidebar "N due" badge, `CaseWorkflowBanner`, follow-up SLA settings, `faq-case-workflow` + `faq-billing-monthly-close` |
| F RQ → case outcome | Done | `commitParsedApproval`/`commitParsedDecline` stamp `caseStage` + `acc_approved`/`acc_declined` event; Decline module UI untouched |
| G Duplicates banner | Done | Assumption banner on Patients + salmon-tinted "Check for duplicate patients" button when count > 0 |
| H Approvals responsive | Done | `Column.priority='low'` + `data-table-low-priority` CSS hides PO/Start/End/Approved qty/Days/Renewed below `lg`; sticky Actions preserved |
| I Billing needs-review | Done | Dashboard action items for `needsReview` invoice lines (danger, route → Billing `needs-review` tab via `focus.intent='needs-review'`); tab label clarified to "Needs review — variances to chase" |

Open questions / residual risks (tracked here, not blockers):

- NZ public-holiday calendar isn't wired into `addWorkingDays` yet — v1 uses Mon-Fri only. Nurse/ACC follow-up dates will drift by up to one day around long weekends until we import a holiday list.
- Memo target ("same claim renewal" vs "new claim") is a free explicit choice; there is no automatic inference from body text. Users must pick before "Send memo" is enabled when the patient has any existing claims.
- Duplicate soft-match on create currently *warns* via the "Save anyway?" dialog + banner. It does not force a merge or block the save.
- Approvals responsive priority uses CSS-only column hiding (no expandable detail row). Below ~1024 px, low-priority fields aren't visible without widening the viewport or exporting the table.

