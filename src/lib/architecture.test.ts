/**
 * Architecture regression gate (P2-03 / P2-04 / P2-05 mirror).
 *
 * Staging / types / remittance / serviceCodes cycles must stay gone.
 * The store ↔ compliance (± LetterImportButton) family is deferred to P5-14
 * and is the only allowed remainder.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ALLOWED_CYCLE_PATTERNS = [
  /store\.ts.*compliance/i,
  /compliance.*store\.ts/i,
  /complianceCache/i,
  /LetterImportButton/i,
  /idb\.ts.*compliance/i,
  /auditLog\.ts.*idb\.ts.*compliance/i,
];

function isAllowedCycle(cycleLine: string): boolean {
  return ALLOWED_CYCLE_PATTERNS.some((re) => re.test(cycleLine));
}

describe('architecture: staging/types cycles stay broken', () => {
  it('madge --circular src reports only deferred store/compliance family', () => {
    const root = path.resolve(__dirname, '../..');
    let stdout = '';
    let stderr = '';
    let code = 0;
    try {
      stdout = execFileSync(
        'npx',
        ['--yes', 'madge', '--extensions', 'ts,tsx', '--circular', 'src'],
        { cwd: root, encoding: 'utf8' },
      );
    } catch (e: unknown) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      code = err.status ?? 1;
      stdout = err.stdout ?? '';
      stderr = err.stderr ?? '';
    }
    const combined = `${stdout}\n${stderr}`;
    if (code === 0 && !/Found \d+ circular/.test(combined)) {
      expect(code).toBe(0);
      return;
    }

    const cycleLines = combined
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+\)/.test(l));

    const forbidden = cycleLines.filter((line) => !isAllowedCycle(line));
    if (forbidden.length > 0) {
      throw new Error(
        `Forbidden circular dependencies (exit ${code}):\n${forbidden.join('\n')}\n\nFull madge output:\n${combined}`,
      );
    }
    expect(forbidden).toEqual([]);
  }, 60_000);
});
