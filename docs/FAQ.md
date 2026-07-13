# ACC District Nursing Admin Suite — FAQ inventory

Durable inventory of coworker-facing FAQs. In-app source of truth:
`src/lib/helpContent.ts` (Help Center) and `src/lib/helperTips.ts` (Helper Mode short blurbs).

**Count:** 38 FAQ entries in `src/lib/helpContent.ts` (keep this file in sync when adding entries).

## How to use Help & Helper Mode

1. **Help** (top bar) opens the Help Center (Guide + searchable FAQ).
2. **?** (top bar) toggles **Helper Mode** (also under Settings → Helper Mode). Default **off**.
3. With Helper Mode on, hover/focus key controls for a short tip; **Learn more** jumps to that FAQ.
4. Tips dismiss on mouse leave or Esc and do not trap clicks.

## FAQ index (by theme)

### Launcher & local helper
- Quiet launcher / supervisor
- Tab-close lifecycle
- Connecting vs Reconnecting
- Folder Watch / ACC-Inbox
- Outlook sync → HRQ
- Concurrent-tab warning

### Dashboard, Review Queue & I-drive
- Dashboard first steps / action queue
- What HRQ means
- Queue tabs (Under review / Unnamed / Deferred / Auto-approve)
- Auto-accept ready
- Discard unnamed
- Accept / Undo accept
- Also stage to I-drive / Stage later
- ACC Inbox vs Review Queue
- Import ACC letter (PDF/Word) entry points

### Records modules
- Patients & Cases / claims / documents
- Approvals NS04/NS05 (NS03 no longer needs approval)
- Decline Tracker
- Complex Cases
- Flagged (Compliance)

### Billing, Calculator & tools
- Needs review tab
- Remove remittance import
- Package Calculator quirks
- Contract rates (excl GST)
- Mail Reference sheet

### Export, data & Settings
- Excel workbook + Undo Excel import
- Excel vs JSON vs ZIP vs top-bar Save
- Save / Load vs IndexedDB
- Settings paths (inbox, I-drive, filters)
- Assumption banners
- Offline / no internet
- Helper Mode / reopen Help

### Fun / Easter eggs
- Enable disco cats, cute cursors, walking companion (Settings → Fun)
- NS triple-click session disco + how to turn off

## Helper tips wired (this pass)

`tip-sidebar-badges`, `tip-accept`, `tip-undo-accept`, `tip-idrive-checkbox`,
`tip-stage-later`, `tip-needs-review`, `tip-remove-remittance`, `tip-connecting`,
`tip-export-excel`, `tip-export-accdata`, `tip-export-zip`, `tip-excel-import`,
`tip-calculator`, `tip-helper-mode`, `tip-quiet-launcher`, `tip-hrq`,
`tip-queue-tabs`, `tip-auto-accept`, `tip-discard-unnamed`, `tip-letter-import`,
`tip-save-load`, `tip-mail-reference`, `tip-fun-easter`,
`tip-approvals`, `tip-compliance`

## Residual (optional polish)

`tip-quiet-launcher` remains mostly registry-only (no in-app launcher control).
Assumption-banner dismiss controls inherit page context; no separate tip id per banner.
