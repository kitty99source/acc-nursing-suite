import { describe, it, expect, beforeEach, vi } from 'vitest';

const stagingQueue: import('../lib/staging').StagingItem[] = [];
const dismissedKeys: string[] = [];
const blobs = new Map<string, Blob>();

vi.mock('../lib/idb', () => ({
  loadWorkingCopy: vi.fn(async () => undefined),
  saveWorkingCopy: vi.fn(async () => {}),
  clearWorkingCopy: vi.fn(async () => {}),
  saveFileHandle: vi.fn(async () => {}),
  loadFileHandle: vi.fn(async () => undefined),
  clearFileHandle: vi.fn(async () => {}),
  saveDocumentBlob: vi.fn(async (id: string, blob: Blob) => {
    blobs.set(id, blob);
  }),
  loadDocumentBlob: vi.fn(async (id: string) => blobs.get(id)),
  deleteDocumentBlob: vi.fn(async (id: string) => {
    blobs.delete(id);
  }),
  loadImportHistory: vi.fn(async () => undefined),
  saveImportHistory: vi.fn(async () => {}),
  loadComplianceSnapshot: vi.fn(async () => undefined),
  saveComplianceSnapshot: vi.fn(async () => {}),
  loadStagingQueue: vi.fn(async () => [...stagingQueue]),
  saveStagingQueue: vi.fn(async (items: typeof stagingQueue) => {
    stagingQueue.length = 0;
    stagingQueue.push(...items);
  }),
  loadDismissedStaging: vi.fn(async () => [...dismissedKeys]),
  saveDismissedStaging: vi.fn(async (keys: string[]) => {
    dismissedKeys.length = 0;
    dismissedKeys.push(...keys);
  }),
  listDocumentIds: vi.fn(async () => [...blobs.keys()]),
}));

import { useStore } from './store';
import { emptyData } from '../lib/sampleData';
import { createStagingItem, updateStagingItem, dismissStagingItems } from '../lib/staging';
import type { ParsedApprovalLetter } from '../lib/letterImport';

function minimalApproval(): ParsedApprovalLetter {
  return {
    kind: 'approval',
    confidence: 100,
    formCode: 'NUR02',
    letterDate: '2026-03-01',
    patient: { name: 'Test Patient', nhi: 'ZZZ9999', dob: '1980-01-01' },
    claim: {
      claimNumber: '10000009999',
      acc45Number: 'AA11111',
      poNumber: 'PO1',
      injuryDescription: 'Test',
      dateOfInjury: '2026-01-15',
    },
    serviceRows: [
      {
        serviceCode: 'NS04',
        approvalStartDate: '2026-02-01',
        approvalEndDate: '2026-05-01',
        approvedHoursOrConsults: 6,
      },
    ],
    packageRows: [],
  };
}

describe('HRQ Accept undo from document', () => {
  beforeEach(() => {
    stagingQueue.length = 0;
    dismissedKeys.length = 0;
    blobs.clear();
    useStore.setState({
      ready: true,
      data: emptyData(),
      letterImport: undefined,
    });
  });

  it('stamps review-accept metadata and undoes from the document later', async () => {
    const staging = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Test letter',
      summary: '',
      sourceFileName: 'letter.pdf',
      sourceHash: 'abc',
    });
    stagingQueue.push(staging);

    const file = new File([new Uint8Array([1, 2, 3])], 'letter.pdf', { type: 'application/pdf' });
    const result = await useStore.getState().commitParsedApproval(minimalApproval(), file, {
      patientPatch: { name: 'Test Patient', nhi: 'ZZZ9999', dob: '1980-01-01' },
      claimPatch: {
        claimNumber: '10000009999',
        acc45Number: 'AA11111',
        poNumber: 'PO1',
        injuryDescription: 'Test',
        day1Date: '2026-01-15',
      },
      rows: [
        {
          serviceCode: 'NS04',
          approvalStartDate: '2026-02-01',
          approvalEndDate: '2026-05-01',
          approvedHoursOrConsults: 6,
          recordStatus: 'current',
        },
      ],
      stagingItemId: staging.id,
    });

    await updateStagingItem(staging.id, { status: 'approved' });
    await dismissStagingItems([{ ...staging, status: 'approved' }]);

    const doc = useStore.getState().data.documents.find((d) => d.id === result.documentId);
    expect(doc?.fromReviewAccept).toBe(true);
    expect(doc?.stagingItemId).toBe(staging.id);
    expect(doc?.reviewAcceptCreatedPatient).toBe(true);
    expect(doc?.reviewAcceptCreatedClaim).toBe(true);
    expect(useStore.getState().data.approvals.length).toBeGreaterThan(0);

    const undo = await useStore.getState().undoHrqAcceptFromDocument(result.documentId!);
    expect(undo.restoredStaging).toBe(true);
    expect(undo.removedPatient).toBe(true);
    expect(undo.removedClaim).toBe(true);
    expect(useStore.getState().data.documents).toHaveLength(0);
    expect(useStore.getState().data.approvals).toHaveLength(0);
    expect(useStore.getState().data.patients).toHaveLength(0);
    expect(useStore.getState().data.claims).toHaveLength(0);

    const restored = stagingQueue.find((i) => i.id === staging.id);
    expect(restored?.status).toBe('pending');
  });

  it('rejects undo for documents not created by Accept', async () => {
    const claimId = useStore.getState().addClaim({
      patientId: useStore.getState().addPatient({ name: 'P', nhi: '', dob: '', notes: '' }),
      claimNumber: '1',
      acc45Number: '',
      poNumber: '',
      injuryDescription: '',
      type: 'original',
      status: 'active',
      day1Date: '2026-01-01',
    });
    const docId = await useStore.getState().addDocument(
      {
        claimId,
        kind: 'other',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 3,
      },
      new Blob([new Uint8Array([1, 2, 3])]),
    );
    await expect(useStore.getState().undoHrqAcceptFromDocument(docId)).rejects.toThrow(
      /not created by a Review Queue Accept/,
    );
  });
});
