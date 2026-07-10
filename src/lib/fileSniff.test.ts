import { describe, it, expect } from 'vitest';
import { extensionForKind, hasFileExtension, sniffFileKind, withExtensionForKind } from './fileSniff';

// A real (minimal but syntactically valid) PDF byte sequence — the magic
// number check only needs the header, so a short document is enough.
const PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
const PLAIN_TEXT_BYTES = new TextEncoder().encode('just some plain text, not a pdf');

describe('sniffFileKind', () => {
  it('identifies a PDF from its magic number regardless of name/mime', async () => {
    // Nameless/typeless blob — exactly the "GUID download with no extension"
    // shape reported by the user; the bytes are what must carry the truth.
    const blob = new Blob([PDF_BYTES], { type: 'application/octet-stream' });
    expect(await sniffFileKind(blob)).toBe('pdf');
  });

  it('identifies a zip-based (docx) file from its magic number', async () => {
    const blob = new Blob([ZIP_BYTES]);
    expect(await sniffFileKind(blob)).toBe('docx');
  });

  it('returns unknown for content that matches neither magic number', async () => {
    const blob = new Blob([PLAIN_TEXT_BYTES]);
    expect(await sniffFileKind(blob)).toBe('unknown');
  });

  it('returns unknown for an empty blob without throwing', async () => {
    expect(await sniffFileKind(new Blob([]))).toBe('unknown');
  });

  it('only reads the first few bytes, not the whole file', async () => {
    // A huge blob whose head is a PDF magic number should still resolve fast
    // and correctly — sniffFileKind must not need the full body.
    const big = new Uint8Array(5_000_000);
    big.set(PDF_BYTES.subarray(0, 8));
    const blob = new Blob([big]);
    expect(await sniffFileKind(blob)).toBe('pdf');
  });
});

describe('hasFileExtension / extensionForKind / withExtensionForKind', () => {
  it('recognizes a real extension and rejects a bare GUID', () => {
    expect(hasFileExtension('letter.pdf')).toBe(true);
    expect(hasFileExtension('2d5d827c-94cd-46f7-8e3e-0ba051001379')).toBe(false);
    expect(hasFileExtension('')).toBe(false);
    expect(hasFileExtension(undefined)).toBe(false);
  });

  it('maps sniffed kinds to the correct extension', () => {
    expect(extensionForKind('pdf')).toBe('.pdf');
    expect(extensionForKind('docx')).toBe('.docx');
    expect(extensionForKind('unknown')).toBeUndefined();
  });

  it('appends the right extension to an extensionless name, leaves a named file alone', () => {
    expect(withExtensionForKind('2d5d827c-94cd-46f7-8e3e-0ba051001379', 'pdf')).toBe(
      '2d5d827c-94cd-46f7-8e3e-0ba051001379.pdf',
    );
    expect(withExtensionForKind('letter.docx', 'pdf')).toBe('letter.docx');
    expect(withExtensionForKind('2d5d827c-94cd-46f7-8e3e-0ba051001379', 'unknown')).toBe(
      '2d5d827c-94cd-46f7-8e3e-0ba051001379',
    );
  });
});
