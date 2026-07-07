# Letter Import — User Journey Contract

Living contract for ACC letter (PDF) import. Update when entry points or outcomes change.

## Entry points

| Location | Button label | Mode | Outcome on success |
|---|---|---|---|
| Patients → page header | Import ACC letter (PDF) | Full save | Patient + claim + approvals/declines + document |
| Patients → New patient modal | Prefill from letter | `prefillOnly` | Form fields filled; no claim until Save |
| Patients → New/edit claim modal | Prefill from letter | `prefillOnly` | Claim form filled; no persist until Save |
| Patients → Claim → Documents | Import ACC letter (PDF) | Full save | Patient/claim/approvals + document |
| Patients → Claim card (no current NS04/NS05) | Import ACC letter (PDF) | Full save | Same as Documents |
| Approvals module | Import ACC letter (PDF) | Full save | Approvals filed + document |
| Declines module | Import ACC letter (PDF) | Full save | Decline record + document |
| Compliance → Import approval letter | Import ACC letter (PDF) | Full save | Context from finding |
| App drag-drop (any PDF) | — | Full save | Opens confirm modal |
| Global (via `LetterImportButton`) | Import ACC letter (PDF) | Configurable | Per opts |

## Where to upload which PDF

| Letter type | Best entry point | Also works at |
|---|---|---|
| **Approval (NUR02)** | Approvals module | Claim Documents (or claim card import) |
| **Decline (NUR04VEN)** | Declines module | Claim Documents (or claim card import) |
| **Either** | Claim Documents tab | Parser auto-detects approval vs decline |

- **Approvals / Declines modules**: full import — parses letter, creates records, stores PDF.
- **Claim Documents**: attach + parse for *that* claim (approval or decline both OK — parser detects type); PDF stays on the claim.
- **Patients page header** (`Import ACC letter`): full import — patient, claim, approvals/declines, PDF. Same path as Approvals/Declines modules.
- **Patients prefill** (`Prefill from letter` in New patient / New claim modals): form fill only, no save until you click Save on the form.
- Decline PDF → Declines **or** Claim Documents. Approval PDF → Approvals **or** Claim Documents.

## Four-state UI (mandatory)

Every import must show one of:

1. **Loading** — progress bar, text preview, OCR callout when applicable
2. **Confirm / Edit** — review fields, fix issues, choose link target
3. **Success** — outcome summary + deep links (Open claim, View approvals)
4. **Error** — unknown format or read failure; offer Try another file | Attach as document only

Never `return null` while `letterImport` store flag is set.

## Warnings vs blockers

| Issue | When matched (NHI + claim) | Blocks Save |
|---|---|---|
| Name mismatch (body vs header) | Warning only | No |
| Missing PO | Blocker | Yes |
| No service rows | Blocker | Yes |
| Ambiguous patient match | Blocker | Yes |
| No existing patient/claim (new records) | Warning only | No |
| Duplicate filename on claim | Confirm dialog | User choice |

## Post-commit

- Flash success banner via `letterImportSuccess` store slice
- `setFocus({ module, patientId, claimId })` for navigation
- Billing nudge from `claimBillingState` when applicable
- Append to `importHistory` (Settings → Recent imports)

## Compliance fix routing

| Fix action | Route |
|---|---|
| `create-approval` | `setFocus({ module: 'approvals', ... })` — Approvals opens new-approval modal |
| `request-po` | `setFocus({ module: 'patients', ... })` — open claim context |
| Letter import intended | Separate label: "Import approval letter" |

## Verification checklist

- [ ] `npm test` — parser + integration journey
- [ ] `npm run build && npm run verify-build`
- [ ] Browser: approval fixture → confirm → save → claim exists
- [ ] Browser: prefill from new patient → no claim until Save
- [ ] Browser: corrupt PDF → error modal (not blank)
- [ ] Compliance "Create approval" → Approvals modal, not file picker
- [ ] Single `LetterImportButton` — no duplicate hidden inputs
