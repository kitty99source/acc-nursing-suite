import { describe, it, expect } from 'vitest';
import {
  CASE_STAGE_ORDER,
  addCalendarDays,
  addWorkingDays,
  applyCaseTransition,
  assertTransition,
  claimsNeedingAccFollowUp,
  claimsNeedingNurseFollowUp,
  computeAccFollowUpDue,
  computeNurseFollowUpDue,
  defaultMemoTarget,
  findOpenClaimsForPatient,
  isOpenCase,
  isTerminalStage,
  nextStages,
} from './caseWorkflow';
import type { AppData, Claim } from '../types';
import { DEFAULT_SETTINGS } from '../types';

function baseClaim(patch: Partial<Claim> = {}): Claim {
  return {
    id: 'c1',
    patientId: 'p1',
    acc45Number: '',
    claimNumber: 'CN-1',
    poNumber: '',
    injuryDescription: '',
    type: 'original',
    status: 'active',
    day1Date: '2026-01-01',
    caseStage: 'not_started',
    caseEvents: [],
    ...patch,
  };
}

function baseData(claims: Claim[]): AppData {
  return {
    schemaVersion: 4,
    patients: [{ id: 'p1', name: 'Test Patient', nhi: '', dob: '', notes: '' }],
    claims,
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: { ...DEFAULT_SETTINGS },
    documents: [],
    memos: [],
  };
}

describe('CASE_STAGE_ORDER + isTerminalStage / isOpenCase', () => {
  it('lists every stage exactly once', () => {
    expect(new Set(CASE_STAGE_ORDER).size).toBe(CASE_STAGE_ORDER.length);
  });

  it('terminal stages are approved/declined/closed', () => {
    expect(isTerminalStage('approved')).toBe(true);
    expect(isTerminalStage('declined')).toBe(true);
    expect(isTerminalStage('closed')).toBe(true);
    expect(isTerminalStage('awaiting_nurse_docs')).toBe(false);
    expect(isTerminalStage(undefined)).toBe(false);
  });

  it('isOpenCase excludes not_started and terminal stages', () => {
    expect(isOpenCase(baseClaim({ caseStage: 'not_started' }))).toBe(false);
    expect(isOpenCase(baseClaim({ caseStage: 'awaiting_nurse_docs' }))).toBe(true);
    expect(isOpenCase(baseClaim({ caseStage: 'approved' }))).toBe(false);
    expect(isOpenCase(baseClaim({ caseStage: 'declined' }))).toBe(false);
    expect(isOpenCase(baseClaim({ caseStage: 'closed' }))).toBe(false);
  });
});

describe('date math', () => {
  it('addCalendarDays crosses months + DST boundaries safely (UTC)', () => {
    expect(addCalendarDays('2026-01-30', 5)).toBe('2026-02-04');
    expect(addCalendarDays('2026-04-04', 1)).toBe('2026-04-05');
  });

  it('addWorkingDays skips weekends (Fri + 1 → Mon)', () => {
    // 2026-01-02 is a Friday (Jan 1 2026 is a Thursday).
    expect(addWorkingDays('2026-01-02', 1)).toBe('2026-01-05');
    expect(addWorkingDays('2026-01-02', 5)).toBe('2026-01-09');
  });

  it('addWorkingDays from a Saturday jumps to the following Monday', () => {
    // 2026-01-03 is a Saturday.
    expect(addWorkingDays('2026-01-03', 1)).toBe('2026-01-05');
  });

  it('computeNurseFollowUpDue defaults to 7 calendar days', () => {
    expect(computeNurseFollowUpDue('2026-01-01T09:00:00Z', 7)).toBe('2026-01-08');
  });

  it('computeAccFollowUpDue defaults to 10 working days (skips weekends)', () => {
    // 2026-01-05 is a Monday: + 10 working days → 2026-01-19 (Mon).
    expect(computeAccFollowUpDue('2026-01-05T09:00:00Z', 10)).toBe('2026-01-19');
  });
});

