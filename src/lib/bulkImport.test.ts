import { describe, it, expect, vi } from 'vitest';
import {
  BULK_MIN_CONFIDENCE,
  candidateFileNames,
  normalizeMatchName,
  qualifyForBulk,
  runBulkImport,
} from './bulkImport';
import type { LetterMatch, LetterParseResult, ParsedApprovalLetter } from './letterImport';
import type { StagingItem } from './staging';

function approval(): ParsedApprovalLetter {
  return {
    kind: 'approval',
    letterDate: '2025-06-01',
    formCode: 'NUR02',
    patient: { name: 'Jane Doe', nhi: 'ABC1234', dob: '1950-01-01' },
    claim: { claimNumber: '10000000149', acc45Number: 'YN65488', poNumber: '15089011' },
    serviceRows: [
      { serviceCode: 'NS04', approvalStartDate: '2025-06-01', approvalEndDate: '2025-12-01', approvedHoursOrConsults: 10, recordStatus: 'current' },
    ],
    packageRows: [],
    rawText: 'NUR02',
  };
}

function match(over: Partial<LetterMatch> = {}): LetterMatch {
  return { patientId: 'p1', claimId: 'c1', patient: { id: 'p1', name: 'Jane Doe', nhi: 'ABC1234', dob: '1950-01-01', notes: '' }, ambiguous: false, notes: [], ...over };
}

function result(over: Partial<LetterParseResult> = {}): LetterParseResult {
  return {
    kind: 'approval',
    parsed: approval(),
    text: 'NUR02',
    usedOcr: false,
    fieldConfidences: [],
    overallConfidence: 100,
    autoCommit: false,
    blockers: [],
    match: match(),
    issues: [],
    ...over,
  };
}

function stagingItem(over: Partial<StagingItem> = {}): StagingItem {
  return {
    id: over.id ?? crypto.randomUUID(),
    type: 'letter-import-pending',
    status: 'pending',
    source: 'folder',
    createdAt: Date.now(),
    severity: 'info',
    title: 'Folder: letter.pdf',
    summary: '',
    sourceFileName: 'letter.pdf',
    ...over,
  };
}

describe('qualifyForBulk — the safety gate', () => {
  it('eligible when high-confidence, no blocking issues, matched to existing claim', () => {
    expect(qualifyForBulk(result()).eligible).toBe(true);
  });

  it('skips when the letter file was not found (no bytes)', () => {
    const q = qualifyForBulk(null);
    expect(q.eligible).toBe(false);
    expect(q.reason).toBe('file-not-found');
  });

  it('skips unrecognised letters', () => {
    const q = qualifyForBulk(result({ parsed: null }));
    expect(q.eligible).toBe(false);
    expect(q.reason).toBe('unrecognised');
  });

  it('skips when a blocking fix is outstanding', () => {
    const q = qualifyForBulk(
      result({ issues: [{ id: 'x', field: 'nhi', message: 'NHI is missing.' }] }),
    );
    expect(q.eligible).toBe(false);
    expect(q.reason).toBe('needs-fix');
  });

  it('ignores non-blocking (advisory) issues — e.g. NS03 historic note', () => {
    const q = qualifyForBulk(
      result({ issues: [{ id: 'x', field: 'linkClaim', message: 'advisory', blocking: false }] }),
    );
    expect(q.eligible).toBe(true);
  });

  it('skips low confidence', () => {
    const q = qualifyForBulk(result({ overallConfidence: BULK_MIN_CONFIDENCE - 1 }));
    expect(q.eligible).toBe(false);
    expect(q.reason).toBe('low-confidence');
  });

  it('skips when there is no confident existing patient/claim match', () => {
    expect(qualifyForBulk(result({ match: match({ claimId: undefined }) })).reason).toBe('no-match');
    expect(qualifyForBulk(result({ match: match({ patientId: undefined }) })).reason).toBe('no-match');
    expect(qualifyForBulk(result({ match: match({ ambiguous: true }) })).reason).toBe('no-match');
  });
});

describe('runBulkImport — commits only qualifying items', () => {
  it('commits eligible items and leaves the rest flagged in the queue', async () => {
    const good = stagingItem({ id: 'good', sourceFileName: 'good.pdf', title: 'good' });
    const lowConf = stagingItem({ id: 'low', sourceFileName: 'low.pdf', title: 'low' });
    const missing = stagingItem({ id: 'missing', sourceFileName: 'missing.pdf', title: 'missing' });

    const commitApproval = vi.fn(async () => ({ patientId: 'p1', claimId: 'c1' }));
    const commitDecline = vi.fn(async () => ({ patientId: 'p1', claimId: 'c1' }));

    const outcomes = await runBulkImport([good, lowConf, missing], {
      resolveFile: async (item) =>
        item.id === 'missing' ? undefined : new File(['x'], item.sourceFileName!, { type: 'application/pdf' }),
      parse: async (file) =>
        file.name === 'low.pdf' ? result({ overallConfidence: 10 }) : result(),
      commitApproval,
      commitDecline,
    });

    const byId = Object.fromEntries(outcomes.map((o) => [o.stagingId, o]));
    expect(byId.good.committed).toBe(true);
    expect(byId.good.kind).toBe('approval');
    expect(byId.low.committed).toBe(false);
    expect(byId.low.reason).toBe('low-confidence');
    expect(byId.missing.committed).toBe(false);
    expect(byId.missing.reason).toBe('file-not-found');

    // Only the one clean item was actually filed.
    expect(commitApproval).toHaveBeenCalledTimes(1);
    expect(commitDecline).not.toHaveBeenCalled();
  });

  it('one failed commit does not abort the batch', async () => {
    const a = stagingItem({ id: 'a', sourceFileName: 'a.pdf' });
    const b = stagingItem({ id: 'b', sourceFileName: 'b.pdf' });
    const commitApproval = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ patientId: 'p1', claimId: 'c1' });

    const outcomes = await runBulkImport([a, b], {
      resolveFile: async (item) => new File(['x'], item.sourceFileName!, { type: 'application/pdf' }),
      parse: async () => result(),
      commitApproval,
      commitDecline: vi.fn(),
    });

    expect(outcomes.filter((o) => o.committed)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.committed)).toHaveLength(1);
  });
});

describe('file-name matching helpers', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeMatchName('  Letter.PDF ')).toBe('letter.pdf');
  });

  it('prefers expectedFileName then sourceFileName, de-duplicated', () => {
    const item = stagingItem({ expectedFileName: 'Jane-P123.pdf', sourceFileName: 'attachment.pdf' });
    expect(candidateFileNames(item)).toEqual(['jane-p123.pdf', 'attachment.pdf']);
    const same = stagingItem({ expectedFileName: 'A.pdf', sourceFileName: 'a.pdf' });
    expect(candidateFileNames(same)).toEqual(['a.pdf']);
  });
});
