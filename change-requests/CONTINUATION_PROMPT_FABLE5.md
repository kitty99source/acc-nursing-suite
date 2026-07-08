# ACC District Nursing Admin Suite — Fable 5 Continuation Prompt

**Generated:** 2026-07-08  
**Workspace:** `/Users/prakritichhetri/ACCAdminsuite`  
**GitHub:** `kitty99source/acc-nursing-suite`  
**User:** Prakriti Chhetri — solo builder, hospital work laptop (Windows), PowerShell-only on work PC (no Node), Citrix VPN for portal  
**Purpose:** Expert handoff for a new Fable 5 chat — one cohesive pass to verify email sync, fix remaining bugs, polish UI/UX, and **never break launchers**.

---

## SECTION 1: Executive summary

### What the app is

**ACC District Nursing Admin Suite** is an offline-first, browser-based admin tool for district nursing teams managing ACC claims, approvals (NS04/NS05), declines, billing, compliance, and letter import. Data lives locally (IndexedDB + shared `.accdata` on hospital I: drive). PHI never leaves the work laptop unless the user exports.

**Core workflows today:**
- Manual **PDF/Word letter import** → confirm modal → save to patient/claim (no auto-commit in production)
- **Folder watch** (`ACC-Inbox/`) → `.staging/*.json` → **Human Review Queue** → manual sign-off
- **Outlook COM email sync** (PowerShell) → saves ACC attachments to `ACC-Inbox` → folder watch → HRQ
- **Portal discover** (Citrix VPN + CDP attach) → `portal-map.json` for future read-only portal tasks

**Deployment model (U-01 decided):** Copy built `dist/` to shared `I:\ACC-Suite\` or local Desktop; coworkers double-click `Start ACC Suite.cmd` (PowerShell TcpListener on `127.0.0.1:8765`). **No Node.js on work PC.** Dev Mac runs `npm test` → `npm run build` → `npm run verify-build` → zip `dist/`.

### Current % complete (engineering estimate)

| Area | % | Notes |
|------|---|--------|
| **Overall production readiness** | **~78%** | Per `WRAP_UP_STATUS.md` |
| Data integrity & perf (P0–P2) | 95% | P2-005 skipped (no jank at 2k); P2-008 OCR worker deferred |
| Letter import (P5) | 85% | Core UX + tests done; real corpus optional (U-05 synthetic OK) |
| Platform (P3–P4) | 75% | RBAC/encryption ADR blocked U-07/U-03 |
| Compliance/billing (P6) | 95% | Export progress wired |
| Operations (P7) | 70% | Docs/checklists done; UAT + hardware sign-off pending |
| **SUPER WFH (P8)** | **~40%** | Phase 0 folder watch + HRQ + probe PASS; email sync **may** work after `7cee0da` — **user not verified**; ACC Inbox still stub rows |

**Hospital pilot gate:** Phase B letter import ✅; Phase C Day 1 partial; Phase G folder watch next; Phase E I: drive deploy **last**.

---

## SECTION 2: Incident timeline — what went wrong, root causes, fixes shipped

Chronological summary of regressions and fixes. Commit refs from git history.

### A. Launcher regressions (2026-07-08 morning — ~22 minutes of bad commits)

| When | Commit | What broke | Root cause | Fix |
|------|--------|------------|------------|-----|
| 08:52 | `912dc81` | — | **Last known good** `launch.ps1` | Baseline |
| 09:04 | `79832ed` | ACC Suite console closes instantly; no visible error | Observability fused into startup critical path: outer `try/catch`, `$ErrorActionPreference = 'Stop'`, `throw` on missing index, **removed `pause` on error**, catch block **no `exit 1`** | `d44924c` restore minimal path |
| 09:13 | `71ec02a` | Same + worse on **I: drive** | **`>> last-run.log` redirect** to script dir on read-only mapped share — CMD fails **before PowerShell runs**; `ACC_LAUNCHER_DIR` + `Set-Location`; `launch-error.log` on network drive | `d44924c` removed redirect; logs → `%USERPROFILE%\ACC-Suite\logs\` only |
| 09:14 | `d44924c` | Partial restore | Emergency revert ACC Suite `.cmd` + `launch.ps1` | See `LAUNCHER_INCIDENT_REPORT.md` |
| Later | `42ef570`, `fdd4094`, `b2512dc`, `60826b7`, `ff50e50` | Portal Discover I: drive, Edge PATH, PS 5.1 parse, bootstrap log lock | Same class: writes to script dir, PS version quirks | Hardened bootstrap logging; user-profile logs only |

**Lesson:** Never write logs beside scripts on I: drive. Never `>> redirect` in `.cmd`. Optional logging must never block TcpListener bind. **No integration tests for launchers exist** — manual work-laptop validation required after any launcher change.

### B. Portal Discover — CDP / WebSocket failures (Windows PS 5.1)

| Issue | Root cause | Fix commit |
|-------|------------|------------|
| WebSocket CDP attach failed; tab-list fallback only | PS 5.1 WebSocket URL normalization; bogus `Add-Type` for `System.Net.WebSockets` | `0d56e99`, `c88216a` |
| Only folder chrome captured, not report grid | User stopped at Browse folder; D-09 grid needs opened report | Documented in `portal-samples/`; U-09 mostly complete |
| Partial capture treated as success | Script exited 0 on tab-list fallback | `c88216a` — exit non-zero when only fallback saved |

**Success:** `04f092d` — full WebSocket CDP harvest, 45 SSRS links, base URL `http://cl-biprddb02/Reports_MSREPORT/`.

