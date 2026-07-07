// ============================================================================
// User-facing messages for browser storage / IndexedDB failures (P3-009).
// ============================================================================

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as DOMException & { code?: number };
  return e.name === 'QuotaExceededError' || e.code === 22;
}

/** Turn IDB / quota errors into actionable copy for banners and modals. */
export function formatStorageError(err: unknown): string {
  if (isQuotaExceededError(err)) {
    return (
      'Browser storage is full. Export a .accdata or full ZIP backup, remove unused document ' +
      'attachments, or clear site data for this app in your browser settings — then retry.'
    );
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Short guidance shown in Settings (P3-009). */
export const STORAGE_QUOTA_GUIDANCE =
  'This app stores your working copy and attached files in browser storage (IndexedDB). ' +
  'If autosave fails with a quota error, export your data and delete old attachments — ' +
  'storage limits vary by browser (often hundreds of MB to a few GB per site).';
