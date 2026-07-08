import { describe, it, expect } from 'vitest';
import {
  ACC_INBOX_REQUIRED_SUBJECT_TOKENS,
  ACC_INBOX_SAVED_EXTENSIONS,
  DEFAULT_ACC_INBOX_FILTERS,
  accInboxConfigFromSettings,
  filterAccInboxRows,
  filterSavedAccInboxRows,
  isAccInboxCandidate,
  isSavedAccInboxRow,
  missingRequiredSubjectTokens,
  parseFilterLines,
  parseSubjectMetadata,
} from './accInboxFilters';

function row(overrides: Partial<import('./accInboxFilters').AccInboxRow> = {}) {
  return {
    id: overrides.id ?? 'r1',
    sender: overrides.sender ?? 'John.Bentley@acc.co.nz',
    subject: overrides.subject ?? 'Steyn',
    receivedAt: overrides.receivedAt ?? Date.now(),
    attachmentName: overrides.attachmentName ?? 'steyn.pdf',
    attachmentExt: overrides.attachmentExt ?? '.pdf',
    ...overrides,
  };
}

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

  it('accepts real ACC email subject with Claim:/ACCID: via default filters', () => {
    expect(
      isAccInboxCandidate({
        sender: 'John.Bentley@acc.co.nz',
        subject: 'Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655',
        attachmentExt: '.pdf',
      }),
    ).toBe(true);
  });

  it('merges settings patterns with defaults so Claim:/ACCID: are never dropped', () => {
    // Narrow office-config that omits Claim:/ACCID: (the 7cee0da failure mode).
    const cfg = accInboxConfigFromSettings([], ['approv']);
    const realSubject = 'Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655';
    expect(cfg.subjectPatterns.some((re) => re.test(realSubject))).toBe(true);
  });

  it('parses Claim: and ACCID: metadata from real subject', () => {
    const meta = parseSubjectMetadata('Mr Gilbert Gandor - Claim:10000003194 ACCID:VEND-K96655');
    expect(meta.claimNumber).toBe('10000003194');
    expect(meta.accId).toBe('VEND-K96655');
    expect(parseSubjectMetadata('Staff meeting agenda')).toEqual({
      claimNumber: undefined,
      accId: undefined,
    });
  });
});

describe('accInboxFilters — editable Settings rules (P8-018)', () => {
  it('parseFilterLines trims, drops blanks, and de-duplicates case-insensitively', () => {
    expect(parseFilterLines('  Claim:\n\nACCID: \n claim:  \nApprov\n')).toEqual([
      'Claim:',
      'ACCID:',
      'Approv',
    ]);
    expect(parseFilterLines('\n\n   \n')).toEqual([]);
  });

  it('flags when a user removes the required Claim:/ACCID: subject tokens', () => {
    expect(missingRequiredSubjectTokens(['approv', 'declin'])).toEqual(['Claim:', 'ACCID:']);
    // Substring, case-insensitive: "has Claim: prefix" counts as present.
    expect(missingRequiredSubjectTokens(['x claim: y', 'accid:'])).toEqual([]);
    expect(missingRequiredSubjectTokens(['Claim:'])).toEqual(['ACCID:']);
    expect(ACC_INBOX_REQUIRED_SUBJECT_TOKENS).toEqual(['Claim:', 'ACCID:']);
  });

  it('merge safeguard: removing Claim:/ACCID: from Settings still matches real letters', () => {
    // User wiped their subject list down to something unrelated.
    const cfg = accInboxConfigFromSettings(['John.Bentley@acc.co.nz'], ['approv']);
    const realSubject = 'Ms Fakey McTestface - Claim:90000000001 ACCID:VEND-FAKE001';
    expect(
      isAccInboxCandidate(
        { sender: 'John.Bentley@acc.co.nz', subject: realSubject, attachmentExt: '.pdf' },
        cfg,
      ),
    ).toBe(true);
    // Defaults were merged back in.
    expect(cfg.subjectPatterns.some((re) => re.source.toLowerCase().includes('claim'))).toBe(true);
    expect(cfg.subjectPatterns.some((re) => re.source.toLowerCase().includes('accid'))).toBe(true);
  });

  it('editable sender allowlist narrows matching for the strict candidate (still merged for subjects)', () => {
    const cfg = accInboxConfigFromSettings(['John.Bentley@acc.co.nz'], []);
    expect(cfg.senderAllowlist).toEqual(['John.Bentley@acc.co.nz']);
    const realSubject = 'Ms Fakey McTestface - Claim:90000000001 ACCID:VEND-FAKE001';
    expect(
      isAccInboxCandidate(
        { sender: 'Becky.Tunnell@acc.co.nz', subject: realSubject, attachmentExt: '.pdf' },
        cfg,
      ),
    ).toBe(false);
    expect(
      isAccInboxCandidate(
        { sender: 'John.Bentley@acc.co.nz', subject: realSubject, attachmentExt: '.pdf' },
        cfg,
      ),
    ).toBe(true);
  });
});

