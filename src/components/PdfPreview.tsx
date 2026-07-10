import { useEffect, useMemo, useState } from 'react';
import { sniffFileKind, withExtensionForKind, type SniffedFileKind } from '../lib/fileSniff';

const PDF_MIME = 'application/pdf';

/**
 * Blob: URLs are opaque (no filename, no extension) — a browser's built-in
 * PDF-viewer plugin decides whether an `<iframe src={blobUrl}>` renders
 * inline or triggers a silent download based ONLY on the Blob's actual
 * `type` property at `URL.createObjectURL` time, never the filename/extension.
 * So even after name- or byte-sniff-based PDF detection correctly identifies
 * a file as a PDF, we still have to hand `createObjectURL` a Blob whose
 * `type` is actually `application/pdf` — otherwise Chrome/Edge download the
 * file instead of rendering it, and the `<iframe>` never even gets a chance
 * to fire an error/fallback (this was the root cause of "preview pane blank,
 * file auto-downloads" for attachments whose name/bytes said PDF but whose
 * `Blob#type` was left as a generic `application/octet-stream`/`''`).
 */
function withPdfMime(file: File | Blob): File | Blob {
  if (file.type === PDF_MIME) return file;
  if (file instanceof File) return new File([file], file.name, { type: PDF_MIME });
  return new Blob([file], { type: PDF_MIME });
}

/**
 * Offline-friendly PDF (or image) preview via object URL.
 * Caller owns the File; this component only creates/revokes the blob URL.
 */
export function PdfPreview({
  file,
  title,
  text,
  className = '',
  height = 480,
}: {
  file: File | Blob | null | undefined;
  title?: string;
  /** Extracted letter text, shown as a readable fallback for Word/unpreviewable files. */
  text?: string;
  className?: string;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [sniffedKind, setSniffedKind] = useState<SniffedFileKind | null>(null);

  const mime = file ? file.type || '' : '';
  const nameHasPdfExt = file instanceof File && /\.pdf$/i.test(file.name);
  const mimeIsPdf = mime.includes('pdf');
  const isImage = mime.startsWith('image/');
  // Name/MIME both inconclusive (e.g. a bridge-resolved file with a generic
  // GUID-ish name and application/octet-stream type) — sniff the actual
  // bytes for the %PDF- magic number before giving up on an inline preview.
  // This is what makes a correctly-byte'd-but-mis-named/mis-typed PDF still
  // render, instead of silently falling back to a "no preview" download link.
  useEffect(() => {
    setSniffedKind(null);
    if (!file || mimeIsPdf || nameHasPdfExt || isImage) return;
    let cancelled = false;
    void sniffFileKind(file).then((kind) => {
      if (!cancelled) setSniffedKind(kind);
    });
    return () => {
      cancelled = true;
    };
  }, [file, mimeIsPdf, nameHasPdfExt, isImage]);

  const isPdf = mimeIsPdf || nameHasPdfExt || sniffedKind === 'pdf';

  // Build the object URL from a Blob/File that's guaranteed to carry the
  // `application/pdf` MIME type whenever we've determined (by mime, name
  // extension, or byte-sniff) that the content actually is a PDF — see
  // `withPdfMime` above for why this matters. Recomputes (and the effect
  // below revokes the stale URL) whenever `isPdf` flips true after an async
  // sniff resolves, so the iframe always ends up pointed at a correctly
  // MIME-typed blob, never the original possibly-generic one.
  const url = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(isPdf && !mimeIsPdf ? withPdfMime(file) : file);
  }, [file, isPdf, mimeIsPdf]);

  useEffect(() => {
    setFailed(false);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  // A CSP frame-src/object-src violation blocking the blob: iframe does NOT reliably fire the
  // <iframe>'s onError — Chrome/Edge just render "This content is blocked" inside the frame.
  // The browser does dispatch a document-level `securitypolicyviolation` event for it, though,
  // so listen for that as a defensive fallback in case the CSP is ever loosened incorrectly.
  useEffect(() => {
    if (!url) return;
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      const directive = e.effectiveDirective || e.violatedDirective || '';
      if (
        (directive === 'frame-src' || directive === 'object-src' || directive === 'child-src') &&
        (e.blockedURI === 'blob' || e.blockedURI?.startsWith('blob:'))
      ) {
        setFailed(true);
      }
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, [url]);

  if (!file || !url) {
    return (
      <div
        className={`flex items-center justify-center rounded-card text-sm ${className}`}
        style={{
          height,
          color: 'var(--muted)',
          border: '1px dashed var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        No attachment loaded yet
      </div>
    );
  }

  // Best-effort kind for repairing an extensionless download name: prefer the
  // sniffed result (authoritative), otherwise fall back to what the render
  // path above already decided.
  const detectedKind: SniffedFileKind = sniffedKind ?? (isPdf ? 'pdf' : 'unknown');
  const rawDownloadName = file instanceof File ? file.name : title || 'letter';
  const downloadName = withExtensionForKind(rawDownloadName, detectedKind);
  const hasText = Boolean(text?.trim());

  const textFallback = (heading: string) => (
    <div
      className={`flex flex-col rounded-card ${className}`}
      style={{ height, border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs"
        style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted)' }}
      >
        <span>{heading}</span>
        <a className="underline shrink-0" href={url} download={downloadName}>
          Download original
        </a>
      </div>
      <pre
        className="flex-1 overflow-auto m-0 p-3 text-xs whitespace-pre-wrap"
        style={{ color: 'var(--text)', fontFamily: 'inherit' }}
      >
        {text}
      </pre>
    </div>
  );

  if (failed) {
    if (hasText) return textFallback('Text preview (in-browser preview unavailable)');
    return (
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-card text-sm p-4 ${className}`}
        style={{
          height,
          color: 'var(--muted)',
          border: '1px dashed var(--border)',
          background: 'var(--surface-2)',
        }}
      >
        <p>Could not preview this file in-browser.</p>
        <a className="underline" href={url} download={downloadName}>
          Download attachment
        </a>
      </div>
    );
  }

  if (isImage) {
    return (
      <div
        className={`overflow-auto rounded-card ${className}`}
        style={{ height, border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <img
          src={url}
          alt={title || 'Letter attachment'}
          className="max-w-full h-auto mx-auto"
          onError={() => setFailed(true)}
        />
      </div>
    );
  }

  if (isPdf) {
    return (
      <iframe
        title={title || 'Letter PDF'}
        src={url}
        className={`w-full rounded-card ${className}`}
        style={{ height, border: '1px solid var(--border)', background: 'var(--surface)' }}
        onError={() => setFailed(true)}
      />
    );
  }

  // Word / other: browsers can't render .docx inline, so show the extracted
  // letter text as a readable preview when we have it, with a download fallback.
  if (hasText) return textFallback('Text preview (Word letter)');

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-card text-sm p-4 ${className}`}
      style={{
        height,
        color: 'var(--muted)',
        border: '1px dashed var(--border)',
        background: 'var(--surface-2)',
      }}
    >
      <p className="font-mono text-xs">{file instanceof File ? file.name : 'Attachment'}</p>
      <p>Preview not available for this file type.</p>
      <a className="underline" href={url} download={downloadName}>
        Download attachment
      </a>
    </div>
  );
}
