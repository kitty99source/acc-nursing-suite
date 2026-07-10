// ============================================================================
// Letter byte + parse cache — keyed by SHA-256 hash for offline Review Queue.
// ============================================================================

import { loadLetterBlob, saveLetterBlob, loadLetterParse, saveLetterParse } from './idb';
import {
  isStagingParsedPreview,
  previewToFile,
  LETTER_PARSER_VERSION,
  type StagingParsedPreview,
} from './hrqBatch';

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

/** Best-effort MIME from a filename extension (bridge often returns octet-stream). */
export function mimeFromName(name?: string): string | undefined {
  const n = (name ?? '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return undefined;
}

function isGenericMime(mime?: string): boolean {
  return !mime || mime === 'application/octet-stream' || mime === 'application/binary';
}

export function base64ToBlob(base64: string, mime = 'application/octet-stream'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Any cached parse regardless of parser version — used as an offline fallback
 *  when the letter bytes can't be re-fetched to re-parse. */
export async function getCachedLetterParseAny(
  hash: string,
): Promise<StagingParsedPreview | undefined> {
  const raw = await loadLetterParse(hash);
  return isStagingParsedPreview(raw) ? raw : undefined;
}

/** Cached parse only if produced by the CURRENT parser version. A version miss
 *  returns undefined so callers re-parse from bytes (transparent backfill). */
export async function getCachedLetterParse(hash: string): Promise<StagingParsedPreview | undefined> {
  const preview = await getCachedLetterParseAny(hash);
  if (!preview) return undefined;
  return preview.parserVersion === LETTER_PARSER_VERSION ? preview : undefined;
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
    const type =
      mime ||
      (isGenericMime(blob.type) ? mimeFromName(name) : undefined) ||
      blob.type ||
      'application/octet-stream';
    return new File([blob], name, { type });
  }
  const preview = await getCachedLetterParse(hash);
  if (!preview) return undefined;
  const file = previewToFile(preview);
  const name = preferredName?.trim();
  const type =
    mime || (isGenericMime(file.type) ? mimeFromName(name || file.name) : undefined) || file.type;
  if ((name && name !== file.name) || type !== file.type) {
    return new File([file], name || file.name, { type });
  }
  return file;
}
