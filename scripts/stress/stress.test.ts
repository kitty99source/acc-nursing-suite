/**
 * Stress benchmarks — run via `npm run stress` (vitest.stress.config.ts).
 * Loads generated fixture from scripts/stress/fixtures/ and times core paths.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppData } from '../../src/types';
import { runCompliance, complianceSummary } from '../../src/lib/compliance';
import {
  dashboardMetrics,
  buildActionQueue,
  billingFunnel,
  coverageGapClaims,
} from '../../src/lib/analytics';
import { serialize, deserialize } from '../../src/lib/storage';
import { buildBackupZip, readBackupZip } from '../../src/lib/backup';
import { buildWorkbookBuffer } from '../../src/lib/excel';
import { determinePackage } from '../../src/lib/calculator';
import {
  extractPdfText,
  parseLetterFromText,
  parseApprovalLetter,
  isDuplicateLetterImport,
  prefillFromParsed,
} from '../../src/lib/letterImport';

const STRESS_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(STRESS_DIR, 'fixtures');
const OUT_DIR = join(STRESS_DIR, 'out');
const REPORT_PATH = join(OUT_DIR, 'report.json');
const BASELINE_PATH = join(STRESS_DIR, 'baseline.json');
const REGRESSION_LIMIT = 1.2; // 20% guard (P1-016)

const PATIENTS_PAGE_SIZE = 25;

interface BenchResult {
  name: string;
  ms: number;
  notes?: string;
  count?: number;
  passed: boolean;
  thresholdMs?: number;
}

const results: BenchResult[] = [];

function loadFixture(): AppData {
  const manifestPath = join(FIXTURES, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('Run generate-mock-data.mjs first (manifest.json missing).');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { outFile: string };
  const dataPath = join(FIXTURES, manifest.outFile);
  return JSON.parse(readFileSync(dataPath, 'utf8')) as AppData;
}

async function timeAsync(name: string, fn: () => Promise<unknown>, thresholdMs?: number): Promise<unknown> {
  const start = performance.now();
  const out = await fn();
  const ms = performance.now() - start;
  results.push({ name, ms, passed: thresholdMs == null || ms <= thresholdMs, thresholdMs });
  return out;
}

function timeSync(name: string, fn: () => unknown, thresholdMs?: number, notes?: string, count?: number): unknown {
  const start = performance.now();
  const out = fn();
  const ms = performance.now() - start;
  results.push({ name, ms, notes, count, passed: thresholdMs == null || ms <= thresholdMs, thresholdMs });
  return out;
}

function filterPatients(patients: AppData['patients'], q: string) {
  const query = q.trim().toLowerCase();
  if (!query) return patients;
  return patients.filter((p) => `${p.name} ${p.nhi}`.toLowerCase().includes(query));
}

function paginatePatients(data: AppData, page: number, search = '') {
  const filtered = filterPatients(data.patients, search);
  const start = (page - 1) * PATIENTS_PAGE_SIZE;
  return filtered.slice(start, start + PATIENTS_PAGE_SIZE);
}

let data: AppData;

beforeAll(() => {
  data = loadFixture();
  mkdirSync(OUT_DIR, { recursive: true });
});

describe('stress — core engines', () => {
  it('compliance engine at scale', () => {
    const findings = timeSync('runCompliance', () => runCompliance(data), 3000) as ReturnType<typeof runCompliance>;
    const summary = complianceSummary(findings);
    expect(findings.length).toBeGreaterThan(0);
    results[results.length - 1].count = findings.length;
    results[results.length - 1].notes = `violations=${summary.violations} warnings=${summary.warnings}`;
  });

  it('dashboard metrics + action queue', () => {
    timeSync('dashboardMetrics', () => dashboardMetrics(data), 2000);
    const queue = timeSync('buildActionQueue', () => buildActionQueue(data), 2500) as ReturnType<typeof buildActionQueue>;
    expect(queue.length).toBeGreaterThan(0);
    results[results.length - 1].count = queue.length;
  });

  it('billing funnel + coverage gaps', () => {
    timeSync('billingFunnel', () => billingFunnel(data), 500);
    const gaps = timeSync('coverageGapClaims', () => coverageGapClaims(data), 1000) as ReturnType<typeof coverageGapClaims>;
    results[results.length - 1].count = gaps.length;
  });

  it('patients pagination at scale', () => {
    const totalPages = Math.ceil(data.patients.length / PATIENTS_PAGE_SIZE);
    timeSync('patientsPage1', () => paginatePatients(data, 1), 50);
    timeSync('patientsPageMid', () => paginatePatients(data, Math.floor(totalPages / 2)), 50);
    timeSync('patientsSearch', () => paginatePatients(data, 1, 'STRESS Patient 01000'), 200);
    timeSync('patientsLastPage', () => paginatePatients(data, totalPages), 50);
  });

  it('package calculator on sample of service lines', () => {
    const sample = data.serviceLines.slice(0, Math.min(500, data.serviceLines.length));
    timeSync(
      'determinePackage×500',
      () => {
        for (const sl of sample) {
          determinePackage({
            day1: sl.day1Date,
            lastConsult: sl.lastConsultDate,
            consultCount: sl.consultCount,
            interruptions: sl.interruptions,
          });
        }
      },
      500,
      undefined,
      sample.length,
    );
  });

  it('serialize / deserialize round-trip', async () => {
    await timeAsync('serialize', () => serialize(data), 1500);
    const text = await serialize(data);
    results[results.length - 1].notes = `${(text.length / 1024 / 1024).toFixed(2)} MB`;
    await timeAsync('deserialize', () => deserialize(text), 2000);
  });

  it('excel export workbook build', async () => {
    const buf = await timeAsync('buildWorkbookBuffer', () => buildWorkbookBuffer(data), 15000);
    expect((buf as ArrayBuffer).byteLength).toBeGreaterThan(1000);
    results[results.length - 1].notes = `${((buf as ArrayBuffer).byteLength / 1024 / 1024).toFixed(2)} MB`;
  });

  it('backup zip round-trip with document blobs', async () => {
    const blobMap = new Map<string, Blob>();
    for (const doc of data.documents.slice(0, 50)) {
      blobMap.set(doc.id, new Blob([`stress-pdf-placeholder-${doc.id}`.repeat(100)], { type: 'application/pdf' }));
    }
    const zip = await timeAsync('buildBackupZip', () =>
      buildBackupZip(data, async (id) => blobMap.get(id)),
    15000);
    const restored = await timeAsync('readBackupZip', async () => readBackupZip(zip as Blob), 10000);
    expect((restored as Awaited<ReturnType<typeof readBackupZip>>).data.patients.length).toBe(data.patients.length);
    results[results.length - 1].notes = `${((zip as Blob).size / 1024 / 1024).toFixed(2)} MB zip`;
  });

  it('import history scan (settings module pattern)', () => {
    const history = data.importHistory ?? [];
    timeSync(
      'importHistorySort',
      () => [...history].sort((a, b) => b.importedAt - a.importedAt).slice(0, 100),
      100,
      undefined,
      history.length,
    );
  });
});

describe('stress — letter import paths', () => {
  const pdfDir = join(STRESS_DIR, '../../src/lib/fixtures');
  const loadPdf = (name: string) => new Uint8Array(readFileSync(join(pdfDir, name)));

  it('approval PDF extract + parse', async () => {
    const text = await timeAsync('extractPdfText(approval)', () => extractPdfText(loadPdf('approval-template.pdf')), 3000);
    await timeAsync('parseApprovalLetter', () => Promise.resolve(parseApprovalLetter(text as string)), 500);
  });

  it('decline PDF extract + parse + match', async () => {
    const text = await timeAsync('extractPdfText(decline)', () => extractPdfText(loadPdf('decline-template.pdf')), 3000);
    await timeAsync('parseLetterFromText(decline)', () => parseLetterFromText(text as string, data), 1000);
  });

  it('duplicate detection at scale', async () => {
    const blob = new Blob(['duplicate-stress'], { type: 'application/pdf' });
    const claimId = data.claims[0]?.id ?? 'stress_c_0';
    const loadBlob = async () => undefined;
    await timeAsync(
      'isDuplicateLetterImport×100',
      async () => {
        for (let i = 0; i < 100; i++) {
          await isDuplicateLetterImport(data, claimId, blob, loadBlob, { fileName: `stress-${i}.pdf` });
        }
      },
      3000,
    );
  });

  it('prefill from parsed approval', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    timeSync('prefillFromParsed', () => prefillFromParsed(parsed), 50);
  });
});

describe('stress — report', () => {
  it('writes JSON report', () => {
    const manifest = existsSync(join(FIXTURES, 'manifest.json'))
      ? JSON.parse(readFileSync(join(FIXTURES, 'manifest.json'), 'utf8'))
      : {};
    const failed = results.filter((r) => r.passed === false);
    const report = {
      generatedAt: new Date().toISOString(),
      fixture: manifest,
      results,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
        failed: failed.length,
        slowest: [...results].sort((a, b) => b.ms - a.ms).slice(0, 5),
      },
    };
    writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
    expect(report.summary.total).toBeGreaterThan(0);
    if (failed.length > 0) {
      console.warn(`Stress thresholds exceeded: ${failed.map((f) => f.name).join(', ')}`);
    }

    if (existsSync(BASELINE_PATH)) {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as {
        results: BenchResult[];
      };
      const baseMap = new Map(baseline.results.map((r) => [r.name, r.ms]));
      const regressions: string[] = [];
      for (const r of results) {
        const baseMs = baseMap.get(r.name);
        if (baseMs != null && r.ms > baseMs * REGRESSION_LIMIT) {
          regressions.push(`${r.name}: ${r.ms.toFixed(1)}ms > ${(baseMs * REGRESSION_LIMIT).toFixed(1)}ms (baseline ${baseMs.toFixed(1)}ms)`);
        }
      }
      if (regressions.length) {
        console.warn('Performance regressions vs baseline:\n' + regressions.join('\n'));
        expect(regressions, 'stress regression >20% vs baseline.json').toEqual([]);
      }
    }
  });
});
