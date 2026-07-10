import { useEffect, useMemo, useState } from 'react';

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

  const mime = file.type || 'application/pdf';
  const isPdf = mime.includes('pdf') || (file instanceof File && /\.pdf$/i.test(file.name));
  const isImage = mime.startsWith('image/');
  const downloadName = file instanceof File ? file.name : title || 'letter';
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
