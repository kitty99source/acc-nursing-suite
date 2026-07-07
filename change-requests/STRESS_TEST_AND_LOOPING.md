# Stress Testing vs "Looping" AI (2025–2026)

**Context:** ACC Admin Suite offline billing tool — evaluating whether a comprehensive stress-test plan aligns with current "looping" agent trends, and what would be needed to close the gap.

---

## What "looping" means in AI/agent trends (2025–2026)

"Looping" in current discourse refers to **autonomous iterative agent execution**, not load testing. Three overlapping meanings:

| Pattern | What it is | Examples |
|---------|------------|----------|
| **Agent eval loops** | Generate → execute → measure → fix → repeat until criteria pass | Test-driven agent dev, benchmark harnesses with feedback |
| **Ralph Loop** | Fresh-context agent re-invocation; filesystem/git as memory; Stop Hook reinjects task until "completion promise" | Cursor `/ralph-loop`, cursor-ralph hooks, Codex `/goal`, Claude Code ralph-wiggum plugin |
| **CI + AI loops** | Pipeline runs tests/lint; agent or human fixes; pipeline re-runs | GitHub Actions + agent PR bots (adjacent, not the same as Ralph) |

**Cursor Loops** (product feature) and **Ralph loops** (pattern) share the idea: **don't grow one conversation forever** — restart with clean context, persist state in repo/files/tests, and loop until machine-verifiable completion.

This is **not** the same as:
- Infinite ReAct tool chains inside one session (context collapse risk)
- Cron/scheduled jobs
- Traditional k6/JMeter load generators (though eval loops may *invoke* those)

---

## Is this stress-test plan "looping"?

**No — it is complementary, not looping.**

The requested plan is **deterministic stress / soak measurement**:

1. Generate configurable mock data (500–2000 patients, etc.)
2. Run orchestrated scripts against pure engines + vitest
3. Capture timings, threshold breaches, pain points
4. Produce human-readable report with recommendations

That is a **benchmark harness** (single pass: generate → run → analyze). It does **not** automatically:
- Patch code based on failures
- Re-run until green
- Maintain agent memory across iterations via hooks

It **enables** a future loop: an agent reads `STRESS_TEST_REPORT.md` / `report.json` and iterates fixes — but the harness itself is not the loop.

---

## Extra steps for a true eval/agent loop

To convert stress tests into a closed Ralph-style eval loop:

1. **Machine-readable pass/fail contract** — exit code 1 when thresholds fail; stable JSON schema for pain points (partially done via `scripts/stress/out/report.json`).
2. **Completion promise** — e.g. agent must output `STRESS_EVAL_COMPLETE` only when all gates pass (Ralph Stop Hook pattern).
3. **Iteration driver** — shell hook or `cursor-ralph`-style script: `while ! npm run stress; do agent-fix; done` with max iterations.
4. **Scoped task file** — `change-requests/stress-eval-tasks.json` listing thresholds to improve each sprint.
5. **UI layer (optional)** — Playwright timings for Patients pagination render, modal open, letter import wizard (engines alone miss layout jank).
6. **Regression baselines** — commit last-good `report.json` snapshot; fail on >20% regression without explicit bump.
7. **Guardrails file** — `.ralph/guardrails.md` for repeated failure modes (e.g. "don't disable compliance rules to pass timing").

---

## Do existing vitest tests (54) already cover this?

**Partially — correctness, not scale or integration pain.**

| Existing unit tests (`src/**/*.test.ts`, 54 tests) | Stress suite (unique value) |
|-----------------------------------------------------|----------------------------|
| Fixed small fixtures; rule-level compliance cases | Thousands of entities; full `runCompliance` + dashboard queue at scale |
| Letter import on 2 PDF templates | Duplicate scan ×100, parse under load, commit path with large `importHistory` |
| Calculator/excel/excelImport isolated cases | End-to-end serialize, Excel workbook build, backup ZIP with 50 blobs |
| No pagination / IDB volume | Patient filter/slice at 500–2000 rows; multi-MB JSON autosave simulation |
| Fast CI (<4s total) | Intentionally slow paths surfaced (export, compliance O(n²) risk) |

**Unique stress-test value:** finds **performance cliffs**, **memory/size limits**, and **UX-at-scale** issues that unit tests are designed to avoid. Unit tests prove logic; stress tests prove the app survives real office data volumes.

---

## Summary

| Question | Answer |
|----------|--------|
| Is the stress plan "looping"? | **No** — it's a measurement harness. Looping = autonomous fix-and-retry orchestration. |
| Relationship | Stress output becomes the **eval signal** a loop would optimize against. |
| Gap to close | Threshold exit codes + Ralph hook + optional UI perf + regression baselines. |
| vs 54 vitest tests | Unit = correctness; stress = scale, timing, operational pain points. |

**Scripts:** `scripts/stress/generate-mock-data.mjs`, `scripts/stress/run-stress.mjs`, `scripts/stress/stress.test.ts` — run via `npm run stress`.
