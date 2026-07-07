#!/usr/bin/env node
// ============================================================================
// Orchestrates: generate mock data → vitest stress suite → MD report.
// Usage: node scripts/stress/run-stress.mjs [--scale=medium|small|large]
// ============================================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const STRESS_DIR = join(ROOT, 'scripts/stress');
const OUT_DIR = join(STRESS_DIR, 'out');
const REPORT_JSON = join(OUT_DIR, 'report.json');
const REPORT_MD = join(ROOT, 'change-requests/STRESS_TEST_REPORT.md');

function parseScale(argv) {
  for (const arg of argv) {
    if (arg.startsWith('--scale=')) return arg.slice(8);
  }
  return process.env.STRESS_SCALE ?? 'medium';
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function formatMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`;
}

function buildMarkdown(report, scale) {
  const { fixture, results, summary } = report;
  const counts = fixture?.counts ?? {};
  const painPoints = [];

  for (const r of results) {
    if (!r.passed && r.thresholdMs) {
      painPoints.push({
        area: r.name,
        observed: formatMs(r.ms),
        threshold: formatMs(r.thresholdMs),
        severity: r.ms > r.thresholdMs * 3 ? 'high' : 'medium',
        notes: r.notes,
      });
    }
  }

  // Heuristic UX/architecture pain points from counts + timings
  const compliance = results.find((r) => r.name === 'runCompliance');
  const excel = results.find((r) => r.name === 'buildWorkbookBuffer');
  const actionQueue = results.find((r) => r.name === 'buildActionQueue');
  const serialize = results.find((r) => r.name === 'serialize');
  const coverage = results.find((r) => r.name === 'coverageGapClaims');

  const recommendations = [];
  if (compliance && compliance.ms > 1000) {
    recommendations.push({ priority: 'P1', area: 'Compliance', text: 'Index claims/invoices by claimId; avoid O(n²) scans in runCompliance at 500+ claims.' });
  }
  if (excel && excel.ms > 5000) {
    recommendations.push({ priority: 'P1', area: 'Export', text: 'Stream Excel rows or defer styling for large exports; consider progress UI for >3k invoice lines.' });
  }
  if (actionQueue && actionQueue.count > 1000) {
    recommendations.push({ priority: 'P1', area: 'Dashboard UX', text: `Action queue produced ${actionQueue.count.toLocaleString()} items — paginate, cap, or group by severity before render.` });
  } else if (actionQueue && actionQueue.count > 200) {
    recommendations.push({ priority: 'P2', area: 'Dashboard UX', text: 'Paginate or collapse action queue when >100 items; severity filters already partial.' });
  }
  if (actionQueue && actionQueue.ms > 1500) {
    recommendations.push({ priority: 'P1', area: 'Dashboard perf', text: 'buildActionQueue re-runs full compliance scan; cache findings or incremental diff for dashboard refresh.' });
  }
  if (coverage && coverage.ms > 700) {
    recommendations.push({ priority: 'P2', area: 'Coverage gaps', text: 'coverageGapClaims scans all claims × approvals; pre-index approvals by claimId for large files.' });
  }
  if (serialize && serialize.notes?.includes('MB') && parseFloat(serialize.notes) > 5) {
    recommendations.push({ priority: 'P2', area: 'Storage', text: 'Working-copy JSON exceeds comfortable autosave size; split metadata from history or compress IDB payload.' });
  }
  if ((counts.patients ?? 0) >= 500) {
    recommendations.push({ priority: 'P2', area: 'Patients UI', text: 'Virtualize patient list or memoize claim cards — pagination helps list shell but detail panes still load all claim data.' });
  }
  recommendations.push({ priority: 'P3', area: 'Eval loop', text: 'Wire stress report.json into a Ralph-style loop: agent reads failures → patches → re-runs npm run stress until thresholds pass.' });

  const lines = [
    '# Stress Test Report',
    '',
    `**Generated:** ${report.generatedAt}`,
    `**Scale:** ${scale}`,
    '',
    '## What was run',
    '',
    '1. `scripts/stress/generate-mock-data.mjs` — synthetic AppData (not committed to sampleData)',
    '2. `scripts/stress/stress.test.ts` via `vitest.stress.config.ts`',
    '3. Timings written to `scripts/stress/out/report.json`',
    '',
    '### Fixture counts',
    '',
    '| Entity | Count |',
    '|--------|------:|',
    ...Object.entries(counts).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    fixture?.bytes ? `**Fixture size:** ${(fixture.bytes / 1024 / 1024).toFixed(2)} MB JSON\n` : '',
    '## Timings',
    '',
    '| Benchmark | Time | Threshold | Pass | Notes |',
    '|-----------|-----:|----------:|:----:|-------|',
    ...results.map((r) =>
      `| ${r.name} | ${formatMs(r.ms)} | ${r.thresholdMs ? formatMs(r.thresholdMs) : '—'} | ${r.passed ? '✓' : '✗'} | ${r.notes ?? (r.count != null ? `n=${r.count}` : '')} |`,
    ),
    '',
    '## Summary',
    '',
    `- **Benchmarks:** ${summary.total} total, ${summary.passed} passed, ${summary.failed} over threshold`,
    '',
    '### Slowest',
    '',
    ...summary.slowest.map((r) => `- ${r.name}: ${formatMs(r.ms)}`),
    '',
  ];

  if (painPoints.length) {
    lines.push('## Pain points (threshold breaches)', '', '| Area | Observed | Threshold | Severity |', '|------|----------|-----------|----------|');
    for (const p of painPoints) {
      lines.push(`| ${p.area} | ${p.observed} | ${p.threshold} | ${p.severity} |`);
    }
    lines.push('');
  }

  const watch = results.filter((r) => r.thresholdMs && r.ms > r.thresholdMs * 0.75 && r.passed);
  if (watch.length) {
    lines.push('## Approaching limits (>75% of threshold)', '');
    for (const r of watch) {
      lines.push(`- **${r.name}:** ${formatMs(r.ms)} / ${formatMs(r.thresholdMs)}${r.count != null ? ` (${r.count} items)` : ''}${r.notes ? ` — ${r.notes}` : ''}`);
    }
    lines.push('');
  }

  if (!painPoints.length && !watch.length) {
    lines.push('## Pain points', '', 'No thresholds breached at this scale.', '');
  } else if (!painPoints.length) {
    lines.push('');
  }

  lines.push('## Recommendations (prioritized)', '');
  for (const rec of recommendations) {
    lines.push(`- **${rec.priority} — ${rec.area}:** ${rec.text}`);
  }

  lines.push(
    '',
    '## Automated looping eval — gap analysis',
    '',
    'Current suite is **one-shot stress measurement**, not a closed eval loop. To convert:',
    '',
    '1. Persist `report.json` + pain points as machine-readable eval output',
    '2. Add a completion promise / exit code when all thresholds pass',
    '3. Wrap in Ralph-style hook: agent reads report → implements fix → `npm run stress` → repeat',
    '4. Optionally add Playwright for UI pagination/render timings (not covered here)',
    '',
  );

  return lines.join('\n');
}

function main() {
  const scale = parseScale(process.argv.slice(2));
  console.log(`\n=== ACC Admin Suite stress run (scale=${scale}) ===\n`);

  run('node', [join(STRESS_DIR, 'generate-mock-data.mjs'), `--scale=${scale}`]);

  console.log('\n--- Running vitest stress suite ---\n');
  run('npx', ['vitest', 'run', '--config', 'vitest.stress.config.ts']);

  if (!existsSync(REPORT_JSON)) {
    console.error('Expected report.json missing after stress tests.');
    process.exit(1);
  }

  const report = JSON.parse(readFileSync(REPORT_JSON, 'utf8'));
  mkdirSync(dirname(REPORT_MD), { recursive: true });
  writeFileSync(REPORT_MD, buildMarkdown(report, scale));
  console.log(`\nReport written: ${REPORT_MD}`);
  console.log(`JSON: ${REPORT_JSON}\n`);
}

main();
