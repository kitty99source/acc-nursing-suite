# Production Readiness Assessment — ACC Admin Suite

**Scope:** Functional and operational readiness for **hospital district-nursing admin staff daily use** — not legal/licensing, not ACC contract interpretation accuracy.

**Method:** Code review of `src/state/store.ts`, `src/lib/storage.ts`, `src/lib/idb.ts`, `src/lib/backup.ts`, `src/lib/compliance.ts`, `src/lib/letterImport.ts`, modules, tests, and stress harness. Compared against typical ACC admin workflow expectations.

**Overall verdict:** **Strong prototype / single-desk tool** with excellent offline-first intent and meaningful compliance logic. **Not production-ready for hospital-wide deployment** without addressing data-loss risk, multi-user gaps, auditability, and operational tooling.

---

## Scorecard (honest)

| Area | Status | Summary |
|------|--------|---------|
| Core billing workflow | 🟡 Partial | Patients, claims, approvals, billing log, declines, complex cases — present |
| Compliance engine | 🟢 Good | `compliance.ts` + Flagged page with fix intents |
| Letter import | 🟡 Partial | Works for template PDFs; OCR/review gaps |
| Data persistence | 🟡 Partial | IDB autosave + manual .accdata; confusing dirty semantics |
| Backup / restore | 🟡 Partial | Full ZIP in ExportCenter; no scheduled/automatic backup |
| Security (functional) | 🟡 Partial | Passphrase lock + optional AES; no roles |
| Multi-user / concurrent | 🔴 Missing | Single browser, last-write-wins |
| Audit / undo | 🔴 Missing | No change log, no undo |
| Monitoring / ops | 🔴 Missing | No logging, no CI, no runbooks |
| Testing | 🟡 Partial | 54 unit tests + stress harness; no E2E, no CI |
| Integrations | 🔴 Missing | No ACC portal, DHB, or finance system hooks |

---

## 1. Reliability & data

### Backup / restore

**What exists:**
- **Manual save/load:** `saveMyData` / `loadMyData` in `store.ts` — downloads/uploads `.accdata` JSON (`storage.ts`, `TopBar.tsx`).
- **Full backup ZIP:** `backup.ts` + `ExportCenter.tsx` — packages `data.json` + document blobs from IndexedDB (`exportFullBackup` / `importFullBackup`).
- **File System Access API:** Optional linked file handle persisted in IDB (`idb.ts` `FILE_HANDLE_KEY`) — auto-writes on save when permitted.
- **Encryption:** Optional AES-GCM via `crypto.ts` + session passphrase (`SettingsModule.tsx`, `storage.ts`).

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| No scheduled/automatic backup | **High** | Staff must remember to export; IDB loss = data loss if no file save |
| `dirty` flag vs autosave confusion | **High** | IDB working copy updates silently but `dirty` stays true until manual "Save my data" (`store.ts:290–292`, `TopBar.tsx`) — users may think data is "saved" when only IDB has it |
| Restore replaces all data | **Medium** | `importFullBackup` / `loadMyData` overwrite in memory — no merge/diff preview beyond Excel import |
| No backup verification | **Medium** | No checksum manifest beyond `manifest.json` format tag in ZIP |
| Document blob orphan risk | **Medium** | `removeDocument` catches IDB delete errors silently (`store.ts:1110`); metadata/blob can diverge |

### Corruption recovery

**What exists:**
- `normalizeData()` backfills missing settings fields on load (`storage.ts:80–94`).
- `FILE_VERSION = 1` with lenient bare-JSON fallback (`storage.ts:104–108`).

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| **Corrupt IDB → sample data** | **Critical** | `init()` catch block loads `sampleData()` on deserialize failure (`store.ts:404–409`) — **silent data loss** in production |
| No repair / partial recovery | **High** | Cannot salvage patients from broken JSON |
| No schema migration framework | **Medium** | Only `normalizeData` field backfill; no versioned migrations |
| No integrity checks on load | **Medium** | No validation that claims reference existing patients, etc. |

