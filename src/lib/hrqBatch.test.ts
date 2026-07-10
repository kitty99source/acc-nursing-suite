import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HRQ_BATCH_MIN_CONFIDENCE,
  allSelectedBatchApprovable,
  commitAutoAcceptItem,
  commitBatchStagingItem,
  commitBatchStagingItems,
  isAutoAcceptEligible,
  isAutoAcceptEligiblePreview,
  isBatchApprovable,
  isStagingParsedPreview,
  previewToFile,
  runAutoAccept,
  stagingPatientNames,
} from './hrqBatch';
import { createStagingItem } from './staging';
import {
  assignRecordStatus,
  extractPdfText,
  parseApprovalLetter,
  parseDeclineLetter,
} from './letterImport';
import type { StagingParsedPreview } from './hrqBatch';

vi.mock('./idb', () => {
  const blobs = new Map<string, Blob>();
  return {
    loadStagingQueue: vi.fn(async () => []),
    saveStagingQueue: vi.fn(async () => {}),
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
import { saveDocumentBlob } from './idb';

const dir = dirname(fileURLToPath(import.meta.url));
const loadPdf = (name: string) => new Uint8Array(readFileSync(join(dir, 'fixtures', name)));

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function buildApprovalPreview(
  overrides: Partial<StagingParsedPreview> = {},
): Promise<StagingParsedPreview> {
  const bytes = loadPdf('approval-template.pdf');
  const text = await extractPdfText(bytes);
  const parsed = parseApprovalLetter(text);
  const rows = assignRecordStatus(parsed.serviceRows);
  return {
    kind: 'approval',
    confidence: 95,
    patientName: 'George Bellingham',
    claimNumber: '10000000149',
    parsed,
    fileBlobBase64: toBase64(bytes),
    fileName: 'approval-template.pdf',
    mimeType: 'application/pdf',
    patientId: 'p1',
    claimId: 'c1',
    rows,
    ...overrides,
  };
}

function stagingWithPreview(preview: StagingParsedPreview, patch: Partial<ReturnType<typeof createStagingItem>> = {}) {
  return createStagingItem({
    type: 'letter-import-pending',
    source: 'email',
    severity: 'info',
    title: `Email: ${preview.fileName}`,
    summary: `Parsed ${preview.confidence}% confidence`,
    sourceFileName: preview.fileName,
    parsedPreview: preview,
    ...patch,
  });
}

describe('hrqBatch eligibility', () => {
  it('accepts high-confidence letter-import-pending with parsed preview', async () => {
    const preview = await buildApprovalPreview();
    const item = stagingWithPreview(preview);
    expect(isBatchApprovable(item)).toBe(true);
    expect(stagingPatientNames([item])).toEqual(['George Bellingham']);
  });

  it('rejects low-confidence staging type', async () => {
    const preview = await buildApprovalPreview();
    const item = createStagingItem({
      type: 'letter-import-low-confidence',
      source: 'folder',
      severity: 'warn',
      title: 'Scanned letter',
      summary: 'OCR unclear',
      parsedPreview: preview,
    });
    expect(isBatchApprovable(item)).toBe(false);
  });

  it('rejects duplicate-suspect and warn severity', async () => {
    const preview = await buildApprovalPreview();
    expect(
      isBatchApprovable(
        createStagingItem({
          type: 'letter-duplicate-suspect',
          source: 'email',
          severity: 'info',
          title: 'Dup',
          summary: 'Dup',
          parsedPreview: preview,
        }),
      ),
    ).toBe(false);
    expect(isBatchApprovable(stagingWithPreview(preview, { severity: 'warn' }))).toBe(false);
  });

  it('rejects preview below minimum confidence', async () => {
    const preview = await buildApprovalPreview({ confidence: HRQ_BATCH_MIN_CONFIDENCE - 1 });
    expect(isBatchApprovable(stagingWithPreview(preview))).toBe(false);
    expect(isStagingParsedPreview(preview)).toBe(false);
  });

  it('rejects folder-watch items without parsed preview', () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: test.pdf',
      summary: 'Awaiting HRQ review',
    });
    expect(isBatchApprovable(item)).toBe(false);
  });

  it('allSelectedBatchApprovable requires every selected item to qualify', async () => {
    const preview = await buildApprovalPreview();
    const ready = stagingWithPreview(preview);
    const notReady = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: other.pdf',
      summary: 'No preview',
    });
    expect(allSelectedBatchApprovable([ready])).toBe(true);
    expect(allSelectedBatchApprovable([ready, notReady])).toBe(false);
    expect(allSelectedBatchApprovable([])).toBe(false);
  });
});

