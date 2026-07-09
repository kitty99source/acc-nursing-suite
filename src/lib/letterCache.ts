// ============================================================================
// Letter byte + parse cache — keyed by SHA-256 hash for offline Review Queue.
// ============================================================================

import { loadLetterBlob, saveLetterBlob, loadLetterParse, saveLetterParse } from './idb';
import { isStagingParsedPreview, previewToFile, type StagingParsedPreview } from './hrqBatch';

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function getCachedLetterParse(hash: string): Promise<StagingParsedPreview | undefined> {
  const raw = await loadLetterParse(hash);
  return isStagingParsedPreview(raw) ? raw : undefined;
}

export async function putCachedLetterParse(hash: string, preview: StagingParsedPreview): Promise<void> {
  await saveLetterParse(hash, preview);
}

export async function getCachedLetterBlob(hash: string): Promise<Blob | undefined> {
  return loadLetterBlob(hash);
}

export async function putCachedLetterBlob(hash: string, blob: Blob): Promise<void> {
  await saveLetterBlob(hash, blob);
}

export async function getCachedLetterFile(
  hash: string,
  preferredName?: string,
  mime?: string,
): Promise<File | undefined> {
  const blob = await loadLetterBlob(hash);
  if (blob?.size) {
    const name = preferredName?.trim() || 'letter.bin';
    return new File([blob], name, { type: mime || blob.type || 'application/octet-stream' });
  }
  const preview = await getCachedLetterParse(hash);
  if (!preview) return undefined;
  const file = previewToFile(preview);
  const name = preferredName?.trim();
  if (name && name !== file.name) {
    return new File([file], name, { type: mime || file.type });
  }
  return file;
}