### Concurrent use

**What exists:** Nothing — by design (offline single-file tool).

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| Single-user only | **Critical** | Two admins cannot share live data |
| Same file, two browsers | **Critical** | Last write wins; no conflict detection |
| No real-time sync | **High** | Expected for offline, but blocks hospital team workflow |

### Offline

**What exists:** 🟢 **Fully offline** — Vite SPA, no network calls in storage/backup/letter import. Works from `file://` with manual save model.

**Gaps:** Service worker / PWA install not evident; offline is accidental, not packaged.

### Data migration / versioning

**What exists:** `FILE_VERSION = 1`, `normalizeData()` for settings defaults.

**Gaps:** No migration runner, no export-to-new-version path, no downgrade protection.

---

## 2. Audit trail, undo, change tracking

**What exists:** `importHistory` (last 20 letter imports, `store.ts:310–315`, shown in Settings). Delete confirmations say "cannot be undone."

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| No audit log (who/when/what) | **Critical** | All CRUD via `mutate()` — no append-only event log |
| No undo / redo | **High** | Destructive deletes are permanent |
| No record-level history | **High** | Cannot see prior approval values or invoice edits |
| importHistory too narrow | **Medium** | Letters only; not general change tracking |

---

## 3. Error handling, empty states, edge cases

**What exists:**
- Empty states on Dashboard, Compliance, Approvals, etc. (`EmptyState` component).
- Confirm dialogs for deletes (`useConfirm`).
- `beforeunload` guard when `dirty` (`App.tsx:60–68`).
- Save error surfaced in TopBar (`saveState: 'error'`).
- Letter import blockers/warnings UI (`LetterImportModal.tsx`).

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| Silent fallback to sample data | **Critical** | See corruption recovery |
| Autosave failure easy to miss | **Medium** | Error in status bar only |
| No global error boundary | **Medium** | Uncaught React errors crash whole app |
| Bulk Excel import partial failure | **Medium** | Merge modes exist but rollback story unclear |
| Encrypted file without passphrase at startup | **Low** | Handled via LockScreen — OK |

---

## 4. Security & access (functional)

**What exists:**
- **Idle auto-lock:** Configurable minutes (`SettingsModule.tsx`, `App.tsx:87–97`, default 15).
- **Manual lock:** TopBar lock button clears session passphrase (`store.ts:683–689`).
- **Encryption at rest:** Optional AES-GCM for `.accdata` and IDB working copy.
- **Session passphrase:** In-memory only, cleared on lock (`store.ts:69–70`).
- **Local-only PHI:** No telemetry/network in core libs.

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| No user accounts / roles | **Critical** | Anyone with passphrase sees all PHI |
| No RBAC (admin vs clerk vs read-only) | **High** | Cannot restrict export/delete/settings |
| Passphrase not tied to OS user | **High** | Shared hospital PC risk |
| PHI in plaintext IDB when encryption off | **High** | Default path for new installs |
| No clipboard/export audit | **Medium** | Excel/JSON export unrestricted |
| No session timeout warning | **Low** | Lock is abrupt |
| Browser devtools / extensions | **Low** | Inherent browser risk — document in runbook |

---

## 5. Operational

### Monitoring & logging

**Gaps:** 🔴 **None.** No structured logs, no error reporting (Sentry etc.), no usage metrics, no health check.

### Support runbooks

**Gaps:** 🔴 **None in repo.** No `docs/ops/`, no troubleshooting for IDB quota, corrupt files, OCR failures.

### Update / deploy path

**What exists:**
- `npm run build` → Vite + `vite-plugin-singlefile` → single HTML in `dist/`.
- `verify-build.mjs` script.

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| No CI/CD pipeline | **High** | No `.github/workflows` |
| No auto-update mechanism | **High** | Manual copy of HTML to shared drive |
| No version displayed in UI | **Medium** | `package.json` 1.0.0 not shown to users |
| No staged rollout | **Medium** | Single artifact |

