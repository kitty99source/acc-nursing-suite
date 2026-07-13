# ACC District Nursing Admin Suite — FAQ inventory

Durable inventory of coworker-facing FAQs. In-app source of truth:
`src/lib/helpContent.ts` (Help Center) and `src/lib/helperTips.ts` (Helper Mode short blurbs).

**Count:** 19 FAQ entries in `src/lib/helpContent.ts`.

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

### Review Queue (HRQ) & I-drive
- What HRQ means
- Accept / Undo accept
- Also stage to I-drive / Stage later
- Settings I-drive + inbox filter paths

### Navigation & Billing
- Sidebar badges = attention ≠ totals
- Needs review tab
- Remove remittance import

### Calculator & Export
- Package Calculator quirks (NS01–NS03, excl GST, editable rates)
- Export Center Excel workbook vs .accdata

### Data & Help
- Assumption banners
- Backup / IndexedDB
- Offline
- Helper Mode / reopen Help

## Helper tips wired (this pass)

`tip-sidebar-badges`, `tip-accept`, `tip-idrive-checkbox`, `tip-stage-later`,
`tip-needs-review`, `tip-remove-remittance`, `tip-export-excel`, `tip-calculator`,
plus registry entries for connecting / quiet / helper / hrq / backup (wire UI as practical).

## Honest gaps (follow-up)

Connecting/Reconnecting loading banner, Auto-accept button, ACC Inbox module controls,
Compliance/Approvals/Declines primary actions, Mail Reference, Quick Paste, JSON backup
button in Export Center, assumption banner dismiss, concurrent-tab warning.
