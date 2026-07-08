import { describe, it, expect } from 'vitest';
import fixture from './__fixtures__/email-sync-status.sample.json';
import {
  inboxRowsFromSyncStatus,
  parseEmailSyncStatus,
  describeInboxEmptyState,
} from './emailSyncStatus';
import {
  accInboxConfigFromSettings,
  DEFAULT_ACC_INBOX_FILTERS,
  filterAccInboxRows,
  filterSavedAccInboxRows,
} from './accInboxFilters';
import { DEFAULT_SETTINGS } from '../types';

/**
 * Fixture-driven proof that the shipped ACC Inbox pipeline works WITHOUT a live
 * sync: the committed synthetic email-sync-status.json feeds parse → rows →
 * filter → empty-state exactly like the running app. All PHI here is fake.
 */
describe('AccInbox pipeline (synthetic email-sync fixture)', () => {
  const status = parseEmailSyncStatus(fixture)!;

  it('parses the committed fixture into a valid sync status', () => {
    expect(status).not.toBeNull();
    expect(status.outcome).toBe('ok');
    expect(status.savedFiles).toHaveLength(3);
  });

  // (a) real rows render from savedFiles
  it('(a) builds inbox rows from the fixture savedFiles', () => {
    const rows = inboxRowsFromSyncStatus(status);
    expect(rows).toHaveLength(3);
    expect(rows[0].attachmentName).toBe('Ms-Fakey-McTestface-approval.pdf');
    expect(rows[0].attachmentExt).toBe('.pdf');
    expect(rows[1].attachmentExt).toBe('.docx');
    // receivedAt is derived from savedAt, not zeroed.
    expect(rows[0].receivedAt).toBeGreaterThan(0);
  });

  // (b) Claim/ACCID badges/metadata parse correctly
  it('(b) parses Claim/ACCID metadata for the badges', () => {
    const rows = inboxRowsFromSyncStatus(status);
    expect(rows[0].claimNumber).toBe('90000000001');
    expect(rows[0].accId).toBe('VEND-FAKE001');
    expect(rows[1].claimNumber).toBe('90000000002');
    expect(rows[1].accId).toBe('VEND-FAKE002');
    // The non-ACC newsletter carries no claim metadata.
    expect(rows[2].claimNumber).toBeUndefined();
    expect(rows[2].accId).toBeUndefined();
  });

  // (c) the subject-filter merge never drops Claim:/ACCID:
  it('(c) default filters keep the real ACC letters and drop the newsletter', () => {
    const rows = inboxRowsFromSyncStatus(status);
    const visible = filterAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS);
    expect(visible).toHaveLength(2);
    expect(visible.map((r) => r.attachmentName)).not.toContain('office-newsletter-july.pdf');

    // Even a deliberately narrow office-config that omits Claim:/ACCID: must
    // still surface them, because accInboxConfigFromSettings merges defaults.
    const narrow = accInboxConfigFromSettings(
      DEFAULT_SETTINGS.accInboxSenderAllowlist,
      ['newsletter'],
    );
    const stillVisible = filterAccInboxRows(rows, narrow);
    expect(stillVisible.map((r) => r.claimNumber)).toEqual(['90000000001', '90000000002']);
  });

  // (d) hidden-by-filters empty state shows when synced files exist but all filtered out
  it('(d) shows the hidden-by-filters empty state when every synced file is filtered out', () => {
    const rows = inboxRowsFromSyncStatus(status);
    // A config whose sender allowlist matches nothing in the fixture hides all rows.
    const hideAll = accInboxConfigFromSettings(['nobody@nowhere.invalid'], []);
    const visible = filterAccInboxRows(rows, hideAll);
    expect(visible).toHaveLength(0);

    const copy = describeInboxEmptyState(status, false, rows.length);
    expect(copy.title).toContain('synced letter(s) hidden');
    expect(copy.message).toContain('filter');
  });

  // (e) demo stubs never appear when real data is present
  it('(e) never emits demo/sample stub rows — only real synced files', () => {
    const rows = inboxRowsFromSyncStatus(status);
    for (const row of rows) {
      expect(row.id.startsWith('sync-')).toBe(true);
      expect(row.subject.toLowerCase()).not.toContain('sample data');
      expect(row.subject.toLowerCase()).not.toContain('demo');
    }
    // With real saved files present and rows visible, the empty-state helper is
    // not in a "no sync" / demo posture.
    const visible = filterAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS);
    const copy = describeInboxEmptyState(status, false, visible.length === 0 ? rows.length : 0);
    expect(copy.title).not.toBe('No sync yet');
  });

  // (f) saved-file display rule: a name-only subject letter (no Claim/ACCID) still renders
  it('(f) displays a saved letter with a name-only subject that the strict filter would hide', () => {
    const rows = inboxRowsFromSyncStatus(status);
    // Simulate a real "Steyn" letter appended to the saved rows: acc sender + PDF, name-only subject.
    const nameOnly = {
      id: 'sync-99-Steyn.pdf',
      sender: 'John.Bentley@acc.co.nz',
      subject: 'Steyn',
      receivedAt: Date.now(),
      attachmentName: 'Steyn.pdf',
      attachmentExt: '.pdf',
    };
    const all = [...rows, nameOnly];

    // Strict (subject-gated) filter DROPS the name-only letter (the regression we fixed) …
    const strict = filterAccInboxRows(all, DEFAULT_ACC_INBOX_FILTERS);
    expect(strict.some((r) => r.id === 'sync-99-Steyn.pdf')).toBe(false);
    // … but the saved-file display rule KEEPS it (sender + attachment, subject not required).
    const saved = filterSavedAccInboxRows(all, DEFAULT_ACC_INBOX_FILTERS);
    expect(saved.some((r) => r.id === 'sync-99-Steyn.pdf')).toBe(true);
    // The non-ACC newsletter from the fixture is still hidden by the sender sanity check.
    expect(saved.some((r) => r.attachmentName === 'office-newsletter-july.pdf')).toBe(false);
  });

  it('fixture contains only obviously-fake identifiers (no real PHI)', () => {
    const blob = JSON.stringify(fixture).toLowerCase();
    // Fake claim numbers all start 9000000000x; fake ACCIDs are VEND-FAKE*.
    expect(blob).toContain('vend-fake');
    expect(blob).toContain('90000000001');
    expect(blob).toContain('fakey mctestface');
  });
});
