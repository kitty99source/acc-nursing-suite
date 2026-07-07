# Stress Test Report

**Generated:** 2026-07-07T17:42:47.473Z
**Scale:** medium

## What was run

1. `scripts/stress/generate-mock-data.mjs` — synthetic AppData (not committed to sampleData)
2. `scripts/stress/stress.test.ts` via `vitest.stress.config.ts`
3. Timings written to `scripts/stress/out/report.json`

### Fixture counts

| Entity | Count |
|--------|------:|
| patients | 500 |
| claims | 750 |
| serviceLines | 2000 |
| approvals | 224 |
| invoiceLines | 3000 |
| declines | 80 |
| complexCases | 40 |
| documents | 100 |
| importHistory | 200 |

**Fixture size:** 1.52 MB JSON

## Timings

| Benchmark | Time | Threshold | Pass | Notes |
|-----------|-----:|----------:|:----:|-------|
| runCompliance | 11.7ms | 3.00s | ✓ | violations=463 warnings=721 |
| dashboardMetrics | 13.2ms | 2.00s | ✓ |  |
| buildActionQueue | 91.0ms | 2.50s | ✓ | n=2581 |
| billingFunnel | 4.0ms | 500.0ms | ✓ |  |
| coverageGapClaims | 10.6ms | 1.00s | ✓ | n=185 |
| patientsPage1 | 0.5ms | 50.0ms | ✓ |  |
| patientsPageMid | 0.0ms | 50.0ms | ✓ |  |
| patientsSearch | 0.4ms | 200.0ms | ✓ |  |
| patientsLastPage | 0.0ms | 50.0ms | ✓ |  |
| determinePackage×500 | 2.8ms | 500.0ms | ✓ | n=500 |
| serialize | 24.2ms | 1.50s | ✓ | 2.26 MB |
| deserialize | 9.8ms | 2.00s | ✓ |  |
| buildWorkbookBuffer | 520.8ms | 15.00s | ✓ | 0.19 MB |
| buildBackupZip | 67.5ms | 15.00s | ✓ |  |
| readBackupZip | 38.7ms | 10.00s | ✓ | 0.15 MB zip |
| importHistorySort | 0.0ms | 100.0ms | ✓ | n=200 |
| extractPdfText(approval) | 100.8ms | 3.00s | ✓ |  |
| parseApprovalLetter | 0.9ms | 500.0ms | ✓ |  |
| extractPdfText(decline) | 34.0ms | 3.00s | ✓ |  |
| parseLetterFromText(decline) | 1.6ms | 1.00s | ✓ |  |
| isDuplicateLetterImport×100 | 10.3ms | 3.00s | ✓ |  |
| prefillFromParsed | 0.1ms | 50.0ms | ✓ |  |

## Summary

- **Benchmarks:** 22 total, 22 passed, 0 over threshold

### Slowest

- buildWorkbookBuffer: 520.8ms
- extractPdfText(approval): 100.8ms
- buildActionQueue: 91.0ms
- buildBackupZip: 67.5ms
- readBackupZip: 38.7ms

## Pain points

No thresholds breached at this scale.

## Recommendations (prioritized)

- **P1 — Dashboard UX:** Action queue produced 2,581 items — paginate, cap, or group by severity before render.
- **P2 — Patients UI:** Virtualize patient list or memoize claim cards — pagination helps list shell but detail panes still load all claim data.
- **P3 — Eval loop:** Wire stress report.json into a Ralph-style loop: agent reads failures → patches → re-runs npm run stress until thresholds pass.

## Automated looping eval — gap analysis

Current suite is **one-shot stress measurement**, not a closed eval loop. To convert:

1. Persist `report.json` + pain points as machine-readable eval output
2. Add a completion promise / exit code when all thresholds pass
3. Wrap in Ralph-style hook: agent reads report → implements fix → `npm run stress` → repeat
4. Optionally add Playwright for UI pagination/render timings (not covered here)