describe('auto-accept eligibility (isAutoAcceptEligiblePreview / isAutoAcceptEligible)', () => {
  it('accepts a clean, 100%-confidence, zero-blocker approval preview with service rows', async () => {
    const preview = await buildApprovalPreview({ confidence: 100, blockers: [], ambiguous: false });
    expect(isAutoAcceptEligiblePreview(preview)).toBe(true);
    expect(isAutoAcceptEligible(stagingWithPreview(preview))).toBe(true);
  });

  it('rejects declines even at 100% confidence with no blockers (approvals only)', async () => {
    const bytes = loadPdf('decline-template.pdf');
    const text = await extractPdfText(bytes);
    const parsed = parseDeclineLetter(text);
    const preview: StagingParsedPreview = {
      kind: 'decline',
      confidence: 100,
      patientName: 'Mille Butter',
      claimNumber: '10000460000',
      parsed,
      fileBlobBase64: toBase64(bytes),
      fileName: 'decline-template.pdf',
      mimeType: 'application/pdf',
      reason: parsed.reason,
      servicePeriodDeclined: parsed.serviceRequested,
      blockers: [],
      ambiguous: false,
    };
    expect(isAutoAcceptEligiblePreview(preview)).toBe(false);
    expect(isAutoAcceptEligible(stagingWithPreview(preview))).toBe(false);
  });

  it('rejects an ambiguous match even if confidence happens to read 100 (defense-in-depth)', async () => {
    const preview = await buildApprovalPreview({ confidence: 100, blockers: [], ambiguous: true });
    expect(isAutoAcceptEligiblePreview(preview)).toBe(false);
  });

  it('rejects when there are any blockers, even at 100% confidence (defense-in-depth)', async () => {
    const preview = await buildApprovalPreview({
      confidence: 100,
      blockers: ['Claim number is missing.'],
      ambiguous: false,
    });
    expect(isAutoAcceptEligiblePreview(preview)).toBe(false);
  });

  it('rejects confidence below 100, even by one point', async () => {
    const preview = await buildApprovalPreview({ confidence: 99, blockers: [], ambiguous: false });
    expect(isAutoAcceptEligiblePreview(preview)).toBe(false);
  });

  it('rejects an approval with no NS04/NS05 service rows', async () => {
    const preview = await buildApprovalPreview({
      confidence: 100,
      blockers: [],
      ambiguous: false,
      rows: [],
    });
    // Force the underlying parsed letter to also have no rows, since the
    // eligibility check falls back to preview.parsed.serviceRows otherwise.
    preview.parsed = { ...preview.parsed, serviceRows: [] } as typeof preview.parsed;
    expect(isAutoAcceptEligiblePreview(preview)).toBe(false);
  });

  it('rejects deferred and non-pending staging items even with an eligible preview', async () => {
    const preview = await buildApprovalPreview({ confidence: 100, blockers: [], ambiguous: false });
    expect(isAutoAcceptEligible(stagingWithPreview(preview, { status: 'deferred' }))).toBe(false);
    expect(isAutoAcceptEligible(stagingWithPreview(preview, { status: 'approved' }))).toBe(false);
    expect(isAutoAcceptEligible(stagingWithPreview(preview, { status: 'rejected' }))).toBe(false);
  });

  it('rejects a pending item with no parsed preview at all', () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: no-preview.pdf',
      summary: 'Awaiting review',
    });
    expect(isAutoAcceptEligible(item)).toBe(false);
  });
});

