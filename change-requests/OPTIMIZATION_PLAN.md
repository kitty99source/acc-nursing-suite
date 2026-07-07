# Optimization Plan — ACC Admin Suite (Hospital Scale)

**Audience:** Engineering / product — real district-nursing admin office use (2,000+ patients, 12,000 invoice lines, daily dashboard + compliance workflows).

**Evidence base:**
- `change-requests/STRESS_TEST_REPORT.md` (large scale, 2026-07-07)
- `scripts/stress/stress.test.ts` benchmarks
- Code paths: `src/lib/analytics.ts`, `src/lib/compliance.ts`, `src/modules/Dashboard.tsx`, `src/App.tsx`, `src/state/store.ts`, `src/lib/idb.ts`

---

## Executive summary

At **large scale** (2,000 patients / 12,000 invoice lines), all 22 stress benchmarks **pass** but two paths sit at **>75% of threshold** and the dashboard produces **10,917 action-queue items**. The dominant cost is **repeated full-dataset scans** — especially `runCompliance()` invoked multiple times per UI tick, nested inside `buildActionQueue()`, plus O(n×m) linear searches in `coverageGapClaims()` and invoice-line loops.

Patients list pagination is **already fast** (<1 ms). The next wins are deduplicating compliance work, indexing hot joins, and capping/virtualizing unbounded UI lists — not rewriting the app.

---

## Stress baseline (numbers to beat)

| Benchmark | Large (2k patients) | Threshold | % of threshold | Notes |
|-----------|--------------------:|----------:|---------------:|-------|
| `buildActionQueue` | **2.04 s** | 2.50 s | **82%** | n=10,917 items |
| `dashboardMetrics` | **1.24 s** | 2.00 s | 62% | includes `coverageGapClaims` |
| `coverageGapClaims` | **934 ms** | 1.00 s | **93%** | n=1,108 gaps |
| `runCompliance` | 105 ms | 3.00 s | 4% | 6,684 findings — cheap alone, expensive when ×3–5 |
| `serialize` (autosave) | 64 ms | 1.50 s | 4% | **10.27 MB** JSON |
| `buildWorkbookBuffer` | 1.99 s | 15.00 s | 13% | export-only |
| Patients pagination | <1 ms | 50 ms | ✓ done | |

**Medium baseline (500 patients):** 2,581 action-queue items, 1,208 compliance findings, 1.5 MB fixture — useful regression floor.

---

## Root-cause map (verified in code)

### 1. Triple (or more) compliance scans per render

| Call site | File | Trigger |
|-----------|------|---------|
| `useMemo(() => runCompliance(data))` | `Dashboard.tsx:58` | Every `data` change on dashboard |
| `runCompliance(data)` inside `buildActionQueue` | `analytics.ts:325` | Same tick as above |
| `complianceSummary(runCompliance(data))` | `App.tsx:153` | Sidebar badges on every `data` change |
| `useMemo(() => runCompliance(data))` | `Compliance.tsx:27` | Compliance module |
| `useMemo(() => runCompliance(data))` | `Patients.tsx:318` | Patient detail pane |

**Impact:** `runCompliance` is ~105 ms once at large scale; **3–5× per navigation/edit ≈ 315–525 ms** of avoidable CPU, plus GC pressure from 6,684-finding arrays.

### 2. `buildActionQueue` — O(n²) joins + full compliance

```219:342:src/lib/analytics.ts
// Loops ALL invoiceLines (12k) with claims.find() per row
// Calls coverageGapClaims(data) — scans claims × serviceLines × approvals
// Calls runCompliance(data) — full engine again
```

- **10,917 items** at large scale — mostly billing/remittance rows (12k invoice lines × status filters).
- UI caps scroll at `max-h-72` but still **builds and sorts the full array**.

### 3. `coverageGapClaims` — unindexed nested filters

```35:47:src/lib/analytics.ts
for (const claim of data.claims) {
  const lines = data.serviceLines.filter((s) => s.claimId === claim.id);  // O(S) per claim
  const current = data.approvals.some(...);  // O(A) per claim
}
```

**934 ms** at 3,600 claims — classic O(C×S + C×A). `runCompliance` already builds `linesByClaim` / `approvalsByClaim` maps (`compliance.ts:350–361`) but analytics does not reuse them.

### 4. Unbounded table DOM (Approvals / Billing / Declines / Compliance)

`DataTable` (`src/components/DataTable.tsx`) renders **all** sorted rows into `<tbody>` with scroll only via `maxHeight`. At 12k invoice lines (Billing) or 6k+ compliance findings, **layout and reconciliation cost is uncapped** — not measured by stress suite (engine-only).

### 5. Autosave serializes full AppData

`store.ts` → `persistAll` → `serialize(data)` writes **entire 10.27 MB JSON** to IndexedDB every **1 s debounce** after any mutation. Document blobs are correctly split (`idb.ts` DOC_STORE), but metadata arrays (invoice lines, import history, etc.) are inline.

