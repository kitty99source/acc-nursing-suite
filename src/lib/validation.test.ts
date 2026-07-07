import { describe, it, expect } from 'vitest';
import { validateNhi, normalizeNhi, normalizeClaimNumber } from './validation';

describe('validateNhi', () => {
  it('accepts a valid NHI with correct check digit', () => {
    // ZZZ0016 is a well-known test NHI (check digit 6).
    const r = validateNhi('ZZZ0016');
    expect(r.ok).toBe(true);
    expect(r.normalized).toBe('ZZZ0016');
    expect(r.warning).toBeUndefined();
  });

  it('normalizes spaces and case', () => {
    expect(normalizeNhi(' zzz 0016 ')).toBe('ZZZ0016');
  });

  it('warns on bad format', () => {
    const r = validateNhi('AB12');
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/3 letters/);
  });

  it('warns on wrong check digit', () => {
    const r = validateNhi('ZZZ0010');
    expect(r.ok).toBe(false);
    expect(r.warning).toMatch(/check digit/i);
  });

  it('allows empty NHI', () => {
    expect(validateNhi('')).toEqual({ ok: true, normalized: '' });
  });
});

describe('normalizeClaimNumber', () => {
  it('collapses internal whitespace', () => {
    expect(normalizeClaimNumber('CLM 1004')).toBe('CLM1004');
  });
});
