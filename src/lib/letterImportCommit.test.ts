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
import { saveDocumentBlob, deleteDocumentBlob } from './idb';

const dir = dirname(fileURLToPath(import.meta.url));
const loadPdf = (name: string) => new Uint8Array(readFileSync(join(dir, 'fixtures', name)));

describe('letterImport commit journey', () => {
  beforeEach(() => {
    useStore.setState({
      ready: true,
      data: {
        ...emptyData(),
        patients: [{ id: 'p1', name: 'George Bellingham', nhi: 'ABC1234', dob: '1945-03-12', notes: '' }],
        claims: [
          {
            id: 'c1',
            patientId: 'p1',
            claimNumber: '10000000149',
            acc45Number: 'YN65488',
            poNumber: '',
            injuryDescription: '',
            type: 'original',
            status: 'active',
            day1Date: '2024-02-19',
          },
        ],
      },
      letterImport: undefined,
    });
  });

  it('parse → commitParsedApproval → claim has approvals and document', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const file = new File([loadPdf('approval-template.pdf')], 'approval-template.pdf', { type: 'application/pdf' });

    const result = await useStore.getState().commitParsedApproval(parsed, file, {
      patientId: 'p1',
      claimId: 'c1',
      patientPatch: { name: 'George Bellingham', nhi: 'ABC1234' },
      claimPatch: { poNumber: parsed.claim.poNumber },
      rows,
    });

    expect(result.patientId).toBe('p1');
    expect(result.claimId).toBe('c1');
    expect(result.kind).toBe('approval');

    const data = useStore.getState().data;
    expect(data.approvals.filter((a) => a.claimId === 'c1').length).toBeGreaterThan(0);
    expect(data.documents.some((d) => d.claimId === 'c1' && d.kind === 'acc-approval-letter')).toBe(true);
    expect(data.importHistory?.length).toBeGreaterThan(0);
  });

  it('attachDocumentOnly uses acc-approval-letter when letterKind is approval', async () => {
    const file = new File([loadPdf('approval-template.pdf')], 'Approval template.pdf', {
      type: 'application/pdf',
    });
    const result = await useStore.getState().attachDocumentOnly(file, {
      patientId: 'p1',
      claimId: 'c1',
      letterKind: 'approval',
    });
    expect(result.kind).toBe('document-only');
    const doc = useStore.getState().data.documents.find((d) => d.claimId === 'c1');
    expect(doc?.kind).toBe('acc-approval-letter');
  });

  it('commitParsedDecline creates patient, claim, decline, and document for new patient', async () => {
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    const parsed = parseDeclineLetter(text);
    const file = new File([loadPdf('decline-template.pdf')], 'decline-template.pdf', { type: 'application/pdf' });

    const result = await useStore.getState().commitParsedDecline(parsed, file, {
      patientName: 'Mille Butter',
      claimNumber: '10000460000',
      reason: parsed.reason ?? 'Missing nursing consultation notes',
      servicePeriodDeclined: 'Extended Nursing',
    });

    expect(result.patientId).toBeTruthy();
    expect(result.claimId).toBeTruthy();
    expect(result.kind).toBe('decline');

    const data = useStore.getState().data;
    expect(data.patients.some((p) => p.id === result.patientId && p.name === 'Mille Butter')).toBe(true);
    expect(data.claims.some((c) => c.id === result.claimId && c.claimNumber === '10000460000')).toBe(true);
    expect(data.declines.some((d) => d.claimId === result.claimId && d.patientName === 'Mille Butter')).toBe(true);
    expect(data.documents.some((d) => d.claimId === result.claimId && d.kind === 'acc-decline-letter')).toBe(true);
  });

  it('findDuplicateLetterImport is false on first import, true after same file attached', async () => {
    const bytes = loadPdf('decline-template.pdf');
    const file = new File([bytes], 'decline-template.pdf', { type: 'application/pdf' });

    const before = await useStore.getState().findDuplicateLetterImport('c1', file, {
      parsedKind: 'decline',
      letterDate: '2026-01-15',
    });
    expect(before).toBe(false);

    await useStore.getState().attachDocumentOnly(file, {
      patientId: 'p1',
      claimId: 'c1',
      letterKind: 'decline',
    });

    const after = await useStore.getState().findDuplicateLetterImport('c1', file, {
      parsedKind: 'decline',
      letterDate: '2026-01-15',
    });
    expect(after).toBe(true);
  });

  it('NS03-only letter files as a historic record — no approvals, no billing', async () => {
    const NS03_ONLY_APPROVAL = [
      'NUR02 Approval for nursing services',
      '12 June 2024',
      "Client's claim number: 10000000149",
      'Purchase order number: 15089011 12 June 2024',
      'Client name: George Bellingham Date of injury: 01/06/2024',
      'Date of birth: 12/03/1945',
      'ACC45 number: YN65488 NHI number: ABC1234 Injury(s): Sprain Services approved',
      'NS03 Nursing Services Package 01/06/2024 31/05/2025 1 Units',
    ].join('\n');
    const parsed = parseApprovalLetter(NS03_ONLY_APPROVAL);
    expect(parsed.serviceRows).toHaveLength(0);
    const file = new File([NS03_ONLY_APPROVAL], 'ns03-historic.pdf', { type: 'application/pdf' });

    const result = await useStore.getState().commitParsedApproval(parsed, file, {
      patientId: 'p1',
      claimId: 'c1',
      rows: [],
      historicRows: parsed.packageRows,
    });

    expect(result.kind).toBe('approval');
    const data = useStore.getState().data;
    // No billable approval line items created for NS03.
    expect(data.approvals.filter((a) => a.claimId === 'c1')).toHaveLength(0);
    // The letter is attached with a clearly-labelled historic note.
    const doc = data.documents.find((d) => d.claimId === 'c1' && d.kind === 'acc-approval-letter');
    expect(doc).toBeDefined();
    expect(doc?.notes).toContain('NS03 — historic, no billing');
  });

  it('a letter with NS04 + NS03 files billable approvals AND records NS03 as historic', async () => {
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const file = new File([loadPdf('approval-template.pdf')], 'approval-template.pdf', { type: 'application/pdf' });

    await useStore.getState().commitParsedApproval(parsed, file, {
      patientId: 'p1',
      claimId: 'c1',
      rows,
      historicRows: parsed.packageRows,
    });

    const data = useStore.getState().data;
    // NS04/NS05 billable flow unchanged.
    expect(data.approvals.filter((a) => a.claimId === 'c1').length).toBeGreaterThan(0);
    // NS03 still recorded as history on the document note.
    const doc = data.documents.find((d) => d.claimId === 'c1' && d.kind === 'acc-approval-letter');
    expect(doc?.notes).toContain('NS03 — historic, no billing');
  });

  it('commitParsedApproval from Patients context creates full records for new patient', async () => {
    const bytes = loadPdf('approval-template.pdf');
    const text = await extractPdfText(bytes);
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const file = new File([bytes], 'approval-template.pdf', { type: 'application/pdf' });

    const result = await useStore.getState().commitParsedApproval(parsed, file, {
      patientPatch: {
        name: parsed.patient.name ?? 'Andrew Flannery',
        nhi: parsed.patient.nhi ?? 'ABC1234',
        dob: parsed.patient.dob ?? '',
      },
      claimPatch: {
        claimNumber: parsed.claim.claimNumber ?? '',
        acc45Number: parsed.claim.acc45Number ?? '',
        poNumber: parsed.claim.poNumber ?? '',
        injuryDescription: parsed.claim.injuryDescription ?? '',
        day1Date: parsed.claim.dateOfInjury ?? '2024-02-19',
      },
      rows,
    });

    expect(result.kind).toBe('approval');
    expect(result.patientId).toBeTruthy();
    expect(result.claimId).toBeTruthy();

    const data = useStore.getState().data;
    expect(data.patients.some((p) => p.id === result.patientId)).toBe(true);
    expect(data.claims.some((c) => c.id === result.claimId)).toBe(true);
    expect(data.approvals.some((a) => a.claimId === result.claimId)).toBe(true);
    expect(data.documents.some((d) => d.claimId === result.claimId && d.kind === 'acc-approval-letter')).toBe(true);
  });
});

