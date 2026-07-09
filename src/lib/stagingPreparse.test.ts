import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  __resetStagingPreparseForTests,
  buildStagingPreview,
  enqueueStagingPreparse,
  patientHintsFromParse,
  retryUnnamedStagingPreparse,
} from './stagingPreparse';
import { createStagingItem, type StagingItem } from './staging';
import type { LetterParseResult } from './letterImport';

const parseCache = new Map<string, unknown>();
const blobCache = new Map<string, Blob>();

vi.mock('./letterCache', () => ({
  getCachedLetterParse: vi.fn(async (hash: string) => parseCache.get(hash)),
  putCachedLetterParse: vi.fn(async (hash: string, preview: unknown) => {
    parseCache.set(hash, preview);
  }),
  getCachedLetterBlob: vi.fn(async (hash: string) => blobCache.get(hash)),
  putCachedLetterBlob: vi.fn(async (hash: string, blob: Blob) => {
    blobCache.set(hash, blob);
  }),
  blobToBase64: vi.fn(async () => 'cGRm'),
}));

vi.mock('./localAccBridge', () => ({
  fetchInboxFileForStaging: vi.fn(async () => undefined),
}));

vi.mock('./staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./staging')>();
  return {
    ...actual,
    updateStagingItem: vi.fn(async () => {}),
  };
});

const parseLetterFile = vi.fn(async () => ({}) as LetterParseResult);

vi.mock('../state/store', () => ({
  useStore: {
    getState: () => ({
      parseLetterFile,
    }),
  },
}));

import { updateStagingItem } from './staging';
import { putCachedLetterParse } from './letterCache';
import { fetchInboxFileForStaging } from './localAccBridge';

describe('stagingPreparse', () => {
  beforeEach(() => {
    __resetStagingPreparseForTests();
    parseCache.clear();
    blobCache.clear();
    vi.mocked(updateStagingItem).mockClear();
    vi.mocked(fetchInboxFileForStaging).mockReset();
    vi.mocked(fetchInboxFileForStaging).mockResolvedValue(undefined);
    parseLetterFile.mockReset();
    parseLetterFile.mockResolvedValue({} as LetterParseResult);
  });

  it('denormalizes patient hints from cache hit without writing parsedPreview on item', async () => {
    const hash = 'e'.repeat(64);
    const item = createStagingItem({
      id: 'item-1',
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: letter.pdf',
      summary: 'Test',
      sourceHash: hash,
    });
    await putCachedLetterParse(hash, {
      kind: 'approval',
      confidence: 95,
      patientName: 'Cached Patient',
      claimNumber: 'P999',
      parsed: {
        kind: 'approval',
        letterDate: '',
        patient: { name: 'Cached Patient', nhi: '', dob: '' },
        claim: { claimNumber: 'P999', acc45Number: '', poNumber: '', injuryDescription: '', dateOfInjury: '' },
        serviceRows: [],
        packageRows: [],
      },
      fileBlobBase64: 'cGRm',
      fileName: 'letter.pdf',
      mimeType: 'application/pdf',
    });

    enqueueStagingPreparse([item]);
    await new Promise((r) => setTimeout(r, 50));

    expect(updateStagingItem).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ patientName: 'Cached Patient', claimNumber: 'P999' }),
    );
    const patch = vi.mocked(updateStagingItem).mock.calls[0]?.[1] as StagingItem;
    expect(patch?.parsedPreview).toBeUndefined();
  });

  it('buildStagingPreview returns null for low confidence', () => {
    const file = new File(['x'], 'letter.pdf', { type: 'application/pdf' });
    const result = {
      parsed: null,
      overallConfidence: 50,
      issues: [],
      blockers: [],
      match: {},
    } as unknown as LetterParseResult;
    expect(buildStagingPreview(result, file, 'cGRm')).toBeNull();
  });

  it('patientHintsFromParse extracts name from a low-confidence parse', () => {
    const result = {
      parsed: {
        kind: 'approval',
        letterDate: '',
        patient: { name: 'Partial Name', nhi: '', dob: '' },
        claim: { claimNumber: 'P1', acc45Number: '', poNumber: '', injuryDescription: '', dateOfInjury: '' },
        serviceRows: [],
        packageRows: [],
      },
      overallConfidence: 40,
      issues: [],
      blockers: [],
      match: {},
    } as unknown as LetterParseResult;
    expect(patientHintsFromParse(result)).toEqual({
      patientName: 'Partial Name',
      claimNumber: 'P1',
    });
  });

  it('writes list names from a partial parse when full preview is not eligible', async () => {
    const hash = 'a'.repeat(64);
    const item = createStagingItem({
      id: 'item-partial',
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: letter.pdf',
      summary: 'Test',
      sourceHash: hash,
    });
    blobCache.set(hash, new Blob(['pdf'], { type: 'application/pdf' }));
    parseLetterFile.mockResolvedValue({
      parsed: {
        kind: 'approval',
        letterDate: '',
        patient: { name: 'Low Conf Patient', nhi: '', dob: '' },
        claim: {
          claimNumber: 'P42',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          dateOfInjury: '',
        },
        serviceRows: [],
        packageRows: [],
      },
      overallConfidence: 40,
      issues: [{ message: 'check', blocking: true }],
      blockers: ['check'],
      match: {},
    } as unknown as LetterParseResult);

    enqueueStagingPreparse([item]);
    await new Promise((r) => setTimeout(r, 80));

    expect(updateStagingItem).toHaveBeenCalledWith(
      'item-partial',
      expect.objectContaining({ patientName: 'Low Conf Patient', claimNumber: 'P42' }),
    );
  });

  it('retryUnnamedStagingPreparse requeues unnamed items after a miss', async () => {
    const hash = 'b'.repeat(64);
    const item = createStagingItem({
      id: 'item-retry',
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Folder: letter.pdf',
      summary: 'Test',
      sourceHash: hash,
    });

    enqueueStagingPreparse([item]);
    await new Promise((r) => setTimeout(r, 50));
    expect(updateStagingItem).not.toHaveBeenCalled();

    vi.mocked(fetchInboxFileForStaging).mockResolvedValue(
      new File(['pdf'], 'letter.pdf', { type: 'application/pdf' }),
    );
    parseLetterFile.mockResolvedValue({
      parsed: {
        kind: 'decline',
        letterDate: '',
        patient: { name: 'Retry Patient', nhi: '', dob: '' },
        claim: {
          claimNumber: 'P77',
          acc45Number: '',
          poNumber: '',
          injuryDescription: '',
          dateOfInjury: '',
        },
        reason: 'x',
        serviceRequested: '',
      },
      overallConfidence: 95,
      issues: [],
      blockers: [],
      match: {},
    } as unknown as LetterParseResult);

    const n = retryUnnamedStagingPreparse([item]);
    expect(n).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(updateStagingItem).toHaveBeenCalledWith(
      'item-retry',
      expect.objectContaining({ patientName: 'Retry Patient' }),
    );
  });
});
