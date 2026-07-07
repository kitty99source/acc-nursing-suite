// ============================================================================
// Full backup bundle (.zip). The everyday .accdata file stays lightweight and
// holds only document *metadata*; the actual file bytes live in IndexedDB. This
// bundle packages the data JSON together with every document blob so a user can
// move everything to another machine or keep an offline archive. Everything is
// built in-browser — no network involved.
// ============================================================================

import JSZip from 'jszip';
import type { AppData } from '../types';
import { hashBlob, sha256Text } from './crypto';

const MANIFEST_FORMAT = { format: 'accdata-backup', version: 1 } as const;

export interface BackupBlobChecksum {
  sizeBytes: number;
  sha256: string;
}

export interface BackupManifest {
  format: 'accdata-backup';
  version: number;
  documentMetadataCount: number;
  documentBlobCount: number;
  dataJsonBytes: number;
  /** SHA-256 of data.json UTF-8 bytes (P3-004). */
  dataJsonSha256: string;
  /** Per-document blob checksums keyed by document id. */
  blobs: Record<string, BackupBlobChecksum>;
}

export async function buildBackupZip(
  data: AppData,
  getBlob: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
  const zip = new JSZip();
  const dataJson = JSON.stringify(data, null, 2);
  let blobCount = 0;
  const blobChecksums: Record<string, BackupBlobChecksum> = {};
  const folder = zip.folder('documents');
  if (folder) {
    for (const doc of data.documents) {
      const blob = await getBlob(doc.id);
      if (blob) {
        folder.file(doc.id, blob);
        blobCount++;
        blobChecksums[doc.id] = {
          sizeBytes: blob.size,
          sha256: await hashBlob(blob),
        };
      }
    }
  }
  const manifest: BackupManifest = {
    ...MANIFEST_FORMAT,
    documentMetadataCount: data.documents.length,
    documentBlobCount: blobCount,
    dataJsonBytes: dataJson.length,
    dataJsonSha256: await sha256Text(dataJson),
    blobs: blobChecksums,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('data.json', dataJson);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export interface BackupContents {
  data: AppData;
  blobs: Map<string, Blob>;
}

async function validateBackupManifest(
  zip: JSZip,
  manifest: Partial<BackupManifest>,
  dataJsonText: string,
): Promise<void> {
  if (manifest.dataJsonSha256) {
    const actual = await sha256Text(dataJsonText);
    if (actual !== manifest.dataJsonSha256) {
      throw new Error('Full backup failed checksum validation (data.json was modified or corrupt).');
    }
  }

  if (!manifest.blobs || Object.keys(manifest.blobs).length === 0) return;

  const folder = zip.folder('documents');
  if (!folder) {
    throw new Error('Full backup failed checksum validation (document blobs missing).');
  }

  for (const [docId, expected] of Object.entries(manifest.blobs)) {
    const entry = folder.file(docId);
    if (!entry) {
      throw new Error(`Full backup failed checksum validation (missing document blob ${docId}).`);
    }
    const blob = await entry.async('blob');
    if (blob.size !== expected.sizeBytes) {
      throw new Error(`Full backup failed checksum validation (size mismatch for ${docId}).`);
    }
    const sha256 = await hashBlob(blob);
    if (sha256 !== expected.sha256) {
      throw new Error(`Full backup failed checksum validation (hash mismatch for ${docId}).`);
    }
  }
}

export async function readBackupZip(input: Blob): Promise<BackupContents> {
  const zip = await JSZip.loadAsync(input);
  const manifestFile = zip.file('manifest.json');
  let manifest: Partial<BackupManifest> | undefined;
  if (manifestFile) {
    try {
      manifest = JSON.parse(await manifestFile.async('string')) as Partial<BackupManifest>;
      if (manifest.format !== MANIFEST_FORMAT.format) {
        throw new Error('This ZIP is not a valid ACC full backup (unrecognised manifest).');
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        throw new Error('This ZIP is not a valid full backup (manifest is corrupt).');
      }
      throw err;
    }
  }
  const dataFile = zip.file('data.json');
  if (!dataFile) {
    throw new Error('This ZIP is not a valid full backup (data.json is missing).');
  }
  const dataJsonText = await dataFile.async('string');
  let data: AppData;
  try {
    data = JSON.parse(dataJsonText) as AppData;
  } catch {
    throw new Error('This ZIP is not a valid full backup (data.json is corrupt).');
  }
  if (!Array.isArray(data.patients)) {
    throw new Error('This ZIP is not a valid full backup (data.json is missing patients).');
  }

  if (manifest) {
    await validateBackupManifest(zip, manifest, dataJsonText);
  }

  const blobs = new Map<string, Blob>();
  const folder = zip.folder('documents');
  if (folder) {
    const entries: { id: string; file: JSZip.JSZipObject }[] = [];
    folder.forEach((relativePath, file) => {
      if (!file.dir) entries.push({ id: relativePath, file });
    });
    for (const { id, file } of entries) {
      blobs.set(id, await file.async('blob'));
    }
  }
  return { data, blobs };
}
