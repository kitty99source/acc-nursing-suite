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

  it('formats backlog sync outcome', () => {
    const parsed = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      mode: 'backlog',
      savedCount: 25,
      skippedCount: 100,
      errorCount: 0,
      savedFiles: [],
      errors: [],
      inboxPath: 'C:\\Users\\You\\ACC-Inbox',
      sharedMailbox: '',
      processedTotal: 250,
      backlogRemaining: -1,
    });
    expect(parsed?.mode).toBe('backlog');
    expect(formatSyncOutcome(parsed!)).toContain('backlog');
    expect(formatSyncOutcome(parsed!)).toContain('250');
  });

  it('formats work-hours pause', () => {
    const parsed = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T22:00:00.000Z',
      outcome: 'paused',
      workHoursSkipped: true,
      savedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [],
      errors: [],
      inboxPath: '',
      sharedMailbox: '',
    });
    expect(formatSyncOutcome(parsed!)).toContain('work hours');
  });

  it('parses scan stats and includes in zero-save outcome', () => {
    const parsed = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [],
      errors: [],
      inboxPath: 'C:\\Users\\You\\ACC-Inbox',
      sharedMailbox: '',
      scanStats: {
        mailItemsScanned: 120,
        matchedSender: 0,
        matchedBoth: 0,
        skippedCategory: 0,
        alreadyProcessed: 0,
        noSupportedAttachment: 0,
      },
    });
    expect(parsed?.scanStats?.mailItemsScanned).toBe(120);
    expect(formatSyncOutcome(parsed!)).toContain('120 scanned');
  });

  it('builds inbox rows from saved files', async () => {
    const { inboxRowsFromSyncStatus } = await import('./emailSyncStatus');
    const rows = inboxRowsFromSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        {
          fileName: 'approval.pdf',
          subject: 'Approval NUR02',
          sender: 'nursing@acc.co.nz',
          savedAt: '2026-07-08T10:00:00.000Z',
        },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: '',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].attachmentName).toBe('approval.pdf');
  });
});
