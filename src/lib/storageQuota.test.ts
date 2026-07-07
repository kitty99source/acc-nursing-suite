import { describe, it, expect } from 'vitest';
import { formatStorageError, isQuotaExceededError } from './storageQuota';

describe('storage quota messaging (P3-009)', () => {
  it('detects QuotaExceededError by name and legacy code', () => {
    expect(isQuotaExceededError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaExceededError({ name: 'Other', code: 22 })).toBe(true);
    expect(isQuotaExceededError(new Error('nope'))).toBe(false);
  });

  it('formats quota errors with actionable guidance', () => {
    const msg = formatStorageError({ name: 'QuotaExceededError' });
    expect(msg).toMatch(/storage is full/i);
    expect(msg).toMatch(/export/i);
    expect(msg).toMatch(/retry/i);
  });

  it('passes through generic errors', () => {
    expect(formatStorageError(new Error('IDB transaction failed'))).toBe('IDB transaction failed');
  });
});