describe('letterImport commit rollback on partial failure', () => {
  beforeEach(() => {
    useStore.setState({
      ready: true,
      data: emptyData(),
      letterImport: undefined,
    });
    vi.mocked(saveDocumentBlob).mockReset();
    vi.mocked(deleteDocumentBlob).mockReset().mockResolvedValue(undefined);
  });

  it('commitParsedApproval rolls back the new patient/claim when the document write throws', async () => {
    const priorData = useStore.getState().data;
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const file = new File([loadPdf('approval-template.pdf')], 'approval-template.pdf', { type: 'application/pdf' });

    vi.mocked(saveDocumentBlob).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      useStore.getState().commitParsedApproval(parsed, file, {
        patientPatch: { name: 'Someone New', nhi: 'ZZZ0001', dob: '1990-01-01' },
        claimPatch: {
          claimNumber: '99999999999',
          acc45Number: 'YZ00000',
          poNumber: '12345678',
        },
        rows,
      }),
    ).rejects.toThrow('disk full');

    const data = useStore.getState().data;
    // Nothing partially created survives: no orphaned patient, claim, or document.
    expect(data.patients).toEqual(priorData.patients);
    expect(data.claims).toEqual(priorData.claims);
    expect(data.approvals).toEqual(priorData.approvals);
    expect(data.documents).toEqual(priorData.documents);
    expect(data.patients.some((p) => p.name === 'Someone New')).toBe(false);
  });

  it('commitParsedDecline rolls back the new patient/claim when the document write throws', async () => {
    const priorData = useStore.getState().data;
    const text = await extractPdfText(loadPdf('decline-template.pdf'));
    const parsed = parseDeclineLetter(text);
    const file = new File([loadPdf('decline-template.pdf')], 'decline-template.pdf', { type: 'application/pdf' });

    vi.mocked(saveDocumentBlob).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      useStore.getState().commitParsedDecline(parsed, file, {
        patientName: 'Someone Else',
        claimNumber: '88888888888',
        reason: 'Missing nursing consultation notes',
        servicePeriodDeclined: 'Extended Nursing',
      }),
    ).rejects.toThrow('disk full');

    const data = useStore.getState().data;
    expect(data.patients).toEqual(priorData.patients);
    expect(data.claims).toEqual(priorData.claims);
    expect(data.declines).toEqual(priorData.declines);
    expect(data.documents).toEqual(priorData.documents);
    expect(data.patients.some((p) => p.name === 'Someone Else')).toBe(false);
  });

  it('does not attempt to delete a blob that was never successfully written', async () => {
    // The document write itself is what throws in these tests (the realistic
    // failure mode — IDB quota/write errors), so no blob id is ever recorded
    // as "created" and cleanup must not fire for it.
    const text = await extractPdfText(loadPdf('approval-template.pdf'));
    const parsed = parseApprovalLetter(text);
    const rows = assignRecordStatus(parsed.serviceRows);
    const file = new File([loadPdf('approval-template.pdf')], 'approval-template.pdf', { type: 'application/pdf' });

    vi.mocked(saveDocumentBlob).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      useStore.getState().commitParsedApproval(parsed, file, {
        patientPatch: { name: 'Blob Cleanup Patient', nhi: 'ZZZ0002', dob: '1990-01-01' },
        claimPatch: { claimNumber: '77777777777' },
        rows,
      }),
    ).rejects.toThrow('disk full');

    expect(deleteDocumentBlob).not.toHaveBeenCalled();
  });
});
