import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  HRQ_BATCH_MIN_CONFIDENCE,
  allSelectedBatchApprovable,
  commitBatchStagingItem,
  commitBatchStagingItems,
  isBatchApprovable,
  isStagingParsedPreview,
  previewToFile,
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