describe('hrqBatch commit', () => {
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

  it('previewToFile round-trips PDF bytes', async () => {
    const preview = await buildApprovalPreview();
    const file = previewToFile(preview);
    expect(file.name).toBe('approval-template.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(loadPdf('approval-template.pdf').length);
  });

  it('commitBatchStagingItem files one approval to live store', async () => {
    const preview = await buildApprovalPreview();
    const item = stagingWithPreview(preview);
    const state = useStore.getState();

    const result = await commitBatchStagingItem(item, {
      commitParsedApproval: state.commitParsedApproval,
      commitParsedDecline: state.commitParsedDecline,
    });

    expect(result.kind).toBe('approval');
    expect(result.patientId).toBe('p1');
    expect(result.claimId).toBe('c1');
    const data = useStore.getState().data;
    expect(data.approvals.filter((a) => a.claimId === 'c1').length).toBeGreaterThan(0);
    expect(data.documents.some((d) => d.claimId === 'c1' && d.kind === 'acc-approval-letter')).toBe(true);
  });

  it('commitBatchStagingItems files three letters — J-26 routing', async () => {
    const previews = await Promise.all([
      buildApprovalPreview({ patientName: 'George Bellingham' }),
      buildApprovalPreview({ patientName: 'George Bellingham', fileName: 'approval-2.pdf' }),
      buildApprovalPreview({ patientName: 'George Bellingham', fileName: 'approval-3.pdf' }),
    ]);
    const items = previews.map((preview, i) =>
      stagingWithPreview(preview, { id: `staging-${i}`, title: `Letter ${i + 1}` }),
    );
    expect(stagingPatientNames(items)).toEqual([
      'George Bellingham',
      'George Bellingham',
      'George Bellingham',
    ]);

    const state = useStore.getState();
    const results = await commitBatchStagingItems(items, {
      commitParsedApproval: state.commitParsedApproval,
      commitParsedDecline: state.commitParsedDecline,
    });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.kind === 'approval' && r.claimId === 'c1')).toBe(true);
    expect(useStore.getState().data.documents.filter((d) => d.claimId === 'c1').length).toBe(3);
  });

  it('commitBatchStagingItem files decline preview', async () => {
    const bytes = loadPdf('decline-template.pdf');
    const text = await extractPdfText(bytes);
    const parsed = parseDeclineLetter(text);
    const preview: StagingParsedPreview = {
      kind: 'decline',
      confidence: 92,
      patientName: 'Mille Butter',
      claimNumber: '10000460000',
      parsed,
      fileBlobBase64: toBase64(bytes),
      fileName: 'decline-template.pdf',
      mimeType: 'application/pdf',
      reason: parsed.reason,
      servicePeriodDeclined: parsed.serviceRequested,
    };
    const item = stagingWithPreview(preview, { title: 'Decline batch' });
    const state = useStore.getState();
    const result = await commitBatchStagingItem(item, {
      commitParsedApproval: state.commitParsedApproval,
      commitParsedDecline: state.commitParsedDecline,
    });
    expect(result.kind).toBe('decline');
    expect(useStore.getState().data.declines.some((d) => d.patientName === 'Mille Butter')).toBe(true);
  });

  it('throws when item is not batch-approvable', async () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'No preview',
      summary: 'Manual review only',
    });
    const state = useStore.getState();
    await expect(
      commitBatchStagingItem(item, {
        commitParsedApproval: state.commitParsedApproval,
        commitParsedDecline: state.commitParsedDecline,
      }),
    ).rejects.toThrow(/not eligible/);
  });
});

