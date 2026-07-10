import { describe, it, expect } from 'vitest';
import { findDuplicateApprovalsByPO } from './approvals';
import type { Approval, ClaimDocument, Patient } from '../types';

function approval(partial: Partial<Approval> & Pick<Approval, 'id'>): Approval {
  return {
    patientId: 'p1',
    claimId: 'c1',
    serviceCode: 'NS04',
    approvalStartDate: '2025-01-01',
    approvalEndDate: '2025-12-31',
    approvedHoursOrConsults: 10,
    poNumber: 'PO-1',
    notes: '',
    ...partial,
  };
}

function doc(partial: Partial<ClaimDocument> & Pick<ClaimDocument, 'id' | 'addedDate'>): ClaimDocument {
  return {
    claimId: 'c1',
    kind: 'acc-approval-letter',
    fileName: 'letter.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    ...partial,
  };
}

describe('findDuplicateApprovalsByPO', () => {
  it('groups two approvals for the same patient + service code + PO as a duplicate', () => {
    const older = approval({ id: 'a-2025', sourceDocumentId: 'd-2025' });
    const newer = approval({ id: 'a-2026', sourceDocumentId: 'd-2026' });
    const docs = [
      doc({ id: 'd-2025', addedDate: '2025-03-01T00:00:00.000Z' }),
      doc({ id: 'd-2026', addedDate: '2026-03-01T00:00:00.000Z' }),
    ];
    const groups = findDuplicateApprovalsByPO([older, newer], docs, []);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe('a-2026');
    expect(groups[0].redundant.map((a) => a.id)).toEqual(['a-2025']);
  });

  it('never groups approvals with different PO numbers, even for the same patient', () => {
    const a = approval({ id: 'a1', poNumber: 'PO-1' });
    const b = approval({ id: 'a2', poNumber: 'PO-2' });
    expect(findDuplicateApprovalsByPO([a, b])).toEqual([]);
  });

  it('never groups approvals with a different service code, even for the same PO', () => {
    const ns04 = approval({ id: 'a1', serviceCode: 'NS04', poNumber: 'PO-9' });
    const ns05 = approval({ id: 'a2', serviceCode: 'NS05', poNumber: 'PO-9' });
    expect(findDuplicateApprovalsByPO([ns04, ns05])).toEqual([]);
  });

  it('never groups approvals with a blank PO number', () => {
    const a = approval({ id: 'a1', poNumber: '' });
    const b = approval({ id: 'a2', poNumber: '' });
    expect(findDuplicateApprovalsByPO([a, b])).toEqual([]);
  });

  it('is case/whitespace insensitive when matching PO numbers', () => {
    const a = approval({ id: 'a1', poNumber: 'po-1234' });
    const b = approval({ id: 'a2', poNumber: ' PO-1234 ' });
    const groups = findDuplicateApprovalsByPO([a, b]);
    expect(groups).toHaveLength(1);
  });

  it('falls back to normalized patient name when patientId differs', () => {
    const a = approval({ id: 'a1', patientId: 'p1' });
    const b = approval({ id: 'a2', patientId: 'p2' });
    const patients: Patient[] = [
      { id: 'p1', name: 'Jane Doe', nhi: '', dob: '', notes: '' },
      { id: 'p2', name: '  jane   doe ', nhi: '', dob: '', notes: '' },
    ];
    const groups = findDuplicateApprovalsByPO([a, b], [], patients);
    expect(groups).toHaveLength(1);
  });

  it('does not group approvals for different patients sharing a PO number', () => {
    const a = approval({ id: 'a1', patientId: 'p1' });
    const b = approval({ id: 'a2', patientId: 'p2' });
    const patients: Patient[] = [
      { id: 'p1', name: 'Jane Doe', nhi: '', dob: '', notes: '' },
      { id: 'p2', name: 'John Smith', nhi: '', dob: '', notes: '' },
    ];
    expect(findDuplicateApprovalsByPO([a, b], [], patients)).toEqual([]);
  });

  it('falls back to approvalEndDate for recency when there is no linked document', () => {
    const older = approval({ id: 'a-older', approvalEndDate: '2025-06-30' });
    const newer = approval({ id: 'a-newer', approvalEndDate: '2026-06-30' });
    const groups = findDuplicateApprovalsByPO([older, newer]);
    expect(groups[0].keep.id).toBe('a-newer');
    expect(groups[0].redundant.map((a) => a.id)).toEqual(['a-older']);
  });

  it('groups three-or-more duplicates, keeping only the newest', () => {
    const a = approval({ id: 'a1', approvalEndDate: '2024-01-01' });
    const b = approval({ id: 'a2', approvalEndDate: '2025-01-01' });
    const c = approval({ id: 'a3', approvalEndDate: '2026-01-01' });
    const groups = findDuplicateApprovalsByPO([a, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe('a3');
    expect(groups[0].redundant.map((x) => x.id).sort()).toEqual(['a1', 'a2']);
  });
});