describe('transitions', () => {
  it('nextStages / assertTransition define the allowed edges', () => {
    expect(nextStages('not_started')).toContain('awaiting_nurse_docs');
    expect(() => assertTransition('not_started', 'awaiting_nurse_docs')).not.toThrow();
    expect(() => assertTransition('not_started', 'approved')).toThrow(/Illegal case transition/);
    expect(() => assertTransition('approved', 'closed')).toThrow();
  });

  it('memo_sent moves not_started → awaiting_nurse_docs + sets due date', () => {
    const claim = baseClaim({ caseStage: 'not_started' });
    const { claim: next, event } = applyCaseTransition(claim, {
      kind: 'memo_sent',
      nowISO: '2026-01-01T09:00:00Z',
      nurseFollowUpDays: 7,
    });
    expect(next.caseStage).toBe('awaiting_nurse_docs');
    expect(next.memoSentAt).toBe('2026-01-01T09:00:00Z');
    expect(next.nurseFollowUpDue).toBe('2026-01-08');
    expect(event.kind).toBe('memo_sent');
    expect(next.caseEvents).toHaveLength(1);
  });

  it('nurse_chased refreshes the nurse follow-up without changing stage', () => {
    const claim = baseClaim({
      caseStage: 'awaiting_nurse_docs',
      nurseFollowUpDue: '2026-01-08',
    });
    const { claim: next } = applyCaseTransition(claim, {
      kind: 'nurse_chased',
      nowISO: '2026-01-10T09:00:00Z',
      nurseFollowUpDays: 7,
    });
    expect(next.caseStage).toBe('awaiting_nurse_docs');
    expect(next.nurseFollowUpDue).toBe('2026-01-17');
  });

  it('docs_returned requires a reason note', () => {
    const claim = baseClaim({ caseStage: 'docs_received' });
    expect(() =>
      applyCaseTransition(claim, {
        kind: 'docs_returned',
        nowISO: '2026-01-05T09:00:00Z',
      }),
    ).toThrow(/reason note is required/);
    const { claim: next } = applyCaseTransition(claim, {
      kind: 'docs_returned',
      note: 'ACC179 blank',
      nowISO: '2026-01-05T09:00:00Z',
    });
    expect(next.caseStage).toBe('docs_returned');
    expect(next.docsReturnedAt).toBe('2026-01-05T09:00:00Z');
  });

  it('submitted_to_acc → awaiting_acc + ACC due date in working days', () => {
    const claim = baseClaim({ caseStage: 'docs_received' });
    const { claim: next } = applyCaseTransition(claim, {
      kind: 'submitted_to_acc',
      nowISO: '2026-01-05T09:00:00Z',
      accFollowUpWorkingDays: 10,
    });
    expect(next.caseStage).toBe('awaiting_acc');
    expect(next.accFollowUpDue).toBe('2026-01-19');
  });

  it('acc_chased refreshes the ACC follow-up without changing stage', () => {
    const claim = baseClaim({
      caseStage: 'awaiting_acc',
      accFollowUpDue: '2026-01-19',
    });
    const { claim: next } = applyCaseTransition(claim, {
      kind: 'acc_chased',
      nowISO: '2026-01-20T09:00:00Z',
      accFollowUpWorkingDays: 10,
    });
    expect(next.accFollowUpDue).toBe('2026-02-03');
  });

  it('acc_approved / acc_declined stamp accRespondedAt', () => {
    const claim = baseClaim({ caseStage: 'awaiting_acc' });
    const approved = applyCaseTransition(claim, {
      kind: 'acc_approved',
      nowISO: '2026-02-01T09:00:00Z',
    });
    expect(approved.claim.caseStage).toBe('approved');
    expect(approved.claim.accRespondedAt).toBe('2026-02-01T09:00:00Z');
    const declined = applyCaseTransition(claim, {
      kind: 'acc_declined',
      nowISO: '2026-02-01T09:00:00Z',
    });
    expect(declined.claim.caseStage).toBe('declined');
  });

  it('attachment_added / note do not change stage but append the event', () => {
    const claim = baseClaim({ caseStage: 'awaiting_acc' });
    const { claim: next, event } = applyCaseTransition(claim, {
      kind: 'attachment_added',
      documentId: 'doc-1',
      nowISO: '2026-02-05T09:00:00Z',
    });
    expect(next.caseStage).toBe('awaiting_acc');
    expect(event.kind).toBe('attachment_added');
    expect(event.documentId).toBe('doc-1');
  });

  it('caseEvents is append-only (does not mutate the input array)', () => {
    const existing = [
      { id: 'evt-old', at: '2026-01-01T09:00:00Z', kind: 'memo_sent' as const },
    ];
    const claim = baseClaim({
      caseStage: 'awaiting_nurse_docs',
      caseEvents: existing,
    });
    const { claim: next } = applyCaseTransition(claim, {
      kind: 'docs_received',
      nowISO: '2026-01-05T09:00:00Z',
    });
    expect(existing).toHaveLength(1);
    expect(next.caseEvents).toHaveLength(2);
  });
});