### 6. Letter import (secondary)

Stress suite: PDF extract ~108–308 ms, parse <10 ms, duplicate scan ×100 = 30 ms — **not a bottleneck today**. OCR path (`letterImport.ts` Tesseract lazy load) is **unbenchmarked** and can block the main thread for scanned PDFs.

---

## Phase 0 — Quick wins (<1 day each)

| # | Item | Work | Expected impact | Tie to stress report |
|---|------|------|-----------------|----------------------|
| 0.1 | **Single compliance cache per tick** | Add `getComplianceFindings(data)` with ref-based memo keyed on `data` reference + optional version stamp in store; replace direct `runCompliance` calls in Dashboard, App badges, PatientDetail | **−200–400 ms** perceived dashboard refresh; eliminates 2–4 redundant 105 ms scans | Root cause of `buildActionQueue` slowness (compliance nested inside) |
| 0.2 | **Pass cached findings into `buildActionQueue`** | Change signature to `buildActionQueue(data, findings?)`; filter violations from cache instead of re-running engine | **`buildActionQueue` −100 ms+** (compliance portion); drops 82% → ~60% of threshold | Report: "cache findings or incremental diff" |
| 0.3 | **Cap action queue for display** | Return full count for badge; render **top 50 by severity** + "Show all in Compliance/Billing" links | **DOM/React −90%** for 10k items; instant scroll | Report: "paginate, cap, or group — 10,917 items" |
| 0.4 | **Pre-index maps in analytics hot paths** | Build once per call: `patientsById`, `claimsById`, `claimsByNumber`, `linesByClaimId`, `approvalsByClaimId`, `currentBillingApprovalByClaimId` | **`coverageGapClaims` −60–80%** (~934 ms → **<300 ms**); faster invoice loops in action queue | 93% of threshold |
| 0.5 | **Lightweight sidebar badges** | Replace `buildActionQueue` in `App.tsx:130` with cheap counters (already partially done for approvals/billing/declines); use cached compliance summary only | **−2 s** on every data change when badges recompute | Hidden multiplier on every edit |
| 0.6 | **Debounce autosave for bulk edits** | Increase debounce to 3–5 s during Excel import; or `pauseAutosave()` flag during batch mutations | Fewer **64 ms × N** serialize writes during imports | 10.27 MB × rapid edits = UI jank |
| 0.7 | **Compliance page: paginate groups** | Show first 50 patient/claim groups; lazy-load rest | Unblocks Compliance UI at 6,684 findings | Not in stress suite; real UX cliff |

**Phase 0 target:** `buildActionQueue` **<1.2 s**, `coverageGapClaims` **<400 ms**, dashboard mount **<800 ms** at large scale.

---

## Phase 1 — Structural improvements (3–10 days each)

| # | Item | Work | Expected impact | Tie to stress report |
|---|------|------|-----------------|----------------------|
| 1.1 | **Derived-index layer in store** | Maintain inverted indexes on CRUD (`linesByClaimId`, etc.) via `mutate()` — invalidated incrementally | All analytics/compliance **O(n)** not O(n²); amortized on writes | Enables scale beyond 2k patients |
| 1.2 | **Incremental compliance** | Track `dirtyClaimIds` on mutate; re-run rules only for affected claims + global rules; merge into cached finding list | **`runCompliance` −70–90%** on single-claim edits (typical daily op) | Medium: 1,208 findings; large: 6,684 |
| 1.3 | **Virtualize `DataTable`** | `@tanstack/react-virtual` or windowed rows for Billing (12k), Compliance (6k+), Approvals (1k+) | **Render <16 ms** regardless of row count; fixes unmeasured UI jank | Report P2 Patients UI — same pattern |
| 1.4 | **Split action queue by kind** | Separate builders: `buildApprovalActions`, `buildBillingActions`, lazy-load billing tab | Billing portion (largest) only computed when expanded | 10k items mostly `kind: 'billing'` |
| 1.5 | **Persist compliance snapshot in IDB** | Store `{ findings, dataHash, computedAt }` beside working copy; validate hash on load | **Instant dashboard** on cold start until first edit | 10 MB deserialize already 54 ms |
| 1.6 | **Trim autosave payload** | Move `importHistory` (already capped at 20 in `store.ts:313`) to separate IDB key; strip redundant denormalized fields from working copy | **Serialize −20–40%** bytes; faster IDB writes | Report: "split import history from autosave" |
| 1.7 | **Memoize `dashboardMetrics`** | Share indexes with action queue; avoid duplicate `coverageGapClaims` (called in metrics **and** action queue) | **`dashboardMetrics` −30–50%** (1.24 s → **<800 ms**) | Second slowest benchmark |
| 1.8 | **Patient detail: claim-scoped findings** | Filter cached findings by `patientId` instead of `runCompliance(data)` | Patient view edits don't trigger full scan | Patients hotspot (detail pane) |
| 1.9 | **Letter import: Web Worker OCR** | Move `extractPdfText` + Tesseract to worker; main-thread progress only | Scanned PDF import stays responsive | Gap: OCR unbenchmarked |
| 1.10 | **Stress CI gate** | Add `npm run stress:large` to CI with exit code 1 on threshold breach; commit baseline `report.json` | Prevents regressions | STRESS_TEST_AND_LOOPING.md gap |

