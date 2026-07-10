// ============================================================================
// Content-based file kind detection ("sniffing") — a positive fallback for
// when a filename/MIME-type check is inconclusive (e.g. a bridge-resolved
// file with a generic name like a GUID and `application/octet-stream`).
// Deliberately dependency-free (no pdf.js/mammoth) so it's cheap to import
// anywhere a name/mime heuristic might be wrong, including UI components.
// ============================================================================

export type SniffedFileKind = 'pdf' | 'docx' | 'unknown';

// PDF files start with the literal bytes "%PDF-".
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];
// DOCX (and other Office Open XML / zip-based) files start with the ZIP
// local file header signature "PK\x03\x04". Not PDF-specific, but useful as
// a secondary signal to distinguish "zip-based Office doc" from "unknown".
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function startsWithMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Read the first `byteLength` bytes of `blob`. Prefers `Blob#arrayBuffer`
 * (fast, no extra event-loop hop); some Blob polyfills — notably jsdom in
 * the test environment — implement `slice()` but not `arrayBuffer()` on the
 * result, so fall back to the universally-supported FileReader API.
 */
async function readHeadBytes(blob: Blob, byteLength: number): Promise<Uint8Array> {
  const head = blob.slice(0, byteLength);
  if (typeof head.arrayBuffer === 'function') {
    return new Uint8Array(await head.arrayBuffer());
  }
  const buf = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(head);
  });
  return new Uint8Array(buf);
}

/**
 * Positively identify a PDF (or zip-based Office doc) from its first bytes,
 * regardless of filename or MIME type. Reads only the first 8 bytes of the
 * blob so this is cheap even for large attachments.
 */
export async function sniffFileKind(file: Blob): Promise<SniffedFileKind> {
  try {
    const head = await readHeadBytes(file, 8);
    if (startsWithMagic(head, PDF_MAGIC)) return 'pdf';
    if (startsWithMagic(head, ZIP_MAGIC)) return 'docx';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** File extension for a sniffed/known file kind, for building a safe download name. */
export function extensionForKind(kind: SniffedFileKind): string | undefined {
  if (kind === 'pdf') return '.pdf';
  if (kind === 'docx') return '.docx';
  return undefined;
}

/** True if `name` ends with a recognizable file extension (e.g. "letter.pdf", not a bare GUID). */
export function hasFileExtension(name: string | undefined | null): boolean {
  return /\.[a-z0-9]{1,8}$/i.test((name ?? '').trim());
}

/**
 * Ensure `name` ends with the correct extension for `kind`. If `name` already
 * has *some* extension, it's trusted and left untouched — this only repairs
 * genuinely extensionless names (e.g. a GUID-only filename) so a download
 * link never hands the OS a file it can't open with the right app.
 */
export function withExtensionForKind(name: string, kind: SniffedFileKind): string {
  const trimmed = name.trim() || 'attachment';
  if (hasFileExtension(trimmed)) return trimmed;
  const ext = extensionForKind(kind);
  return ext ? `${trimmed}${ext}` : trimmed;
}