describe('auto-accept commit + batch flow', () => {
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
    vi.mocked(saveDocumentBlob).mockReset();
  });

  it('commitAutoAcceptItem tags the created Approval(s) with autoAccepted + autoAcceptedAt', async () => {
    const preview = await buildApprovalPreview({ confidence: 100, blockers: [], ambiguous: false });
    const item = stagingWithPreview(preview);
    const state = useStore.getState();
    const before = Date.now();

    const result = await commitAutoAcceptItem(item, {
      commitParsedApproval: state.commitParsedApproval,
      commitParsedDecline: state.commitParsedDecline,
    });

    expect(result.patientId).toBe('p1');
    expect(result.claimId).toBe('c1');
    const created = useStore.getState().data.approvals.filter((a) => a.claimId === 'c1');
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((a) => a.autoAccepted === true)).toBe(true);
    expect(created.every((a) => typeof a.autoAcceptedAt === 'number' && a.autoAcceptedAt! >= before)).toBe(true);
  });

  it('commitAutoAcceptItem throws (does not commit) for an ineligible item', async () => {
    const preview = await buildApprovalPreview({ confidence: 95, blockers: [], ambiguous: false });
    const item = stagingWithPreview(preview);
    const state = useStore.getState();
    await expect(
      commitAutoAcceptItem(item, {
        commitParsedApproval: state.commitParsedApproval,
        commitParsedDecline: state.commitParsedDecline,
      }),
    ).rejects.toThrow(/not eligible/);
    expect(useStore.getState().data.approvals).toHaveLength(0);
  });

  it('runAutoAccept continues past a mid-batch failure: the rest complete, the failed one leaves no orphaned records', async () => {
    const previewA = await buildApprovalPreview({
      confidence: 100,
      blockers: [],
      ambiguous: false,
      patientName: 'George Bellingham',
      fileName: 'letter-a.pdf',
    });
    const previewB = await buildApprovalPreview({
      confidence: 100,
      blockers: [],
      ambiguous: false,
      patientName: 'Someone New',
      fileName: 'letter-b.pdf',
      patientId: undefined,
      claimId: undefined,
      patientPatch: { name: 'Someone New', nhi: 'ZZZ9999', dob: '1980-01-01' },
      claimPatch: { claimNumber: '99999999999', acc45Number: 'YZ00000', poNumber: '12345678' },
    });
    const previewC = await buildApprovalPreview({
      confidence: 100,
      blockers: [],
      ambiguous: false,
      patientName: 'George Bellingham',
      fileName: 'letter-c.pdf',
    });
    const itemA = stagingWithPreview(previewA, { id: 'staging-a', title: 'Letter A' });
    const itemB = stagingWithPreview(previewB, { id: 'staging-b', title: 'Letter B' });
    const itemC = stagingWithPreview(previewC, { id: 'staging-c', title: 'Letter C' });

    // Letter B's document write fails partway through the batch; A and C succeed.
    let call = 0;
    vi.mocked(saveDocumentBlob).mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error('disk full');
    });

    const state = useStore.getState();
    const priorPatients = useStore.getState().data.patients;
    const progressCalls: number[] = [];
    const outcomes = await runAutoAccept(
      [itemA, itemB, itemC],
      { commitParsedApproval: state.commitParsedApproval, commitParsedDecline: state.commitParsedDecline },
      (p) => progressCalls.push(p.index),
    );

    expect(progressCalls).toEqual([1, 2, 3]);
    expect(outcomes).toHaveLength(3);
    expect(outcomes[0].ok).toBe(true);
    expect(outcomes[1].ok).toBe(false);
    expect(outcomes[1].error).toMatch(/disk full/);
    expect(outcomes[2].ok).toBe(true);

    const data = useStore.getState().data;
    // B's would-be new patient/claim never persisted (rollback-safe commit path).
    expect(data.patients.some((p) => p.name === 'Someone New')).toBe(false);
    expect(data.claims.some((c) => c.claimNumber === '99999999999')).toBe(false);
    // A and C's approvals for the existing claim did get created and tagged.
    const approvalsForC1 = data.approvals.filter((a) => a.claimId === 'c1');
    expect(approvalsForC1.length).toBeGreaterThan(0);
    expect(approvalsForC1.every((a) => a.autoAccepted)).toBe(true);
    // No unrelated existing data was touched by the failed attempt.
    expect(data.patients.filter((p) => priorPatients.some((pp) => pp.id === p.id))).toHaveLength(
      priorPatients.length,
    );
  });
});
