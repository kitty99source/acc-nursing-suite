// ============================================================================
// Loopback bridge to launch.ps1 /_acc/* endpoints (ACC-Inbox staging + letter bytes).
// No File System Access API — works in any browser when the suite is served locally.
// ============================================================================

import { parseStagingSidecar, type StagingSidecar } from './staging';
import { mimeFromName } from './letterCache';
import { hasFileExtension, sniffFileKind, withExtensionForKind } from './fileSniff';

const STAGING_URL = '/_acc/staging';
const INBOX_FILE_URL = '/_acc/inbox-file';
const EMAIL_META_URL = '/_acc/email-meta';

/** Cap hung `/_acc/staging` probes so UI can flip Connecting → Reconnecting quickly. */
export const BRIDGE_PROBE_TIMEOUT_MS = 2500;

/** Result of probing launch.ps1 `/_acc/staging` (folder-watch sidecar list). */
export type StagingBridgeStatus = 'ok' | 'empty' | 'unavailable';

export interface StagingBridgeProbe {
  status: StagingBridgeStatus;
  sidecars: StagingSidecar[];
}

/**
 * Probe the local launcher staging endpoint.
 * - `ok` / `empty`: launch.ps1 answered with a JSON array (possibly empty).
 * - `unavailable`: 404, network error, abort/timeout, or non-array body — typical when
 *   the app was opened via `npm run dev`, file://, or a static host without `/_acc/*`.
 */
export async function probeLocalStagingBridge(
  timeoutMs = BRIDGE_PROBE_TIMEOUT_MS,
): Promise<StagingBridgeProbe> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(STAGING_URL, { cache: 'no-store', signal: ctrl.signal });
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
  } finally {
    window.clearTimeout(timer);
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
    let type = ctype;
    if (ctype.includes('pdf')) name = 'letter.pdf';
    else if (ctype.includes('word') || ctype.includes('officedocument') || ctype.includes('msword')) {
      name = 'letter.docx';
    } else {
      // Content-type header gave no hint (e.g. launch.ps1 answering with a
      // generic application/octet-stream) — sniff the actual bytes so a real
      // PDF/DOCX is still assigned the right name/type here at the source,
      // rather than leaving it ambiguous for every downstream consumer.
      const sniffed = await sniffFileKind(blob);
      if (sniffed === 'pdf') {
        name = 'letter.pdf';
        type = 'application/pdf';
      } else if (sniffed === 'docx') {
        name = 'letter.docx';
        type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }
    }
    // Prefer filename from Content-Disposition if present (launch.ps1 does not set it today).
    return new File([blob], name, { type });
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
  let preferred = (opts.expectedFileName || opts.sourceFileName || file.name).trim();
  // Bridge often returns application/octet-stream; recover the real type from the
  // attachment name so the preview and parser pick the right handler (pdf vs .docx).
  const generic =
    !file.type || file.type === 'application/octet-stream' || file.type === 'application/binary';
  let type = (generic ? mimeFromName(preferred) : undefined) ?? file.type;
  // The sidecar's expectedFileName/sourceFileName can itself be extensionless
  // (e.g. a GUID), which would otherwise silently drop the correct extension
  // fetchInboxFileByHash already worked out from a byte-sniff above. Content
  // sniffing is the authoritative fallback here too, so the resolved file
  // always carries a usable extension when the bytes are recognizable.
  if (!hasFileExtension(preferred)) {
    const generic2 = !type || type === 'application/octet-stream' || type === 'application/binary';
    const kind = generic2 ? await sniffFileKind(file) : type.includes('pdf') ? 'pdf' : 'unknown';
    preferred = withExtensionForKind(preferred, kind);
    if (kind === 'pdf') type = 'application/pdf';
    else if (kind === 'docx') {
      type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
  }
  if ((!preferred || preferred === file.name) && type === file.type) return file;
  return new File([file], preferred || file.name, { type });
}

const FILE_TO_IDRIVE_URL = '/_acc/file-to-idrive';

export interface FileToIDriveResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Opt-in writeback: POST an accepted attachment to I-drive via launch.ps1.
 * Body: `{ relativePath, fileBase64, rootPath? }`.
 */
export async function postFileToIDrive(input: {
  relativePath: string;
  fileBase64: string;
  rootPath?: string;
}): Promise<FileToIDriveResult> {
  try {
    const res = await fetch(FILE_TO_IDRIVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        relativePath: input.relativePath,
        fileBase64: input.fileBase64,
        rootPath: input.rootPath,
      }),
    });
    if (!res.ok) {
      let error = `HTTP ${res.status}`;
      try {
        const raw = (await res.json()) as { error?: string };
        if (raw?.error) error = raw.error;
      } catch {
        /* ignore */
      }
      return { ok: false, error };
    }
    const raw = (await res.json()) as { path?: string };
    return { ok: true, path: raw.path };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