### C. PDF.js worker failure in dist/ letter import

| Issue | Root cause | Fix commit |
|-------|------------|------------|
| Letter import failed on work laptop | `launch.ps1` returned `index.html` for **every** GET — browser could not load `pdf.worker.mjs` | `6832b74`, `56f1c51` — static file serving + verify-build HTTP check |

### D. Word import — mammoth browser API mismatch

| Issue | Root cause | Fix commit |
|-------|------------|------------|
| `.docx` import: "Could not find file in options" | Production bundle uses mammoth **browser** API (`arrayBuffer`); code passed Node-style `buffer` only | `0fe0c62` — pass `arrayBuffer`; `ec54920` wired UI picker |

**User has not re-verified Word import on work laptop after `0fe0c62`.**

### E. Email sync — zero-save / no matches

| Issue | Root cause | Fix commit |
|-------|------------|------------|
| Probe PASS but sync saves 0 attachments | Wrong mailbox (personal vs shared) | `b24cb04` — default `ACCDistrictNursing` |
| `email-sync-status.json` never appeared | Writer/validator mismatch, BOM, wrong checkpoint file | `a57dab5`, `bff0da7` |
| John Bentley emails not matching | `office-config` `accInboxSubjectPatterns` **overwrote** merged patterns and **dropped** `Claim:`/`ACCID:` | **`7cee0da`** — merge both config sources |
| ACC Inbox showed demo stubs / confusing empty state | Stub rows flashed before sync load; zero-save looked like "no sync" | `224786a` |
| WFH mode unreliable | Missing mailbox-config, PS 5.1 `New-EmptySyncState` | `a682ba8`, `bff0da7` |

**Latest fix `7cee0da` is the critical subject-pattern merge — user has NOT end-to-end verified email sync saves real attachments yet.**

### F. ACC Inbox stub UX

| Issue | Status |
|-------|--------|
| Panel shows stub/demo rows until real sync populates `savedFiles` | Partial fix `224786a`; **real Outlook rows not wired** — P8-017 incomplete |
| J-27 UAT: "loading stub messages" | Expected until COM bridge feeds real rows |

### G. WFH mode issues

