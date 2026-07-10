import { useEffect, useMemo, useState } from 'react';
import { sniffFileKind, withExtensionForKind, type SniffedFileKind } from '../lib/fileSniff';

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
  const url = useMemo(() => {
    if (!file) return null;
    return URL.createObjectURL(file);
  }, [file]);

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

  const mime = file ? file.type || 'application/pdf' : '';
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

  const isPdf = mimeIsPdf || nameHasPdfExt || sniffedKind === 'pdf';
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
