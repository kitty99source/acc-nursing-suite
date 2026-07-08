import { describe, it, expect } from 'vitest';
import {
  describeEmailSyncStatusRejectReason,
  describeInboxEmptyState,
  EMAIL_SYNC_STATUS_VERSION,
  formatSyncOutcome,
  parseEmailSyncStateFallback,
  parseEmailSyncStatus,
  parseEmailSyncStatusFromText,
  stripJsonBom,
} from './emailSyncStatus';

describe('emailSyncStatus', () => {
  it('parses valid sync report', () => {
    const parsed = parseEmailSyncStatus({
      version: EMAIL_SYNC_STATUS_VERSION,
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
    expect(parsed?.version).toBe(EMAIL_SYNC_STATUS_VERSION);
    expect(formatSyncOutcome(parsed!)).toContain('saved 2');
  });

  it('parses UTF-8 BOM prefixed JSON from PowerShell', () => {
    const json = '\uFEFF{"version":1,"lastRunAt":"2026-07-08T10:00:00.000Z","outcome":"ok","savedCount":0,"skippedCount":0,"errorCount":0,"savedFiles":[],"errors":[],"inboxPath":"","sharedMailbox":""}';
    const parsed = parseEmailSyncStatusFromText(json);
    expect(parsed?.outcome).toBe('ok');
    expect(stripJsonBom(json).startsWith('{')).toBe(true);
  });

  it('rejects email-sync-state.json mistaken for status report', () => {
    const reason = describeEmailSyncStatusRejectReason(
      {
        version: 1,
        processedEntryIds: ['abc'],
        runStats: { lastRunAt: '2026-07-08T10:00:00.000Z' },
      },
      'email-sync-state.json',
    );
    expect(reason).toContain('email-sync-state.json');
    expect(reason).toContain('email-sync-status.json');
  });

  it('detects state-shaped JSON without filename hint', () => {
    const reason = describeEmailSyncStatusRejectReason({
      version: 1,
      processedEntryIds: ['abc'],
      runStats: {},
    });
    expect(reason).toContain('processedEntryIds');
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

  it('real synced rows carry Claim/ACCID metadata and pass default filters', async () => {
    const [{ inboxRowsFromSyncStatus }, { filterAccInboxRows, DEFAULT_ACC_INBOX_FILTERS }] =
      await Promise.all([import('./emailSyncStatus'), import('./accInboxFilters')]);
    const rows = inboxRowsFromSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        {
          fileName: 'Mr-Gilbert-Gandor-approval.pdf',
          subject: 'Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655',
          sender: 'John.Bentley@acc.co.nz',
          savedAt: '2026-07-08T10:00:00.000Z',
        },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: 'ACCDistrictNursing',
    });
    expect(rows[0].claimNumber).toBe('10000003194');
    expect(rows[0].accId).toBe('VEND-K96655');
    // The real row must survive default sender/subject filtering (rendered, not filtered out).
    expect(filterAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS)).toHaveLength(1);
  });

  it('shows a saved letter with a name-only subject (no Claim/ACCID) regardless of subject tokens', async () => {
    const [{ inboxRowsFromSyncStatus }, { filterSavedAccInboxRows, filterAccInboxRows, DEFAULT_ACC_INBOX_FILTERS }] =
      await Promise.all([import('./emailSyncStatus'), import('./accInboxFilters')]);
    const rows = inboxRowsFromSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        {
          fileName: 'Steyn.pdf',
          subject: 'Steyn',
          sender: 'John.Bentley@acc.co.nz',
          savedAt: '2026-07-08T10:00:00.000Z',
        },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: 'ACCDistrictNursing',
    });
    // No Claim/ACCID metadata (name-only subject) — badge parsing yields undefined, not a hide.
    expect(rows[0].claimNumber).toBeUndefined();
    expect(rows[0].accId).toBeUndefined();
    // Saved-file display rule keeps it (sender + attachment); strict subject filter would drop it.
    expect(filterSavedAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS)).toHaveLength(1);
    expect(filterAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS)).toHaveLength(0);
  });

  it('drops malformed savedFiles entries instead of crashing the inbox', () => {
    const parsed = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 2,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        null,
        { subject: 'missing fileName' },
        { fileName: 'ok.pdf' },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: '',
    });
    expect(parsed?.savedFiles).toHaveLength(1);
    expect(parsed?.savedFiles[0]).toEqual({ fileName: 'ok.pdf', subject: '', sender: '', savedAt: '' });
  });

  it('infers minimal status from email-sync-state.json', () => {
    const parsed = parseEmailSyncStateFallback({
      version: 1,
      processedEntryIds: ['a', 'b', 'c'],
      runStats: { lastRunAt: '2026-07-08T02:00:00.000Z', totalSaved: 12, runs: 3 },
    });
    expect(parsed?.inferredFromState).toBe(true);
    expect(parsed?.processedTotal).toBe(3);
    expect(formatSyncOutcome(parsed!)).toContain('Checkpoint only');
  });

  it('describes inbox empty states', () => {
    expect(describeInboxEmptyState(null, true).title).toContain('Loading');
    expect(describeInboxEmptyState(null, false).title).toBe('No sync yet');
    const zeroSave = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [],
      errors: [],
      inboxPath: 'C:\\Users\\You\\ACC-Inbox',
      sharedMailbox: 'ACCDistrictNursing',
      scanStats: {
        mailItemsScanned: 50,
        matchedSender: 0,
        matchedBoth: 0,
        skippedCategory: 0,
        alreadyProcessed: 0,
        noSupportedAttachment: 0,
      },
    })!;
    expect(describeInboxEmptyState(zeroSave, false).title).toContain('0 letters saved');
    expect(describeInboxEmptyState(zeroSave, false).message).toContain('50 scanned');
  });

  it('describes synced letters hidden by filters', () => {
    const status = parseEmailSyncStatus({
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      savedCount: 2,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        { fileName: 'a.pdf', subject: 'x', sender: 'x@other.nz', savedAt: '2026-07-08T10:00:00.000Z' },
        { fileName: 'b.pdf', subject: 'y', sender: 'y@other.nz', savedAt: '2026-07-08T10:00:00.000Z' },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: '',
    })!;
    const copy = describeInboxEmptyState(status, false, 2);
    expect(copy.title).toContain('2 synced letter(s) hidden');
    expect(copy.message).toContain('filter');
  });
});
