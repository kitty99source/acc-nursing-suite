import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  base64ToBlob,
  blobToBase64,
  getCachedLetterBlob,
  getCachedLetterFile,
  getCachedLetterParse,
  putCachedLetterBlob,
  putCachedLetterParse,
} from './letterCache';
import type { StagingParsedPreview } from './hrqBatch';

const letterBlobs = new Map<string, Blob>();
const letterParses = new Map<string, unknown>();

vi.mock('./idb', () => ({
  loadLetterBlob: vi.fn(async (hash: string) => letterBlobs.get(hash)),
  saveLetterBlob: vi.fn(async (hash: string, blob: Blob) => {
    letterBlobs.set(hash, blob);
  }),
  loadLetterParse: vi.fn(async (hash: string) => letterParses.get(hash)),
  saveLetterParse: vi.fn(async (hash: string, record: unknown) => {
    letterParses.set(hash, record);
  }),
}));

function samplePreview(base64: string): StagingParsedPreview {
  return {
    kind: 'approval',
    confidence: 95,
    patientName: 'Jane Doe',
    claimNumber: 'P123',
    parsed: {
      kind: 'approval',
      letterDate: '2024-01-01',
      patient: { name: 'Jane Doe', nhi: '', dob: '' },
      claim: { claimNumber: 'P123', acc45Number: '', poNumber: '', injuryDescription: '', dateOfInjury: '' },
      serviceRows: [],
      packageRows: [],
    },
    fileBlobBase64: base64,
    fileName: 'letter.pdf',
    mimeType: 'application/pdf',
    rows: [],
  };
}

describe('letterCache', () => {
  beforeEach(() => {
    letterBlobs.clear();
    letterParses.clear();
  });

  it('round-trips blob base64', async () => {
    const blob = new Blob(['hello-pdf'], { type: 'application/pdf' });
    const b64 = await blobToBase64(blob);
    const back = base64ToBlob(b64, 'application/pdf');
    expect(back.size).toBe(blob.size);
    expect(back.type).toBe('application/pdf');
    expect(b64).toBe(btoa('hello-pdf'));
  });

  it('stores and loads parse previews by hash', async () => {
    const hash = 'a'.repeat(64);
    const preview = samplePreview('cGRm');
    await putCachedLetterParse(hash, preview);
    const loaded = await getCachedLetterParse(hash);
    expect(loaded?.patientName).toBe('Jane Doe');
    expect(loaded?.claimNumber).toBe('P123');
  });

  it('stores and loads letter blobs by hash', async () => {
    const hash = 'b'.repeat(64);
    const blob = new Blob(['bytes'], { type: 'application/pdf' });
    await putCachedLetterBlob(hash, blob);
    const loaded = await getCachedLetterBlob(hash);
    expect(loaded?.size).toBe(blob.size);
    expect(loaded?.type).toBe('application/pdf');
  });

  it('builds a File from cached blob with preferred name', async () => {
    const hash = 'c'.repeat(64);
    await putCachedLetterBlob(hash, new Blob(['pdf'], { type: 'application/pdf' }));
    const file = await getCachedLetterFile(hash, 'vendor-letter.pdf');
    expect(file?.name).toBe('vendor-letter.pdf');
    expect(file?.type).toBe('application/pdf');
  });

  it('falls back to cached parse base64 when blob is missing', async () => {
    const hash = 'd'.repeat(64);
    const b64 = btoa('from-preview');
    await putCachedLetterParse(hash, samplePreview(b64));
    const file = await getCachedLetterFile(hash, 'letter.pdf');
    expect(file?.name).toBe('letter.pdf');
    expect(file?.size).toBeGreaterThan(0);
    expect(file?.type).toBe('application/pdf');
  });
});
