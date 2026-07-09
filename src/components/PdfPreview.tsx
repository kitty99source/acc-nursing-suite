import { useEffect, useMemo, useState } from 'react';

/**
 * Offline-friendly PDF (or image) preview via object URL.
 * Caller owns the File; this component only creates/revokes the blob URL.
 */
export function PdfPreview({
  file,
  title,
  className = '',
  height = 480,
}: {
  file: File | Blob | null | undefined;
  title?: string;
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

  if (failed) {
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
        <a className="underline" href={url} download={file instanceof File ? file.name : title || 'letter'}>
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
      <a className="underline" href={url} download={file instanceof File ? file.name : title || 'letter'}>
        Download attachment
      </a>
    </div>
  );
}
