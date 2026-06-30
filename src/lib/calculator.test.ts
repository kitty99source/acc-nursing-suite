import { describe, it, expect } from 'vitest';
import {
  determinePackage,
  reclassifySubsequentInjury,
  ns06Watch,
  daysBetween,
} from './calculator';
import { SERVICE_CODES } from './serviceCodes';

function addDays(iso: string, days: number): string {
  // Use UTC arithmetic so the helper is timezone-independent.
  const ms = Date.parse(iso + 'T00:00:00Z') + days * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

describe('daysBetween', () => {
  it('computes whole-day difference', () => {
    expect(daysBetween('2025-01-01', '2025-01-01')).toBe(0);
    expect(daysBetween('2025-01-01', '2025-02-20')).toBe(50);
    expect(daysBetween('2025-01-01', addDays('2025-01-01', 120))).toBe(120);
  });
});

describe('determinePackage — worked examples', () => {
  it('10 consults over 50 days → Medium Term (NS02) via downgrade', () => {
    const day1 = '2025-01-01';
    const result = determinePackage({
      day1,
      lastConsult: addDays(day1, 50), // 50 days → NS03 band by duration
      consultCount: 10,
    });
    expect(result.primaryPackage).toBe('NS02');
    expect(result.recommendedCodes).toEqual(['NS02']);
    expect(result.needsExtended).toBe(false);
    expect(result.packageValue).toBe(SERVICE_CODES.NS02.rate);
    expect(result.reason).toMatch(/needs 12 visits, only 10 logged/i);
  });

  it('14 consults over 120 days → NS03 + NS04', () => {
    const day1 = '2025-01-01';
    const result = determinePackage({
      day1,
      lastConsult: addDays(day1, 120),
      consultCount: 14,
    });
    expect(result.primaryPackage).toBe('NS03');
    expect(result.needsExtended).toBe(true);
    expect(result.recommendedCodes).toEqual(['NS03', 'NS04']);
    expect(result.requiresApproval).toBe(true);
    expect(result.reason).toMatch(/exceeds 105 days/i);
  });

  it('interruption within span does not change the recommendation', () => {
    const day1 = '2025-01-01';
    const base = determinePackage({
      day1,
      lastConsult: addDays(day1, 50),
      consultCount: 8,
    });
    const withInterruption = determinePackage({
      day1,
      lastConsult: addDays(day1, 50),
      consultCount: 8,
      interruptions: [{ start: addDays(day1, 10), end: addDays(day1, 17) }],
    });
    expect(withInterruption.primaryPackage).toBe(base.primaryPackage);
    expect(withInterruption.durationDays).toBe(base.durationDays);
    expect(withInterruption.recommendedCodes).toEqual(base.recommendedCodes);
    expect(withInterruption.interruptionNote).toMatch(/interruption/i);
  });
});

describe('determinePackage — band boundaries', () => {
  it('short episode (5 days, 1 consult) → NS01', () => {
    const day1 = '2025-03-01';
    const r = determinePackage({ day1, lastConsult: addDays(day1, 5), consultCount: 1 });
    expect(r.primaryPackage).toBe('NS01');
    expect(r.needsExtended).toBe(false);
  });

  it('30 days with 6 consults → NS02', () => {
    const day1 = '2025-03-01';
    const r = determinePackage({ day1, lastConsult: addDays(day1, 30), consultCount: 6 });
    expect(r.primaryPackage).toBe('NS02');
  });

  it('30 days with only 3 consults → downgrades to NS01', () => {
    const day1 = '2025-03-01';
    const r = determinePackage({ day1, lastConsult: addDays(day1, 30), consultCount: 3 });
    expect(r.primaryPackage).toBe('NS01');
    expect(r.reason).toMatch(/Medium Term Package needs 6 visits/i);
  });

  it('60 days with 12 consults → NS03', () => {
    const day1 = '2025-03-01';
    const r = determinePackage({ day1, lastConsult: addDays(day1, 60), consultCount: 12 });
    expect(r.primaryPackage).toBe('NS03');
    expect(r.needsExtended).toBe(false);
  });
});

describe('determinePackage — 25-consult cap', () => {
  it('28 consults within NS03 band → NS03 + NS04 with ~3 extended consults', () => {
    const day1 = '2025-01-01';
    const r = determinePackage({ day1, lastConsult: addDays(day1, 60), consultCount: 28 });
    expect(r.primaryPackage).toBe('NS03');
    expect(r.capApplied).toBe(true);
    expect(r.needsExtended).toBe(true);
    expect(r.extendedConsults).toBe(3);
    expect(r.extendedValue).toBeCloseTo(3 * SERVICE_CODES.NS04.rate, 2);
    expect(r.recommendedCodes).toEqual(['NS03', 'NS04']);
  });
});

describe('determinePackage — ongoing', () => {
  it('flags ongoing episodes with no last-consult date', () => {
    const r = determinePackage({ day1: '2025-01-01', consultCount: 4 });
    expect(r.ongoing).toBe(true);
    expect(r.durationDays).toBe(0);
    expect(r.reason).toMatch(/ongoing/i);
  });
});

describe('reclassifySubsequentInjury', () => {
  it('uses the reassessment date as the new Day 1 (not backdated)', () => {
    const reassessmentDate = '2025-06-01';
    const r = reclassifySubsequentInjury({
      reassessmentDate,
      lastConsult: addDays(reassessmentDate, 20),
      consultCount: 6,
    });
    expect(r.newDay1).toBe(reassessmentDate);
    expect(r.primaryPackage).toBe('NS02');
    expect(r.note).toMatch(/do NOT count/i);
  });
});

describe('ns06Watch', () => {
  it('does not flag below threshold', () => {
    expect(ns06Watch(10).approaching).toBe(false);
  });
  it('flags approaching at 45', () => {
    const w = ns06Watch(45);
    expect(w.approaching).toBe(true);
    expect(w.exceeded).toBe(false);
  });
  it('flags exceeded above 50', () => {
    const w = ns06Watch(51);
    expect(w.exceeded).toBe(true);
    expect(w.message).toMatch(/approval is required/i);
  });
});
