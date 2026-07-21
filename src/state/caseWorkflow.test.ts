import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { emptyData } from '../lib/sampleData';

// Store orchestration tests for the case-workflow actions. Uses synthetic
// fixtures only — no real PHI, no external files. IndexedDB blob writes are
// exercised via a lightweight fake in jsdom (idb.ts already tolerates missing
// window.indexedDB gracefully in tests).

function seed() {
  useStore.setState({
    ready: true,
    data: {
      ...emptyData(),
      patients: [{ id: 'p1', name: 'Test Patient', nhi: '', dob: '', notes: '' }],
      claims: [
        {
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
        },
      ],
    },
  });
}

describe('sendMemoStartingCase', () => {
  beforeEach(() => {
    seed();
  });

  it('requires memo text', async () => {
    await expect(
      useStore.getState().sendMemoStartingCase({
        patientId: 'p1',
        target: 'same_claim',
        claimId: 'c1',
        text: '',
      }),
    ).rejects.toThrow(/text is required/);
  });

  it('renews on same claim: opens case + writes memo + sets due date', async () => {
    const { memoId, claimId } = await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'same_claim',
      claimId: 'c1',
      purpose: 'extended_ns04',
      text: 'Please send NS04 supporting docs.',
      to: 'district nurse',
    });
    const state = useStore.getState().data;
    expect(claimId).toBe('c1');
    const claim = state.claims.find((c) => c.id === 'c1')!;
    expect(claim.caseStage).toBe('awaiting_nurse_docs');
    expect(claim.memoSentAt).toBeTruthy();
    expect(claim.nurseFollowUpDue).toBeTruthy();
    expect(claim.lastMemoPurpose).toBe('extended_ns04');
    expect(claim.caseEvents?.[0]?.kind).toBe('memo_sent');
    const memo = state.memos.find((m) => m.id === memoId)!;
    expect(memo.text).toBe('Please send NS04 supporting docs.');
    expect(memo.purpose).toBe('extended_ns04');
    expect(memo.followUpDue).toBeTruthy();
  });

  it('new_claim: creates a fresh claim and opens the case on it', async () => {
    const { claimId } = await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'new_claim',
      purpose: 'new_claim_approval',
      text: 'Fresh approval request.',
    });
    expect(claimId).not.toBe('c1');
    const state = useStore.getState().data;
    const claim = state.claims.find((c) => c.id === claimId)!;
    expect(claim.type).toBe('original');
    expect(claim.caseStage).toBe('awaiting_nurse_docs');
  });

  it('new_claim with parentClaimId creates a subsequent claim linked to the parent', async () => {
    const { claimId } = await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'new_claim',
      parentClaimId: 'c1',
      purpose: 'subsequent_ns06',
      text: 'New subsequent injury.',
    });
    const claim = useStore.getState().data.claims.find((c) => c.id === claimId)!;
    expect(claim.type).toBe('subsequent');
    expect(claim.parentClaimId).toBe('c1');
  });

  it('same_claim requires a claimId', async () => {
    await expect(
      useStore.getState().sendMemoStartingCase({
        patientId: 'p1',
        target: 'same_claim',
        text: 'Something',
      }),
    ).rejects.toThrow(/Pick a claim/);
  });
});

describe('advanceCaseStage + recordCaseChase', () => {
  beforeEach(() => {
    seed();
  });

  it('advances through the pipeline: memo → docs_received → submitted → approved', async () => {
    await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'same_claim',
      claimId: 'c1',
      text: 'Send memo',
    });
    await useStore.getState().advanceCaseStage({
      claimId: 'c1',
      kind: 'docs_received',
    });
    let claim = useStore.getState().data.claims.find((c) => c.id === 'c1')!;
    expect(claim.caseStage).toBe('docs_received');

    await useStore.getState().advanceCaseStage({
      claimId: 'c1',
      kind: 'submitted_to_acc',
    });
    claim = useStore.getState().data.claims.find((c) => c.id === 'c1')!;
    expect(claim.caseStage).toBe('awaiting_acc');
    expect(claim.accFollowUpDue).toBeTruthy();

    await useStore.getState().advanceCaseStage({
      claimId: 'c1',
      kind: 'acc_approved',
    });
    claim = useStore.getState().data.claims.find((c) => c.id === 'c1')!;
    expect(claim.caseStage).toBe('approved');
    expect(claim.accRespondedAt).toBeTruthy();
  });

  it('rejects docs_returned without a note', async () => {
    await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'same_claim',
      claimId: 'c1',
      text: 'send',
    });
    await useStore.getState().advanceCaseStage({
      claimId: 'c1',
      kind: 'docs_received',
    });
    await expect(
      useStore.getState().advanceCaseStage({
        claimId: 'c1',
        kind: 'docs_returned',
      }),
    ).rejects.toThrow(/reason note is required/);
  });

  it('recordCaseChase refreshes the follow-up due date and appends an event', async () => {
    await useStore.getState().sendMemoStartingCase({
      patientId: 'p1',
      target: 'same_claim',
      claimId: 'c1',
      text: 'send',
    });
    const beforeDue = useStore.getState().data.claims.find((c) => c.id === 'c1')!.nurseFollowUpDue;
    // Force a tiny delay so the new due date is at least the same day but the event timestamp advances.
    useStore.getState().recordCaseChase('c1', 'nurse', 'Called nurse');
    const claim = useStore.getState().data.claims.find((c) => c.id === 'c1')!;
    expect(claim.caseStage).toBe('awaiting_nurse_docs');
    expect(claim.nurseFollowUpDue).toBeTruthy();
    // At worst the due date is equal (same-day chase); the event count grows.
    expect(claim.caseEvents?.length).toBe(2);
    expect(claim.caseEvents?.[1]?.kind).toBe('nurse_chased');
    // Ensure the new due date is >= old due date (never regresses).
    if (beforeDue && claim.nurseFollowUpDue) {
      expect(claim.nurseFollowUpDue >= beforeDue).toBe(true);
    }
  });
});
