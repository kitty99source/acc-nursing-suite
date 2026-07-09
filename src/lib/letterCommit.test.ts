import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

vi.mock('./idb', () => {
  const blobs = new Map<string, Blob>();
  return {
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
  };
});

import { useStore } from '../state/store';
import { emptyData } from './sampleData';
import { extractPdfText, parseApprovalLetter, parseDeclineLetter, assignRecordStatus } from './letterImport';
import {
  commitLetterForm,
  emptyLetterCommitForm,
  formFieldsFromParsed,
  formFieldsFromPreview,
} from './letterCommit';
import type { StagingParsedPreview } from './hrqBatch';

const dir = dirname(fileURLToPath(import.meta.url));
const loadPdf = (name: string) => new Uint8Array(readFileSync(join(dir, 'fixtures', name)));

describe('letterCommit helper', () => {
  beforeEach(() => {
    useStore.setState({
      ready: true,
      data: emptyData(),
      letterImport: undefined,
    });
  });

  it('formFieldsFromParsed maps approval fields and rows', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const fields = formFieldsFromParsed(parsed);
    expect(fields.patientName).toBeTruthy();
    expect(fields.claimNumber).toBeTruthy();
    expect(fields.rows.length).toBeGreaterThan(0);
    expect(fields.selectedPatientId).toBe('');
  });

  it('formFieldsFromPreview prefers patientPatch and rows', () => {
    const preview: StagingParsedPreview = {
      kind: 'approval',
      confidence: 95,
      patientName: 'Preview Name',
      claimNumber: '100',
      parsed: {
        kind: 'approval',
        patient: { name: 'Parsed Name', nhi: '', dob: '' },
        claim: {
          claimNumber: '100',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          dateOfInjury: '',
        },
        letterDate: '2024-01-01',
        serviceRows: [],
        packageRows: [],
        rawText: '',
      },
      fileBlobBase64: 'YQ==',
      fileName: 'a.pdf',
      mimeType: 'application/pdf',
      patientId: 'p9',
      claimId: 'c9',
      patientPatch: { name: 'Patched Name', nhi: 'ABC1234', dob: '1940-01-01' },
      claimPatch: { claimNumber: '100', poNumber: 'PO1' },
      rows: assignRecordStatus([
        {
          serviceCode: 'NS04',
          approvalStartDate: '2024-01-01',
          approvalEndDate: '2024-03-01',
          approvedHoursOrConsults: 10,
          recordStatus: 'current',
        },
      ]),
    };
    const fields = formFieldsFromPreview(preview);
    expect(fields.patientName).toBe('Patched Name');
    expect(fields.nhi).toBe('ABC1234');
    expect(fields.selectedPatientId).toBe('p9');
    expect(fields.selectedClaimId).toBe('c9');
    expect(fields.poNumber).toBe('PO1');
    expect(fields.rows[0]?.serviceCode).toBe('NS04');
  });

  it('commitLetterForm creates patient + claim for new approval', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const file = new File([loadPdf('approval-template.pdf')], 'approval-template.pdf', {
      type: 'application/pdf',
    });
    const fields = {
      ...emptyLetterCommitForm(),
      ...formFieldsFromParsed(parsed),
      patientName: parsed.patient.name || 'Test Patient',
      claimNumber: parsed.claim.claimNumber || '999',
    };

    const result = await commitLetterForm(parsed, file, fields, {
      commitParsedApproval: (p, f, opts) => useStore.getState().commitParsedApproval(p, f, opts),
      commitParsedDecline: (p, f, opts) => useStore.getState().commitParsedDecline(p, f, opts),
    });

    expect(result.kind).toBe('approval');
    const data = useStore.getState().data;
    expect(data.patients.some((p) => p.id === result.patientId)).toBe(true);
    expect(data.claims.some((c) => c.id === result.claimId)).toBe(true);
    expect(data.documents.some((d) => d.claimId === result.claimId)).toBe(true);
  });

  it('commitLetterForm creates decline for new patient', async () => {
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    const parsed = parseDeclineLetter(text);
    const file = new File([loadPdf('decline-template.pdf')], 'decline-template.pdf', {
      type: 'application/pdf',
    });
    const fields = {
      ...emptyLetterCommitForm(),
      ...formFieldsFromParsed(parsed),
      patientName: parsed.patient.name || 'Decline Patient',
    };

    const result = await commitLetterForm(parsed, file, fields, {
      commitParsedApproval: (p, f, opts) => useStore.getState().commitParsedApproval(p, f, opts),
      commitParsedDecline: (p, f, opts) => useStore.getState().commitParsedDecline(p, f, opts),
    });

    expect(result.kind).toBe('decline');
    const data = useStore.getState().data;
    expect(data.patients.some((p) => p.id === result.patientId)).toBe(true);
    expect(data.declines.some((d) => d.claimId === result.claimId)).toBe(true);
  });

  it('commitLetterForm rejects empty patient name', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const file = new File([loadPdf('approval-template.pdf')], 'a.pdf', { type: 'application/pdf' });
    await expect(
      commitLetterForm(
        parsed,
        file,
        { ...emptyLetterCommitForm(), claimNumber: '1' },
        {
          commitParsedApproval: (p, f, opts) => useStore.getState().commitParsedApproval(p, f, opts),
          commitParsedDecline: (p, f, opts) => useStore.getState().commitParsedDecline(p, f, opts),
        },
      ),
    ).rejects.toThrow(/Patient name/i);
  });
});
