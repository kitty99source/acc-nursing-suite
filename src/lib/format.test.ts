import { describe, it, expect } from 'vitest';
import { formatDate, formatDateNZ, daysBetween, todayISO } from './format';

describe('formatDateNZ', () => {
  it('formats ISO dates as dd/mm/yyyy', () => {
    expect(formatDateNZ('2026-03-15')).toBe('15/03/2026');
    expect(formatDateNZ('2026-01-08')).toBe('08/01/2026');
    expect(formatDateNZ('2026-12-31')).toBe('31/12/2026');
  });

  it('returns empty string for missing input', () => {
    expect(formatDateNZ()).toBe('');
    expect(formatDateNZ('')).toBe('');
  });

  it('passes through unparseable strings', () => {
    expect(formatDateNZ('not-a-date')).toBe('not-a-date');
  });

  it('formatDate is an alias for formatDateNZ', () => {
    expect(formatDate('2026-07-08')).toBe('08/07/2026');
  });
});

describe('daysBetween', () => {
  it('computes whole-day differences in UTC', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
  });
});

describe('todayISO', () => {
  it('returns YYYY-MM-DD', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
