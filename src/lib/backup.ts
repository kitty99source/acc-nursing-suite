// ============================================================================
// Full backup bundle (.zip). The everyday .accdata file stays lightweight and
// holds only document *metadata*; the actual file bytes live in IndexedDB. This
// bundle packages the data JSON together with every document blob so a user can
// move everything to another machine or keep an offline archive. Everything is
// built in-browser — no network involved.
// ============================================================================

import JSZip from 'jszip';
import type { AppData } from '../types';

const MANIFEST_FORMAT = { format: 'accdata-backup', version: 1 } as const;

export interface BackupManifest {
  format: 'accdata-backup';
  version: number;
  documentMetadataCount: number;
  documentBlobCount: number;
  dataJsonBytes: number;
}

export async function buildBackupZip(
  data: AppData,
  getBlob: (id: string) => Promise<Blob | undefined>,
): Promise<Blob> {
  const zip = new JSZip();
  const dataJson = JSON.stringify(data, null, 2);
  let blobCount = 0;
  const folder = zip.folder('documents');
  if (folder) {
    for (const doc of data.documents) {
      const blob = await getBlob(doc.id);
      if (blob) {
        folder.file(doc.id, blob);
        blobCount++;
      }
    }
  }
  const manifest: BackupManifest = {
    ...MANIFEST_FORMAT,
    documentMetadataCount: data.documents.length,
    documentBlobCount: blobCount,
    dataJsonBytes: dataJson.length,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('data.json', dataJson);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

export interface BackupContents {
  data: AppData;
  blobs: Map<string, Blob>;
}

export async function readBackupZip(input: Blob): Promise<BackupContents> {
  const zip = await JSZip.loadAsync(input);
  const manifestFile = zip.file('manifest.json');
  if (manifestFile) {
    try {
      const manifest = JSON.parse(await manifestFile.async('string')) as Partial<BackupManifest>;
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
  let data: AppData;
  try {
    data = JSON.parse(await dataFile.async('string')) as AppData;
  } catch {
    throw new Error('This ZIP is not a valid full backup (data.json is corrupt).');
  }
  if (!Array.isArray(data.patients)) {
    throw new Error('This ZIP is not a valid full backup (data.json is missing patients).');
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