describe('defaultMemoTarget', () => {
  it('renewal/NS03/NS04/NS05 default to same claim', () => {
    expect(defaultMemoTarget('renewal_same_claim')).toBe('same_claim');
    expect(defaultMemoTarget('extended_ns04')).toBe('same_claim');
    expect(defaultMemoTarget('ongoing_ns05')).toBe('same_claim');
    expect(defaultMemoTarget('long_term_ns03')).toBe('same_claim');
  });

  it('NS06 / new claim default to new claim', () => {
    expect(defaultMemoTarget('new_claim_approval')).toBe('new_claim');
    expect(defaultMemoTarget('subsequent_ns06')).toBe('new_claim');
  });
});

describe('helpers over AppData', () => {
  it('findOpenClaimsForPatient excludes not_started + terminal cases', () => {
    const claims = [
      baseClaim({ id: 'c1', caseStage: 'awaiting_nurse_docs' }),
      baseClaim({ id: 'c2', caseStage: 'not_started' }),
      baseClaim({ id: 'c3', caseStage: 'approved' }),
    ];
    const open = findOpenClaimsForPatient(claims, 'p1');
    expect(open.map((c) => c.id)).toEqual(['c1']);
  });

  it('claimsNeedingNurseFollowUp picks awaiting_nurse_docs / docs_returned when due', () => {
    const data = baseData([
      baseClaim({ id: 'c1', caseStage: 'awaiting_nurse_docs', nurseFollowUpDue: '2026-01-01' }),
      baseClaim({ id: 'c2', caseStage: 'awaiting_nurse_docs', nurseFollowUpDue: '2026-12-31' }),
      baseClaim({ id: 'c3', caseStage: 'docs_returned', nurseFollowUpDue: '2026-01-01' }),
      baseClaim({ id: 'c4', caseStage: 'awaiting_acc', nurseFollowUpDue: '2026-01-01' }),
    ]);
    const due = claimsNeedingNurseFollowUp(data, '2026-01-05');
    expect(due.map((c) => c.id).sort()).toEqual(['c1', 'c3']);
  });

  it('claimsNeedingAccFollowUp picks awaiting_acc when due', () => {
    const data = baseData([
      baseClaim({ id: 'c1', caseStage: 'awaiting_acc', accFollowUpDue: '2026-01-01' }),
      baseClaim({ id: 'c2', caseStage: 'awaiting_acc', accFollowUpDue: '2026-12-31' }),
      baseClaim({ id: 'c3', caseStage: 'awaiting_nurse_docs', accFollowUpDue: '2026-01-01' }),
    ]);
    const due = claimsNeedingAccFollowUp(data, '2026-01-05');
    expect(due.map((c) => c.id)).toEqual(['c1']);
  });
});
