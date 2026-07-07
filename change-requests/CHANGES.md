# Requested Changes

Drop your annotated screenshots in `change-requests/images/` and describe each
change below. One section per screenshot works best. Even though your drawings
are on the image, a sentence of intent removes ambiguity.

Naming tip: number the images so order is obvious, e.g.
`01-dashboard-header.png`, `02-billing-add-column.png`.

Status legend: [ ] todo · [~] in progress · [x] done

---

## P0 — Data integrity & trust (2026-07-08) [x]

**Gate:** Eliminate silent data loss and unsafe auto-commit before hospital pilot.

| Task | Delivered |
|------|-----------|
| P0-001 | `RecoveryModal` blocks app on corrupt IDB; no silent `sampleData()` fallback |
| P0-002 | Corrupt `.accdata`/ZIP shows TopBar flash + modal; import rolls back on failure |
| P0-003 | TopBar three-state save model + Settings "How saving works" blurb |
| P0-004 | `BackupReminderModal` after 7 days (configurable); 24h snooze |
| P0-005 | `productionMode` default true; `resolveLetterAutoCommit()` gates auto-file |
| P0-006 | `auditLog.ts` append-only IDB log; Settings → Recent activity (50 events) |
| P0-007 | `validateReferentialIntegrity()` on load; Settings health panel |
| P0-008 | `removeDocument` surfaces blob delete errors; ZIP manifest blob counts |
| P0-009 | `beforeunload` only when `dirty` (unchanged behaviour, verified) |
| P0-010 | `LETTER_IMPORT_UX.md` referenced from Settings; entry table unchanged |

**Tests:** 73 passing (`+7` compliance cache; was 66 after P0).

---

## U-01 Launch + P1 Performance (2026-07-08) [x]

**Launch:** Restored `dist/Start ACC Suite.cmd` + `dist/launch.ps1` (loopback static server, port 8765). Dev convenience: `npm run launch` serves built `dist/` on Mac/Windows. Coworker workflow: sync `dist/` to I: drive → double-click cmd → browser opens; terminal stays open as the server. `.accdata` loaded separately via TopBar.

**P1 delivered:** compliance cache (`complianceCache.ts`), cached findings in `buildActionQueue`, indexed hot paths (`indexes.ts`), lightweight sidebar badges, action queue cap (50), compliance group pagination, dashboard metrics indexes, autosave debounce (3s) + Excel import pause, importHistory IDB split, patient-scoped findings, incremental claim scans, compliance IDB snapshot, lazy billing queue on dashboard, stress CI + 20% regression guard.

**How to launch:** See Settings → “How saving works” blurb, or: build once, copy `dist/` to shared drive, double-click `Start ACC Suite.cmd`.

---

## P3 Production reliability + P8-002 HRQ (2026-07-08) [x]

**P3 delivered (partial):**

| Task | Delivered |
|------|-----------|
| P3-001 | `ErrorBoundary` — recovery screen, download JSON report, reload |
| P3-002 | `AutosaveErrorBanner` — persistent IDB failure banner + retry |
| P3-003 | `migrations/index.ts` — FILE_VERSION 2, v1→v2, downgrade blocked |
| P3-006 | CI already runs test + build + verify-build + stress:medium |
| P3-008 | Version + build date in Sidebar footer and Settings About |

**P8-002 delivered:** `ReviewQueue.tsx` module — import folder-watch sidecars, SLA badges, batch reject, review→letter import sign-off with audit log. Sidebar badge for pending count.

**P8-020 verified:** Word `.docx` via mammoth already shipped; HRQ letter picker accepts PDF + docx.

**Tests:** 95 passing (`+10` migrations, ErrorBoundary, staging SLA, storage migrate).

**Next:** P3-005 Excel rollback, P5-001 corpus, P5-002 entry audit, P2-006 modal layout.

---

## P7 ops runbook + P8-004 batch approve (2026-07-08) [x]

**P7 delivered (partial):**

| Task | Delivered |
|------|-----------|
| P7-001 | `change-requests/RUNBOOK.md` — backup routine, corrupt load recovery, I: drive `dist/` update, portal discover for non-tech users, P7-003 diagnostics blurb (planned) |

**P8-004 delivered:** `src/lib/hrqBatch.ts` + Review Queue **Approve selected** — multi-select high-confidence `letter-import-pending` items with `parsedPreview`; confirm dialog lists every patient name; commits via store without LetterImportModal. **Batch ready** badge on eligible rows.

**Tests:** 134 passing (`+11` hrqBatch eligibility + J-26 three-commit routing).

---

## P5 Letter import critical UX + P3-004 backup (2026-07-08) [x]

**P5 critical path delivered:**

| Task | Delivered |
|------|-----------|
| P5-003 | Parse-fail error modal — Try another / Attach doc only; no blank modal during auto-commit |
| P5-004 | Success panel (Open claim / View approvals) + `setFocus`; TopBar flash via `showTopBarFlash` store hook |
| P5-005 | Compliance `create-approval` → Approvals module; **Import ACC letter** button with `entryPoint: 'compliance'` |
| P5-006 | Save everything disabled when blocking issues; modal title shows "N items to fix" |
| P5-007 | Prefill vs full-save labels + hints; **Import & save now** on claim prefill path |
| P5-008 | Matched patient + body name mismatch = warning not blocker; stored name used |
| P5-009 | "Matched {name} (NHI …)" banner; dropdowns pre-selected |
| P5-010 | Duplicate guard: hash + size + claim scope; confirm before commit |

