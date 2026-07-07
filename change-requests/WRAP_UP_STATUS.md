# Wrap-up status — MASTER_ROADMAP (2026-07-08)

## Summary

Engineering wrap-up pass completed implementable roadmap items without hospital/IT blockers. **`npm test`**, **`npm run build`**, and **`verify-build`** should pass before push.

**Production readiness (engineering estimate): ~78%**

| Area | % | Notes |
|------|---|--------|
| Data integrity & perf (P0–P2) | 95% | P2-005 skipped (no jank at 2k); P2-008 OCR worker deferred |
| Letter import (P5) | 85% | Real corpus blocked U-05; core UX + tests done |
| Platform (P3–P4) | 75% | RBAC/encryption ADR blocked U-07/U-03 |
| Compliance/billing (P6) | 95% | Export progress wired |
| Operations (P7) | 70% | Docs/checklists done; UAT + hardware sign-off pending |
| SUPER WFH (P8) | 40% | Phase 0 + Inbox stub; email/portal blocked |

---

## Completed this session

### P2 remainder
- **P2-006** Modal layout CSS (max-height, mobile padding)
- **P2-007** Patients grid stacks on mobile (`patients-layout-grid`)
- **P2-005** Marked skipped — stress <1 ms at 2k (await U-06)

### P4 (quick, no passphrase/RBAC)
- **P4-002** `userDisplayName` in Settings + audit entries
- **P4-005** 60s idle “Stay signed in” warning before lock
- **P4-006** Excel export audit (+ existing `.accdata` audit)
- **P4-007** Concurrent tab BroadcastChannel banner

### P5 remainder (verified in code + tests)
- **P5-002** Letter import button class + verify-build guards
- **P5-011–P5-033** Document kind, decline fields, view letter, discoverability card, extraction details, NS04 current row, OCR callout, billing hint, decline linkage, dashboard deep links, attach-only, ClaimCard import, global drop, re-extract, import history UI, commit integration tests, ENTRY_POINT hints, Billing entry removed

### P6
- **P6-009** Excel export progress bar (>2s)

### P7 remainder
- **P7-002** `docs/ops/letter-import.md`
- **P7-003** `src/lib/logger.ts` + Settings diagnostics download
- **P7-004** `docs/ops/deploy.md` (default static dist; U-01 variants blocked)
- **P7-005** `change-requests/UAT_CHECKLIST.md`
- **P7-006** `CHANGELOG.md`

### P8
- **P8-005** `automationPaused` setting + folder-watch `.automation-paused` flag
- **P8-016** ACC Inbox stub module + filter unit tests

### Packaging U-26
- `docs/templates/office-config.example.json`
- Settings export/import office config (settings-only)
- Copied to `dist/office-config.example.json` on build

---

## Blocked on user / IT

| Task | Blocker |
|------|---------|
| P4-001, P4-003 | U-07 multi-user ADR; U-12 RBAC roles |
| P4-004, P4-008 | U-03 encryption policy / passphrase runbook sign-off |
| P5-001 | U-05 anonymised letter corpus (10–30 PDFs) |
| P2-008 | P5-001 + OCR worker scope |
| P7-004 full | U-01 deployment target (MDM/Citrix) |
| P7-007 | U-18 hospital hardware perf sign-off |
| P7-008 | Playwright CI — harness deferred |
| P8-006, P8-017 | U-08 policy; work PC for email/COM |
| P8-009–P8-015, P8-019–P8-020 | U-09 portal-map.json; U-08; U-11 vault |
| P8-015 UAT | DHB privacy sign-off |

---

## Launcher

No changes to `launch.ps1` critical path (per `LAUNCHER_INCIDENT_REPORT.md`). Portal Discover `.cmd` already minimal (no `>> last-run.log` redirect).

---

## Next steps for hospital

1. Provide **U-05** letter corpus → enable P5-001 CI regression
2. Confirm **U-01** deploy path → finalize P7 pilot
3. Run **UAT_CHECKLIST.md** on work laptop (J-07, J-12–J-14)
4. Decide **U-07** / **U-03** → unblock P4 RBAC and encryption enforcement

---

*Generated 2026-07-08 wrap-up agent.*