| Issue | Root cause | Fix |
|-------|------------|-----|
| Needed Node on dev Mac for real PHI | Architecture wrong for hospital | `c880d88` — PowerShell `folder-watch.ps1` on work laptop |
| `Start WFH Mode.cmd` missing / broken | Email sync launcher errors | `a682ba8` — ships all-in-one: ACC Suite + folder watch + one email sync run |
| Auto-sync outside work hours | U-08 policy | Work-hours gating in `outlook-sync.ps1`; `-IgnoreWorkHours` for IT tests |

### H. Folder watch / HRQ (resolved path)

| Milestone | Commit |
|-----------|--------|
| PowerShell folder watch for work laptop | `c880d88` |
| Review Queue + staging import | P8-002 (prior session) |
| User requirement: all patient data on work laptop | Documented in `SIMPLE_PILOT_GUIDE.md` Phase G |

---

## SECTION 3: What WORKS on work laptop today (user confirmed)

Prakriti confirmed on hospital Windows work laptop:

| Capability | Status | Evidence |
|------------|--------|----------|
| **PDF letter import** (approval + decline) | ✅ Pass | Phase B UAT |
| **Outlook COM probe** | ✅ PASS | `Start Email Probe.cmd` — unread count, last 3 subjects |
| **WFH mode starts** | ✅ | `Start WFH Mode.cmd` launches without instant exit |
| **Folder watch** | ✅ | `Start Folder Watch.cmd` stages PDF/.docx → `.staging/*.json` |
| **Shared mailbox identified** | ✅ | Log shows **`Using mailbox: ACCDistrictNursing`** |
| **Real email format recognized** | ✅ | From `John.Bentley@acc.co.nz`; subject pattern **`Claim:` + `ACCID:`** (e.g. `Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655`) |
| **Portal map captured** | ✅ | 45 SSRS links; VPN + manual login workflow |
| **ACC Inbox module loads** | ✅ | Stub messages visible (J-27) |
| **Day 1 UAT partial** | ✅ | J-01, J-01a, J-01b, J-04, J-05, J-23 Pass |

**Not yet confirmed after latest builds:**
- Email sync actually **saves attachments** to `ACC-Inbox` (post-`7cee0da`)
- Word `.docx` import on production bundle (post-`0fe0c62`)
- Full HRQ end-to-end from email sync → folder watch → Review Queue → save
- 10k backlog incremental sync completion

---

## SECTION 4: OPEN BLOCKERS (prioritized)

### P0 — Must verify or fix next session

| ID | Blocker | Notes |
|----|---------|-------|
| **P0-EMAIL** | Email sync may work after `7cee0da` but **user hasn't verified** end-to-end | Run `Start Email Sync.cmd` → confirm files in `ACC-Inbox` → folder watch → HRQ → import → save. Use `Start Email Diagnose.cmd` if zero-save persists. |
| **P0-WORD** | Word import mammoth fix `0fe0c62` — **not re-tested on work laptop** | Rebuild dist, test `approval-template.docx` and real ACC Word letter. |
| **P0-INBOX** | ACC Inbox shows **stub rows**, not real email rows from sync | Wire `AccInbox.tsx` to `email-sync-status.json` `savedFiles` + parsed metadata; remove demo stubs when real data present. |

### P1 — Important before pilot sign-off

| ID | Blocker | Notes |
|----|---------|-------|
| **P1-BACKLOG** | **~10k email backlog** incremental sync | `outlook-sync.ps1` checkpoint + batch (default 50/run, work hours 7am–6pm NZ). User must repeat sync until log shows **saved 0**. |
| **P1-UAT** | Day 1 "lazy" rows + all Day 2 journeys blank | J-02, J-03, J-06, J-07–J-15, J-22, J-25/J-26 |
| **P1-LAUNCHER** | Zero automated launcher regression tests | Any launcher edit = manual work-laptop smoke: ACC Suite, Folder Watch, Email Probe, Email Sync, WFH Mode, Portal Discover |

### P2 — After core path green

