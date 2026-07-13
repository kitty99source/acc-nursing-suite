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
