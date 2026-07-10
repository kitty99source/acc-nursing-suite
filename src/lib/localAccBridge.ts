// ============================================================================
// Loopback bridge to launch.ps1 /_acc/* endpoints (ACC-Inbox staging + letter bytes).
// No File System Access API — works in any browser when the suite is served locally.
// ============================================================================

import { parseStagingSidecar, type StagingSidecar } from './staging';

const STAGING_URL = '/_acc/staging';
const INBOX_FILE_URL = '/_acc/inbox-file';
const EMAIL_META_URL = '/_acc/email-meta';

/** Result of probing launch.ps1 `/_acc/staging` (folder-watch sidecar list). */
export type StagingBridgeStatus = 'ok' | 'empty' | 'unavailable';

export interface StagingBridgeProbe {
  status: StagingBridgeStatus;
  sidecars: StagingSidecar[];
}

/**
 * Probe the local launcher staging endpoint.
 * - `ok` / `empty`: launch.ps1 answered with a JSON array (possibly empty).
 * - `unavailable`: 404, network error, or non-array body — typical when the app
 *   was opened via `npm run dev`, file://, or a static host without `/_acc/*`.
 */
export async function probeLocalStagingBridge(): Promise<StagingBridgeProbe> {
  try {
    const res = await fetch(STAGING_URL, { cache: 'no-store' });
    if (!res.ok) return { status: 'unavailable', sidecars: [] };
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return { status: 'unavailable', sidecars: [] };
    const sidecars: StagingSidecar[] = [];
    for (const row of raw) {
      const parsed = parseStagingSidecar(row);
      if (parsed) sidecars.push(parsed);
    }
    return { status: sidecars.length ? 'ok' : 'empty', sidecars };
  } catch {
    return { status: 'unavailable', sidecars: [] };
  }
}

/** Fetch folder-watch sidecars from the local launcher. Returns [] if unavailable. */
export async function fetchLocalStagingSidecars(): Promise<StagingSidecar[]> {
  const probe = await probeLocalStagingBridge();
  return probe.sidecars;
}

/** Resolve letter file bytes by SHA-256 via launch.ps1 (hash-index only). */
export async function fetchInboxFileByHash(hash: string): Promise<File | undefined> {
  const h = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) return undefined;
  try {
    const res = await fetch(`${INBOX_FILE_URL}?hash=${encodeURIComponent(h)}`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.size) return undefined;
    const ctype = res.headers.get('content-type') ?? blob.type ?? 'application/octet-stream';
    let name = 'letter.bin';
    if (ctype.includes('pdf')) name = 'letter.pdf';
    else if (ctype.includes('word') || ctype.includes('officedocument') || ctype.includes('msword')) {
      name = 'letter.docx';
    }
    // Prefer filename from Content-Disposition if present (launch.ps1 does not set it today).
    return new File([blob], name, { type: ctype });
  } catch {
    return undefined;
  }
}

export interface EmailMetaResult {
  emailDate: string;
  emailDateApprox: boolean;
}

/**
 * Look up the email received date for a letter by content hash, straight from
 * `.email-sync/{hash}.meta.json` via launch.ps1. Used to backfill emailDate onto
 * staging items that were already imported before this field existed (re-importing
 * the sidecar would be a no-op since the ingress key already exists in the queue).
 */
export async function fetchEmailMetaForHash(hash: string): Promise<EmailMetaResult | undefined> {
  const h = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(h)) return undefined;
  try {
    const res = await fetch(`${EMAIL_META_URL}?hash=${encodeURIComponent(h)}`, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const raw = (await res.json()) as unknown;
    if (!raw || typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.emailDate !== 'string' || !obj.emailDate.trim()) return undefined;
    return { emailDate: obj.emailDate, emailDateApprox: obj.emailDateApprox === true };
  } catch {
    return undefined;
  }
}

/** Build a File with the preferred display name when we know it from the sidecar. */
export async function fetchInboxFileForStaging(opts: {
  sourceHash?: string;
  sourceFileName?: string;
  expectedFileName?: string;
}): Promise<File | undefined> {
  if (!opts.sourceHash) return undefined;
  const file = await fetchInboxFileByHash(opts.sourceHash);
  if (!file) return undefined;
  const preferred = (opts.expectedFileName || opts.sourceFileName || file.name).trim();
  if (!preferred || preferred === file.name) return file;
  return new File([file], preferred, { type: file.type });
}