**P3-004 delivered:** `backup.ts` manifest now includes `dataJsonSha256` + per-blob SHA-256; `readBackupZip` validates before apply.

**Tests:** 98 passing (`+3` backup checksums). Build + verify-build OK.

---

## P3 remainder — rollback, IDB retry, quota (2026-07-08) [x]

| Task | Delivered |
|------|-----------|
| P3-004 | Checksums moved to `crypto.ts`; Export Center notes manifest validation |
| P3-005 | `excelImportSnapshot` IDB; `computeImportMergeDiff`; Export Center undo card |
| P3-007 | `withIdbRetry` on all IDB kv/doc transactions + file-handle persistence |
| P3-009 | `storageQuota.ts` + Settings guidance + quota-aware autosave banner |
| P3-010 | `change-requests/stress-eval-tasks.json` eval loop wiring |

**Tests:** 123 passing (`+11` excel diff, IDB retry, storage quota).

**Deferred to later phases:** Playwright e2e smokes (P7), PWA install manifest (U-01 deployment choice).

---

## P2 Scale UI + P8-0 folder watch (2026-07-08) [~]

**P2 delivered (partial):** Virtualized `DataTable` via `@tanstack/react-virtual` — windowed rows when count > 50 (Billing, Approvals, Declines). Compliance uses grouped cards (P1-007 cap) — P2-002 marked superseded.

**P8-0 delivered (partial):** `src/lib/staging.ts` + IDB `stagingQueue`; `scripts/wfh/folder-watch.mjs` writes `.staging/*.json` on PDF drop; `npm run wfh:folder-watch`. HRQ UI (P8-002) and ACC Inbox (P8-0b) still pending.

**Docs:** `EMAIL_PORTAL_INPUTS_CHECKLIST.md`, `EMAIL_PORTAL_ARCHITECTURE.md` — work PC inputs + honest email/portal architecture assessment.

**2026-07-08 email corpus:** Parsed sample `.eml` — approval senders (Bec/John/Becky @acc.co.nz), subject pattern `Claim:{n} ACCID:{id}` with fake patient `Gilbert Gandor`. Fixtures in `scripts/stress/fixtures/email/` (redacted `.eml`, PDF, portal PNGs). Architecture §6c adds Outlook filter rules + subject regex.

**2026-07-08 P8-020 Word + P8-2b portal probe:** `approval-template.docx` fixture + `mammoth` + `extractWordText()` — parse parity with PDF in tests. `scripts/wfh/portal-discover.mjs` + README for CDP attach on work PC; checklist/architecture updated with screenshot inventory.

**2026-07-08 P8-2b launcher — one double-click:** `dist/Start Portal Discover.cmd` + `portal-discover.ps1` — opens Edge/Chrome with remote debugging, OK dialog for Citrix/portal login, runs `portal-discover.mjs` (raw CDP via `cdp-client.mjs`, **no Playwright** on work PC). Output fixed at `%USERPROFILE%\ACC-Suite\portal-map.json` + `portal-summary.html`; Explorer opens on success. `npm run build` copies `dist/wfh/*.mjs` + launchers. Mac: `Start Portal Discover.command`.

**Tests:** +10 (staging + folderWatch + Word extract/parse parity).

---

## Patients full letter import + no-match warning (2026-07-08) [x]

- **Patients page header:** `LetterImportButton` with full save (`entryPoint: 'patients'`) beside "+ New patient" — creates/updates patient, claim, approvals or declines, and PDF (not prefill-only).
- **No-match gating:** `buildLetterIssues` `no-match` is advisory (`blocking: false`) for approval and decline letters so "Save everything" works for new patients.
- **Docs:** `LETTER_IMPORT_UX.md` routing matrix updated; claim-level import in Documents tab unchanged.

**Tests:** +2 (no-match warning for approval + Patients-context full commit for new patient approval; decline path already covered).

---

## P6 — Compliance & billing completeness (2026-07-08) [x]

| Task | Delivered |
|------|-----------|
| P6-001 | `complianceRulesVersion` in settings; findings carry `rulesVersion`; Settings shows rules version |
| P6-002 | `FIX_INTENT_ROUTES` + `orphanFixIntents()` audit; `review-ns05` opens edit modal; `request-po` routes to patients |
| P6-003 | `billingFunnel` parity tests (synthetic + sample + 2k lines) |
| P6-004 | `remittanceStaleDays` setting; stale remittance in action queue; Dashboard → Billing deep link |
| P6-005 | `renewalAssignee` field on approvals; expiry queue unchanged (badges already in Approvals) |
| P6-006 | **Management Summary** Excel sheet — violations, funnel, open declines, expiry horizon |
| P6-007 | `validation.ts` — NHI mod-11 + claim normalize; warning on patient save |
| P6-008 | Historical `recordStatus` excluded via `isBillingApproval` (tested) |
| P6-009 | Export progress bar after 2s on large workbook build |

**Tests:** 131 passing (+15 analytics, validation, compliance version/routing/historical, Management Summary excel). NS06/travel rules unchanged (no defer needed).

---

## 1. <short title, e.g. Dashboard header>

![](images/01-example.png)

- Screen/module: <e.g. Dashboard / src/modules/Dashboard.tsx>
- Change: <what you want, referencing the marks on the image>
- Notes: <optional constraints, edge cases>
- Status: [ ]

---

## 2. <short title>

![](images/02-example.png)

- Screen/module:
- Change:
- Notes:
- Status: [ ]