### Performance SLAs at hospital scale

**What exists:** Stress harness (`npm run stress`, `stress.test.ts`) — 22 benchmarks, large scale passes but **approaching limits** on action queue and coverage gaps.

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| No SLA defined for staff | **High** | See OPTIMIZATION_PLAN.md |
| Stress not in CI | **High** | Manual run only |
| No real-device profiling | **Medium** | Node benchmarks ≠ browser DOM |
| 10k action items unusable | **High** | Dashboard UX cliff (see stress report) |

---

## 6. Clinical / admin workflow completeness

### Present (matches real ACC admin work)

| Capability | Module / file |
|------------|---------------|
| Patient & claim registry | `Patients.tsx`, `store.ts` CRUD |
| Service lines & package calculator | `Patients.tsx` ClaimCard, `calculator.ts`, `CalculatorModule.tsx` |
| NS04/NS05 approvals + expiry tracking | `Approvals.tsx`, `analytics.ts` |
| Billing log & status funnel | `Billing.tsx`, `analytics.ts` |
| Decline tracking & turnaround | `Declines.tsx` |
| Complex case reviews | `ComplexCases.tsx` |
| Contract compliance + fix routing | `compliance.ts`, `Compliance.tsx` |
| ACC letter PDF import | `letterImport.ts`, `LetterImportModal.tsx` |
| Excel import/export | `excelImport.ts`, `ExportCenter.tsx` |
| Dashboard action queue | `Dashboard.tsx` |

### Missing vs real hospital ACC admin workflow

| Gap | Severity | Notes |
|-----|----------|-------|
| **Multi-user / handoff** | **Critical** | Covering leave, team queue — not supported |
| **ACC portal / email integration** | **High** | Manual PDF drag-drop only |
| **PO / approval renewal workflow** | **High** | Tracks expiry but no renewal task assignment |
| **Remittance / payment reconciliation import** | **High** | Manual invoice line status only |
| **Reporting for management** | **High** | Dashboard charts only; no PDF reports, no period close |
| **NHI / claim validation against ACC** | **Medium** | Local format checks only |
| **Travel (NS06) mileage capture** | **Medium** | Rate exists; no GPS/maps integration |
| **Subsequent injury workflow** | **Low** | Partial — calculator + claim type exist |
| **Integration with patient management / EMR** | **High** | Out of scope today |

### Letter import — production gaps

**What exists (`letterImport.ts`, `LetterImportModal.tsx`):**
- pdf.js text layer + lazy Tesseract OCR for scanned pages.
- Field confidence scores, blockers, auto-commit at 100% confidence.
- Duplicate detection via blob hash (`isDuplicateLetterImport`).
- Templates tested: `fixtures/approval-template.pdf`, `decline-template.pdf` (12 + 3 tests).

**Gaps:**
| Gap | Severity | Detail |
|-----|----------|--------|
| OCR accuracy unvalidated on real scans | **Critical** | Only 2 synthetic PDF fixtures in tests |
| No human review queue | **High** | Modal review per file — no "pending imports" inbox for supervisor |
| Auto-commit at 100% confidence risky | **High** | Wrong NHI/claim match could file silently |
| No batch import | **Medium** | One PDF at a time |
| Main-thread OCR blocks UI | **Medium** | No worker (see OPTIMIZATION_PLAN 1.9) |
| Letter corpus regression suite | **High** | Need anonymized real letters in CI |

---

## 7. Testing & release

### Current coverage

| Suite | Files | Tests | Scope |
|-------|-------|------:|-------|
| Unit | 6 files in `src/lib/*.test.ts` | **54** | Calculator, compliance rules, excel, letter parse, commit |
| Stress | `scripts/stress/stress.test.ts` | 22 benchmarks | Scale/timing at 500–2000 patients |
| E2E / UI | — | **0** | — |
| CI | — | **0** | No GitHub Actions |

