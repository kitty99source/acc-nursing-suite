import { describe, it, expect } from 'vitest';
import { DEFAULT_ACC_INBOX_FILTERS, accInboxConfigFromSettings, filterAccInboxRows, isAccInboxCandidate } from './accInboxFilters';

describe('accInboxFilters', () => {
  it('accepts ACC approval PDF from allowlisted sender', () => {
    expect(
      isAccInboxCandidate({
        sender: 'nursing@acc.co.nz',
        subject: 'Approval for extended nursing NUR02',
        attachmentExt: '.pdf',
      }),
    ).toBe(true);
  });

  it('rejects unrelated attachment', () => {
    expect(
      isAccInboxCandidate({
        sender: 'nursing@acc.co.nz',
        subject: 'Approval letter',
        attachmentExt: '.xlsx',
      }),
    ).toBe(false);
  });

  it('filters row list', () => {
    const rows = filterAccInboxRows([
      {
        id: '1',
        sender: 'nursing@acc.co.nz',
        subject: 'Decline NUR04',
        receivedAt: Date.now(),
        attachmentName: 'decline.pdf',
        attachmentExt: '.pdf',
      },
      {
        id: '2',
        sender: 'it@hospital.nz',
        subject: 'Staff meeting',
        receivedAt: Date.now(),
        attachmentName: 'agenda.pdf',
        attachmentExt: '.pdf',
      },
    ], DEFAULT_ACC_INBOX_FILTERS);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('1');
  });

  it('builds config from settings strings', () => {
    const cfg = accInboxConfigFromSettings(['nursing@acc.co.nz'], ['approv']);
    expect(cfg.senderAllowlist).toEqual(['nursing@acc.co.nz']);
    expect(cfg.subjectPatterns[0].test('Approval letter')).toBe(true);
  });
});