| ID | Blocker | Notes |
|----|---------|-------|
| **P2-DEPLOY** | **Phase E I: drive deploy last** | Only after automation UAT + fresh verified `dist/` zip |
| **P2-UX** | UI/UX polish opportunity | Modal layout, ACC Inbox empty states, Review Queue clarity, dd/mm/yyyy consistency, discoverability |
| **P2-PORTAL** | Portal read task (P8-010) | Needs opened report grid capture (D-09); CDP attach on VPN |
| **P2-CORPUS** | U-05 real letter corpus optional | Synthetic fixtures proceed; real PDFs improve OCR confidence |

---

## SECTION 5: Architecture constraints (NON-NEGOTIABLE)

1. **`dist/` only on work laptop** — no `npm`, no Node, no git on hospital PC. All automation via PowerShell `.cmd` + `.ps1` copied on build.
2. **PowerShell launchers** — `Start ACC Suite.cmd` uses TcpListener on `127.0.0.1:8765` (NOT HttpListener). Keep black window open while using app.
3. **Logs → `%USERPROFILE%\ACC-Suite\logs\` ONLY** — never write beside scripts on I: drive; never `>> redirect` in `.cmd`.
4. **Graphify rules** — run `graphify query/path/explain` before Read/Grep exploration; `graphify update .` after code changes.
5. **End every assistant response with `Teehee`** on its own line (workspace rule).
6. **No Node on work PC** — folder watch, email sync, portal discover = PowerShell; Node scripts (`scripts/wfh/*.mjs`) are dev/Mac testing only.
7. **PHI stays local** — attachments → `ACC-Inbox` → staging → HRQ → manual confirm → live store. No cloud sync, no screenshot OCR for email, no LLM parsing.
8. **Manual review before save** — `autoCommit` disabled in production (`P0-005`). Automation never calls `mutate()` on live data without HRQ sign-off.
9. **Working hours only** (U-08) — email sync 7am–6pm NZ; no overnight daemon unless user explicitly changes policy.
10. **Shared mailbox** — default `ACCDistrictNursing`, not personal inbox.
11. **Email filter** — senders: `Bec.Williams@acc.co.nz`, `John.Bentley@acc.co.nz`, `Becky.Tunnell@acc.co.nz`; subject must contain **`Claim:`** AND **`ACCID:`**; PDF/DOCX attachments.
12. **Citrix/VPN** — for portal only; ACC mail is **local Outlook desktop**, not Citrix.
13. **Do not break launchers** — read `LAUNCHER_INCIDENT_REPORT.md` before touching `scripts/launcher/`.
14. **Commit only when user asks** — this handoff task commits this file only.

---

## SECTION 6: FILES TO READ FIRST (ordered)

| Order | File | Why |
|-------|------|-----|
| 1 | `change-requests/CONTINUATION_PROMPT_FABLE5.md` | This handoff (you are here) |
| 2 | `change-requests/LAUNCHER_INCIDENT_REPORT.md` | Mandatory before any launcher edit |
| 3 | `change-requests/SIMPLE_PILOT_GUIDE.md` | Work-laptop steps Phases G, H, I, E |
| 4 | `scripts/launcher/README.txt` | Launcher inventory + log paths |
| 5 | `scripts/launcher/outlook-sync.ps1` | Email sync filters, checkpoint, work-hours |
| 6 | `scripts/launcher/outlook-probe.ps1` | COM probe (read-only baseline) |
| 7 | `scripts/launcher/launch.ps1` | Static serve + port 8765 — do not regress |
| 8 | `src/modules/AccInbox.tsx` | Stub → real rows wiring target |
| 9 | `src/lib/emailSyncStatus.ts` | Status JSON schema + loader |
| 10 | `src/lib/letterImport.ts` | PDF/Word parse; mammoth `arrayBuffer` |
| 11 | `src/modules/ReviewQueue.tsx` | HRQ import from `.staging` |
| 12 | `change-requests/EMAIL_AUTOMATION_FEASIBILITY.md` | COM-first architecture |
| 13 | `change-requests/EMAIL_PORTAL_ARCHITECTURE.md` | Filter rules §6c, phasing |
| 14 | `change-requests/WRAP_UP_STATUS.md` | Done vs blocked snapshot |
| 15 | `change-requests/USER_INPUTS_NEEDED.md` | U-01–U-08 decisions |
| 16 | `docs/templates/office-config.example.json` | Sender/subject/mailbox config |
| 17 | `scripts/verify-build.mjs` | Build guards (CSP, worker, bundle) |

**Graphify entry points:** `graphify query "letter import email sync portal launcher"`

---

## SECTION 7: THE CONTINUATION PROMPT (copy-paste for new Fable 5 chat)

```
You are a senior full-stack engineer + UX specialist working under hospital IT constraints for the ACC District Nursing Admin Suite.

## Context
- Repo: kitty99source/acc-nursing-suite (local: /Users/prakritichhetri/ACCAdminsuite)
- User: Prakriti Chhetri, solo builder
- Work laptop: Windows, PowerShell-only (NO Node.js), Outlook desktop, Citrix VPN for portal
- Deployment: dist/ zip → work laptop → Start ACC Suite.cmd (127.0.0.1:8765)
- Production readiness ~78%; SUPER WFH ~40%

## READ FIRST (mandatory)
1. change-requests/CONTINUATION_PROMPT_FABLE5.md (full handoff)
2. change-requests/LAUNCHER_INCIDENT_REPORT.md (before ANY launcher change)
3. change-requests/SIMPLE_PILOT_GUIDE.md (Phases G, H, I)
4. Run: graphify query "letter import email sync portal launcher"

## Mission — ONE cohesive pass
Verify email sync end-to-end on work laptop, fix remaining bugs, polish UI/UX where it helps the pilot, and DO NOT break launchers.

Priority order:
1. P0: Verify email sync saves real attachments after commit 7cee0da (subject pattern merge)
2. P0: Verify Word .docx import after 0fe0c62 on production dist/
3. P0: Replace ACC Inbox stub rows with real rows from email-sync-status.json savedFiles
4. P1: Confirm incremental 10k backlog sync (repeat Start Email Sync.cmd until saved 0)
5. P1: HRQ full path: email → ACC-Inbox → folder watch → Review Queue → letter import → save
6. P2: UI/UX polish (empty states, labels, Review Queue clarity) — minimal diff
7. P2: Phase E I: drive deploy LAST — only after above verified

## Step-by-step workflow
1. graphify query/path/explain BEFORE exploring with Read/Grep
2. Read files in CONTINUATION_PROMPT_FABLE5.md Section 6 order
3. Reproduce on dev: npm test → npm run build → npm run verify-build
4. Fix with minimal scope — match existing conventions
5. graphify update . after code changes
6. Never touch launch.ps1 critical path without reading LAUNCHER_INCIDENT_REPORT.md
7. Copy-launcher: scripts/copy-launcher.mjs runs on build — edit scripts/launcher/, not dist/ directly
8. Document work-laptop test steps in SIMPLE_PILOT_GUIDE if behavior changes
9. Commit only when user asks

## What already WORKS (user confirmed — do not regress)
- PDF approval + decline import
- Outlook COM probe PASS (ACCDistrictNursing mailbox)
- Start WFH Mode.cmd starts
- Folder watch stages to .staging/
- Real email format: John.Bentley@acc.co.nz, subject Claim: + ACCID:

## Acceptance criteria checklist
- [ ] Start Email Sync.cmd saves ≥1 real .pdf or .docx to %USERPROFILE%\ACC-Inbox\ on work laptop
- [ ] email-sync-status.json written; ACC Inbox loads it (auto or Load sync report)
- [ ] ACC Inbox shows real saved file rows — NOT demo stubs when sync data exists
- [ ] Folder watch picks up synced files → Review Queue import → letter parses → manual save works
- [ ] Word import: approval-template.docx parses same fields as PDF
- [ ] npm test + npm run build + npm run verify-build all pass
- [ ] Launchers unchanged OR validated on Windows: ACC Suite, Folder Watch, Email Probe, Email Sync, WFH Mode
- [ ] No logs written beside scripts on I: drive
- [ ] autoCommit remains false in production; no silent mutate() from automation
- [ ] End every assistant response with Teehee on its own line

## Anti-patterns (from incident report — NEVER)
- Do NOT add >> last-run.log redirect to .cmd files
- Do NOT write logs to script directory on I: drive
- Do NOT fuse observability into launcher startup critical path (optional logging only)
- Do NOT remove pause on error from .cmd wrappers
- Do NOT use throw without exit 1 on fatal launcher errors
- Do NOT return index.html for all HTTP paths — static assets must serve (pdf.worker.mjs)
- Do NOT overwrite accInbox subject patterns — merge Claim:/ACCID: from all config sources
- Do NOT assume personal inbox — default shared mailbox ACCDistrictNursing
- Do NOT ship Node-dependent steps for work laptop production path
- Do NOT auto-commit parsed letters — HRQ sign-off required
- Do NOT run portal automation without VPN + manual login (no stored VPN passwords)

## User inputs still needed
- B-11: IT confirmation of Outlook programmatic access (probe PASS suggests OK)
- B-04–B-07: Confirm ACC sender list + subject patterns (defaults in architecture doc)
- U-05: Real anonymised letter corpus (optional — synthetic OK for pilot)
- U-18: Hospital hardware perf sign-off (Day 2 UAT)
- D-09: Opened portal report grid capture (optional — columns documented)
- Self-sign-off: fill UAT_CHECKLIST.md Day 1 lazy rows + Day 2

## Suggested first message from user
"I have fresh dist/ on work laptop. Probe PASS. Ready to verify email sync end-to-end per CONTINUATION_PROMPT_FABLE5.md."
```

---

## SECTION 8: Suggested first commands on work laptop (after next build)

Copy fresh `dist/` from dev Mac (`npm test && npm run build && npm run verify-build` → zip → USB/OneDrive).

**Order of operations:**

```batch
REM 1 — Smoke: main app
Start ACC Suite.cmd
REM Keep window open; browser at http://127.0.0.1:8765

REM 2 — Smoke: COM still works
Start Email Probe.cmd
REM Expect: Using mailbox: ACCDistrictNursing ... PASS

REM 3 — Diagnose if sync had zero-save before
Start Email Diagnose.cmd
REM Read-only filter breakdown — no attachments saved

REM 4 — One sync batch (work hours 7am–6pm NZ)
Start Email Sync.cmd
REM Check log: %USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log
REM Expect: scan breakdown + saved N attachments (N > 0 if backlog exists)

REM 5 — Watch folder + stage
Start Folder Watch.cmd
REM Confirm [staged] lines for new files in ACC-Inbox

REM 6 — Or all-in-one
Start WFH Mode.cmd
REM ACC Suite + folder watch + one email sync run

REM 7 — In app
REM ACC Inbox → Load sync report (or auto-load)
REM Review Queue → Import ACC-Inbox .staging folder
REM Review & import → confirm → Save

REM 8 — Word test
REM Approvals → Import ACC letter (PDF or Word) → approval-template.docx
```

**Log locations (support):**
- `%USERPROFILE%\ACC-Suite\logs\email-sync-bootstrap.log`
- `%USERPROFILE%\ACC-Suite\logs\folder-watch-bootstrap.log`
- `%USERPROFILE%\ACC-Suite\email-sync-status.json`
- `%USERPROFILE%\ACC-Suite\email-sync-state.json` (checkpoint)

**If zero-save persists after `7cee0da`:**
1. Check `office-config.json` — subject patterns must include `Claim:` and `ACCID:`
2. Confirm sender `John.Bentley@acc.co.nz` in allowlist
3. Confirm emails are in **ACCDistrictNursing**, not personal inbox
4. Run `Start Email Diagnose.cmd` — send log file only (not screenshot — PHI in subjects)

---

*Handoff generated 2026-07-08. Engineering agent: do not implement fixes in the handoff task — continuation agent owns verification + fixes.*

Teehee