**Not tested:**
- React modules (Dashboard, Patients, Billing, etc.)
- Store persistence / IDB round-trip
- Backup ZIP restore end-to-end
- Encryption enable/disable lifecycle
- Lock screen / idle timeout
- Corrupt file handling (dangerous path)
- OCR path
- Concurrent tab behavior

### Release process gaps

| Gap | Severity |
|-----|----------|
| No CI running `npm test` + `npm run stress` | **High** |
| No regression baseline for stress timings | **High** |
| No UAT checklist for hospital staff | **High** |
| No release notes / changelog discipline | **Medium** |
| Single-file deploy with no signature verification | **Medium** |

---

## 8. File / module reference map

| Concern | Primary files |
|---------|---------------|
| State & autosave | `src/state/store.ts` |
| IDB working copy | `src/lib/idb.ts` |
| File format & encryption | `src/lib/storage.ts`, `src/lib/crypto.ts` |
| Full backup | `src/lib/backup.ts`, `src/modules/ExportCenter.tsx` |
| Compliance | `src/lib/compliance.ts`, `src/modules/Compliance.tsx` |
| Dashboard / queue | `src/lib/analytics.ts`, `src/modules/Dashboard.tsx`, `src/App.tsx` |
| Letter import | `src/lib/letterImport.ts`, `src/components/LetterImportModal.tsx` |
| Lock / session | `src/components/LockScreen.tsx`, `src/App.tsx` |
| Settings / security | `src/modules/SettingsModule.tsx` |
| Stress benchmarks | `scripts/stress/stress.test.ts`, `scripts/stress/run-stress.mjs` |

---

## 9. Recommended path to production (phased)

### P0 — Blockers before any hospital pilot (1–2 weeks)

1. **Fix corrupt-load behavior** — never silently load sample data; show recovery UI with backup restore prompt.
2. **Clarify save model in UI** — distinguish "Autosaved to this browser" vs "Exported to file"; prompt daily export.
3. **Scheduled backup reminder** — weekly modal if `lastExportAt` > 7 days.
4. **Letter import: disable auto-commit** in production config; require explicit confirm always.
5. **Run OPTIMIZATION_PLAN Phase 0** — dashboard must be usable at office scale.

### P1 — Pilot-ready (1–2 months)

1. Audit log (append-only, local JSONL in IDB).
2. Stress + unit tests in CI.
3. Anonymized real-letter OCR regression corpus.
4. Global error boundary + export error reporting file staff can email IT.
5. Ops runbook (IDB wipe, restore from ZIP, passphrase reset = data loss).
6. Virtualized tables (Billing, Compliance).

### P2 — Hospital-wide (3–6 months)

1. Multi-user architecture decision (shared network drive + file lock, or lightweight server).
2. Role-based access.
3. Management reporting export.
4. UAT program with admin staff.

---

## 10. Top 10 production gaps (ranked by severity)

| Rank | Gap | Severity | Location / evidence |
|------|-----|----------|---------------------|
| 1 | **Silent data loss on corrupt IDB load** | Critical | `store.ts:404–409` → `sampleData()` |
| 2 | **Single-user only — no team workflow** | Critical | Architecture; no sync |
| 3 | **No audit trail** | Critical | No event log in `mutate()` |
| 4 | **Letter OCR untested on real scans; auto-commit risk** | Critical | `letterImport.ts:882–883`, 2 PDF fixtures |
| 5 | **Save model confusion (IDB vs exported file)** | High | `dirty` flag, `store.ts:290–292` |
| 6 | **No automated/scheduled backup** | High | Manual ExportCenter only |
| 7 | **No CI / regression gates** | High | No `.github/workflows`, stress manual |
| 8 | **No roles — shared passphrase model** | High | `SettingsModule.tsx` encryption |
| 9 | **Dashboard/action queue unusable at scale** | High | 10,917 items — stress report |
| 10 | **No ops runbooks or monitoring** | High | No docs, no logging |

---

*Assessment date: 2026-07-08. Complement with OPTIMIZATION_PLAN.md for performance remediation.*
