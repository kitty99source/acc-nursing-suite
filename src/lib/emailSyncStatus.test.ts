import { describe, it, expect } from 'vitest';
import { formatSyncOutcome, parseEmailSyncStatus } from './emailSyncStatus';

describe('emailSyncStatus', () => {
  it('parses valid sync report', () => {
    const parsed = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 2,
      skippedCount: 1,
      errorCount: 0,
      savedFiles: [],
      errors: [],
      inboxPath: 'C:\\Users\\You\\ACC-Inbox',
      sharedMailbox: '',
    });
    expect(parsed?.savedCount).toBe(2);
    expect(formatSyncOutcome(parsed!)).toContain('saved 2');
  });

  it('rejects invalid payload', () => {
    expect(parseEmailSyncStatus(null)).toBeNull();
    expect(parseEmailSyncStatus({ foo: 1 })).toBeNull();
  });
});