**Phase 1 target:** All benchmarks **<50% of threshold** at large scale; Compliance/Billing pages usable at 12k rows.

---

## Phase 2 — Scale architecture (only if Phase 0–1 insufficient)

| # | Item | When needed | Approach |
|---|------|-------------|----------|
| 2.1 | **Web Worker analytics engine** | Dashboard still >1 s after Phase 1 | Run `buildActionQueue` + `dashboardMetrics` off main thread; postMessage results |
| 2.2 | **Chunked / normalized IDB schema** | Working copy >20 MB or autosave >200 ms | Replace monolithic JSON with entity stores (patients, claims, invoiceLines) + migrations |
| 2.3 | **Materialized "office dashboard" view** | Daily open must be <200 ms | Nightly or on-save precompute stats to IDB |
| 2.4 | **Streaming Excel export** | `buildWorkbookBuffer` >5 s at growth | Stream rows; defer styling (currently 1.99 s — not urgent) |
| 2.5 | **Optional SQLite WASM** | Multi-year retention, complex ad-hoc queries | Replace in-memory AppData for read-heavy paths; major refactor |

**Trigger for Phase 2:** Stress thresholds breached at **3,000+ patients** OR autosave >500 ms OR dashboard Time-to-Interactive >3 s on hospital mini-PC hardware.

---

## Expected impact summary

| Optimization | Metric | Before (large) | After (est.) |
|--------------|--------|----------------|--------------|
| Compliance dedup + cache | CPU per edit | 315–525 ms (×3–5 scans) | **105 ms once** |
| Indexed `coverageGapClaims` | Benchmark | 934 ms (93%) | **<300 ms (<30%)** |
| Cached findings in action queue | `buildActionQueue` | 2.04 s (82%) | **<1.0 s (<40%)** |
| Queue cap + badge slimming | DOM nodes | 10,917 buttons built | **≤50 visible** |
| Virtualized Billing table | Render (unmeasured) | 12k `<tr>` | **~30 visible** |
| Trim autosave payload | Serialize size | 10.27 MB | **~7 MB** |

---

## What NOT to optimize yet

| Area | Why defer |
|------|-----------|
| **`determinePackage` / calculator** | 1.8 ms ×500 — 0.4% of budget |
| **`billingFunnel`** | 4 ms — trivial |
| **Patients list pagination** | **Done** — 0.1 ms page 1 |
| **`buildWorkbookBuffer` export** | 1.99 s / 15 s threshold — export is infrequent; add progress bar instead |
| **`buildBackupZip` / `readBackupZip`** | 656 ms / 242 ms — acceptable for manual backup |
| **Letter parse (text-layer PDFs)** | 3–7 ms parse; optimize OCR only after real scanned-letter corpus |
| **Recharts dashboard charts** | Not in stress suite; profile only if charts lag after compliance fix |
| **Full backend / multi-user sync** | Architectural change — see PRODUCTION_READINESS.md; not a perf patch |
| **Rewriting compliance rules** | Correctness risk; incremental scan wraps existing engine |
| **Ralph eval loop** | Process improvement (STRESS_TEST_AND_LOOPING.md P3) — not user-facing perf |

---

## Verification plan

1. **Before/after:** `npm run stress:large` — track `buildActionQueue`, `coverageGapClaims`, `dashboardMetrics` in `scripts/stress/out/report.json`.
2. **Regression floor:** Keep medium (500 patient) run under 2 s total suite time.
3. **UI (add):** Playwright smoke — dashboard mount, Billing scroll, Compliance filter with 2k fixture.
4. **Real hardware:** Test on hospital-issue laptop (8 GB RAM, spinning disk or older Chrome) — stress suite runs in Node, not representative of DOM.
5. **Acceptance SLA (proposed):**
   - Dashboard interactive **<2 s** at 2k patients after Phase 0
   - Single-field edit → UI responsive **<100 ms** (compliance incremental in Phase 1)
   - Billing table scroll **60 fps** with 12k rows after virtualization

---

## Implementation order (recommended sprint)

```
Week 1: 0.1 → 0.2 → 0.4 → 0.5 → 0.3  (dashboard usable)
Week 2: 0.7 → 1.3 → 1.7 → 1.8        (tables + metrics)
Week 3: 1.1 → 1.2 → 1.6 → 1.10       (incremental + CI)
```

---

*Generated from stress report 2026-07-07 and codebase analysis 2026-07-08.*