describe('accInboxFilters — saved-file display rule (capture rule change)', () => {
  it('shows a saved letter with a NAME-ONLY subject (no Claim:/ACCID:)', () => {
    // "Steyn" / "Watson" real-world case: allowlisted sender + PDF but no subject token.
    const nameOnly = row({ subject: 'Steyn', attachmentName: 'Steyn.pdf', attachmentExt: '.pdf' });
    // Strict candidate (subject-gated) would HIDE it — the exact regression we are fixing.
    expect(isAccInboxCandidate(nameOnly)).toBe(false);
    // Saved-file rule SHOWS it: sender + supported attachment is enough, subject not required.
    expect(isSavedAccInboxRow(nameOnly)).toBe(true);
  });

  it('keeps a sender sanity check (non-ACC sender is still hidden)', () => {
    const newsletter = row({
      sender: 'comms@notacc.example.test',
      subject: 'July team newsletter',
      attachmentName: 'newsletter.pdf',
      attachmentExt: '.pdf',
    });
    expect(isSavedAccInboxRow(newsletter)).toBe(false);
  });

  it('accepts .doc saved files (saved for HRQ review) as well as .pdf/.docx', () => {
    expect(ACC_INBOX_SAVED_EXTENSIONS).toEqual(['.pdf', '.docx', '.doc']);
    expect(isSavedAccInboxRow(row({ attachmentExt: '.doc', attachmentName: 'watson.doc' }))).toBe(true);
    expect(isSavedAccInboxRow(row({ attachmentExt: '.docx', attachmentName: 'watson.docx' }))).toBe(true);
    // Unsupported extensions are still filtered out.
    expect(isSavedAccInboxRow(row({ attachmentExt: '.xlsx', attachmentName: 'sheet.xlsx' }))).toBe(false);
  });

  it('filterSavedAccInboxRows shows name-only ACC letters and drops the non-ACC newsletter', () => {
    const rows = [
      row({ id: '1', subject: 'Steyn', attachmentName: 'Steyn.pdf' }),
      row({ id: '2', subject: 'Watson', attachmentName: 'Watson.docx', attachmentExt: '.docx' }),
      row({
        id: '3',
        sender: 'comms@notacc.example.test',
        subject: 'July team newsletter',
        attachmentName: 'newsletter.pdf',
      }),
    ];
    const visible = filterSavedAccInboxRows(rows, DEFAULT_ACC_INBOX_FILTERS);
    expect(visible.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('respects a narrowed sender allowlist from settings (but never subject)', () => {
    const cfg = accInboxConfigFromSettings(['John.Bentley@acc.co.nz'], []);
    // Different allowlisted-by-default sender, but not in the narrowed list -> hidden.
    expect(
      isSavedAccInboxRow({ sender: 'Becky.Tunnell@acc.co.nz', attachmentExt: '.pdf' }, cfg),
    ).toBe(false);
    // The narrowed sender with a name-only subject is still shown.
    expect(isSavedAccInboxRow({ sender: 'John.Bentley@acc.co.nz', attachmentExt: '.pdf' }, cfg)).toBe(
      true,
    );
  });
});
