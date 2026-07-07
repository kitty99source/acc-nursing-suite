import { describe, it, expect } from 'vitest';
import { buildBackupZip, readBackupZip } from './backup';
import { emptyData } from './sampleData';

describe('backup manifest checksums (P3-004)', () => {
  it('writes data.json and per-blob SHA-256 checksums', async () => {
    const data = {
      ...emptyData(),
      documents: [
        {
          id: 'doc1',
          claimId: 'c1',
          kind: 'acc-approval-letter' as const,
          fileName: 'letter.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 11,
          uploadedAt: 1,
        },
      ],
    };
    const blob = new Blob(['hello world'], { type: 'application/pdf' });
    const zip = await buildBackupZip(data, async (id) => (id === 'doc1' ? blob : undefined));

    const JSZip = (await import('jszip')).default;
    const parsed = await JSZip.loadAsync(zip);
    const manifest = JSON.parse(await parsed.file('manifest.json')!.async('string')) as {
      dataJsonSha256: string;
      blobs: Record<string, { sizeBytes: number; sha256: string }>;
    };

    expect(manifest.dataJsonSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.blobs.doc1.sizeBytes).toBe(blob.size);
    expect(manifest.blobs.doc1.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates checksums on restore and rejects tampered data.json', async () => {
    const data = { ...emptyData(), settings: { ...emptyData().settings, notes: 'original' } };
    const zip = await buildBackupZip(data, async () => undefined);

    const JSZip = (await import('jszip')).default;
    const parsed = await JSZip.loadAsync(zip);
    const dataFile = parsed.file('data.json')!;
    const tampered = (await dataFile.async('string')).replace('"original"', '"tampered"');
    parsed.file('data.json', tampered);
    const tamperedZip = await parsed.generateAsync({ type: 'blob' });

    await expect(readBackupZip(tamperedZip)).rejects.toThrow(/checksum validation/i);
  });

  it('round-trips intact backup', async () => {
    const data = emptyData();
    const sourceBlob = new Blob(['pdf-bytes'], { type: 'application/pdf' });
    const blobMap = new Map([['doc1', sourceBlob]]);
    const dataWithDoc = {
      ...data,
      documents: [
        {
          id: 'doc1',
          claimId: 'c1',
          kind: 'acc-approval-letter' as const,
          fileName: 'letter.pdf',
          mimeType: 'application/pdf',
          sizeBytes: sourceBlob.size,
          uploadedAt: 1,
        },
      ],
    };
    const zip = await buildBackupZip(dataWithDoc, async (id) => blobMap.get(id));
    const restored = await readBackupZip(zip);
    expect(restored.data.patients.length).toBe(data.patients.length);
    expect(restored.blobs.get('doc1')?.size).toBe(sourceBlob.size);
  });
});
