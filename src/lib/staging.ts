// ============================================================================
// Staging / Human Review Queue draft store — automation writes here, never
// directly to live AppData until sign-off (P8-001).
// ============================================================================

import { loadStagingQueue as idbLoadStaging, saveStagingQueue as idbSaveStaging } from './idb';
import { hrqSlaLevel } from './hrqSla';
import { hashBlob } from './letterImport';

export type StagingItemType =
  | 'letter-import-pending'
  | 'letter-import-low-confidence'
  | 'letter-duplicate-suspect'
  | 'portal-fetch-complete'
  | 'automation-failure';

export type StagingItemStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

export type StagingSource = 'folder' | 'email' | 'portal' | 'manual';

export interface StagingItem {
  id: string;
  type: StagingItemType;
  status: StagingItemStatus;
  source: StagingSource;
  createdAt: number;
  severity: 'danger' | 'warn' | 'info';
  title: string;
  summary: string;
  sourceFileName?: string;
  /** Patient display name parsed from the ACC email subject (Review Queue hint). */
  patientName?: string;
  /** ACC claim number parsed from the subject (e.g. "P2222756868"). */
  claimNumber?: string;
  /** ACC vendor/ACCID token parsed from the subject (e.g. "VEND-K96655"). */
  accId?: string;
  /** Descriptive on-disk filename outlook-sync saves the attachment as — the name to look for at Review & import. */
  expectedFileName?: string;
  /** Original ACC email subject (from .email-sync meta / folder-watch enrichment). */
  emailSubject?: string;
  /** SHA-256 hex of source PDF bytes — dedup key for folder/email ingress. */
  sourceHash?: string;
  /** Absolute path on work PC (folder watch only; not synced to IDB on other machines). */
  sourcePath?: string;
  parsedPreview?: Record<string, unknown>;
  runId?: string;
}

/** JSON sidecar written by folder-watch.mjs — imported into IDB staging on app open. */
export interface StagingSidecar {
  version: 1;
  item: StagingItem;
}

export function createStagingItem(
  partial: Omit<StagingItem, 'id' | 'createdAt' | 'status'> & { id?: string; status?: StagingItemStatus },
): StagingItem {
  return {
    id: partial.id ?? crypto.randomUUID(),
    status: partial.status ?? 'pending',
    createdAt: Date.now(),
    ...partial,
  };
}

export function parseStagingSidecar(raw: unknown): StagingSidecar | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  const item = obj.item;
  if (!item || typeof item !== 'object') return null;
  const row = item as StagingItem;
  if (!row.id || !row.type || !row.title) return null;
  return { version: 1, item: row };
}

export async function loadStagingItems(): Promise<StagingItem[]> {
  const items = await idbLoadStaging();
  return items.filter((i) => i.status === 'pending');
}

export async function loadAllStagingItems(): Promise<StagingItem[]> {
  return idbLoadStaging();
}

export async function saveStagingItems(items: StagingItem[]): Promise<void> {
  await idbSaveStaging(items);
}

/** Ingress dedup key: same bytes saved under different names are distinct queue entries. */
export function stagingIngressDedupKey(
  item: Pick<StagingItem, 'sourceHash' | 'sourceFileName'>,
): string | null {
  if (!item.sourceHash) return null;
  return `${item.sourceHash}::${item.sourceFileName ?? ''}`;
}

export function isStagingIngressDuplicate(
  existing: StagingItem,
  incoming: Pick<StagingItem, 'sourceHash' | 'sourceFileName'>,
): boolean {
  const key = stagingIngressDedupKey(incoming);
  if (!key || existing.status !== 'pending') return false;
  return stagingIngressDedupKey(existing) === key;
}

export async function addStagingItem(item: StagingItem): Promise<void> {
  const existing = await idbLoadStaging();
  if (existing.some((e) => isStagingIngressDuplicate(e, item))) {
    return;
  }
  await idbSaveStaging([...existing, item]);
}

export async function updateStagingItem(id: string, patch: Partial<StagingItem>): Promise<void> {
  const existing = await idbLoadStaging();
  const next = existing.map((i) => (i.id === id ? { ...i, ...patch } : i));
  await idbSaveStaging(next);
}

export async function removeStagingItem(id: string): Promise<void> {
  const existing = await idbLoadStaging();
  await idbSaveStaging(existing.filter((i) => i.id !== id));
}

/** Import one or more folder-watch JSON sidecars into IDB staging (never live data). */
export async function importStagingSidecars(sidecars: StagingSidecar[]): Promise<number> {
  let added = 0;
  for (const sc of sidecars) {
    const before = await idbLoadStaging();
    const dup = before.some((e) => isStagingIngressDuplicate(e, sc.item));
    if (dup) continue;
    await addStagingItem({ ...sc.item, status: 'pending' });
    added++;
  }
  return added;
}

export async function importStagingJsonText(text: string): Promise<number> {
  const parsed = parseStagingSidecar(JSON.parse(text) as unknown);
  if (!parsed) throw new Error('Invalid staging sidecar JSON');
  return importStagingSidecars([parsed]);
}

/** Hours before an HRQ item breaches SLA and escalates to danger (P8-013). */
export const HRQ_SLA_WARN_HOURS = 18;

export type StagingSlaLevel = 'ok' | 'warn' | 'danger';

/**
 * Escalation level for a staging item. Thin wrapper over the canonical pure
 * compute in hrqSla.ts (P8-013) so the queue and the util can't drift apart.
 */
export function stagingSlaLevel(createdAt: number, now = Date.now()): StagingSlaLevel {
  return hrqSlaLevel(createdAt, now, {
    dangerHours: HRQ_SLA_WARN_HOURS,
    warnHours: HRQ_SLA_WARN_HOURS * 0.5,
  });
}

export function stagingAgeLabel(createdAt: number, now = Date.now()): string {
  const hours = Math.floor((now - createdAt) / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function assertStagingIsolation(liveMutated: boolean, fromStaging: boolean): void {
  if (fromStaging && liveMutated) {
    throw new Error('Staging ingress must not mutate live AppData without HRQ sign-off');
  }
}

// ============================================================================
// P8-014 — attachment-hash idempotency.
//
// `ingestAttachment` (blob re-drop): dedupes on content hash alone — same bytes
// ingested twice yield one queue item.
//
// Folder-watch / sidecar ingress: dedupes on hash + sourceFileName so ACC emails
// that save the same generic filename with different uniquified names (vendor.docx,
// vendor-1.docx) or byte-identical templates for different patients each get a row.
// ============================================================================

/** Existing staging item already holding this attachment hash (pending by default). */
export function findStagingByHash(
  items: StagingItem[],
  sourceHash: string,
  opts?: { includeResolved?: boolean },
): StagingItem | undefined {
  if (!sourceHash) return undefined;
  return items.find(
    (i) => i.sourceHash === sourceHash && (opts?.includeResolved || i.status === 'pending'),
  );
}

/** Collapse duplicate-hash items, keeping the earliest-created one of each hash. */
export function dedupeStagingByHash(items: StagingItem[]): StagingItem[] {
  const seen = new Map<string, true>();
  const out: StagingItem[] = [];
  for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    if (item.sourceHash) {
      if (seen.has(item.sourceHash)) continue;
      seen.set(item.sourceHash, true);
    }
    out.push(item);
  }
  return out;
}

export type StagingIngestOutcome = 'added' | 'duplicate';

export interface StagingIngestResult {
  outcome: StagingIngestOutcome;
  /** The item now in the queue — the freshly-added one, or the pre-existing duplicate. */
  item: StagingItem;
  /** Set when outcome === 'duplicate': the id of the item this attachment already occupies. */
  duplicateOfId?: string;
}

export type AttachmentHasher = (blob: Blob) => Promise<string>;

/**
 * Idempotently ingest an attachment into the staging queue (P8-014). Hashes the
 * bytes, and if a pending item already carries that hash returns `duplicate`
 * WITHOUT adding a second item. Otherwise appends a new item stamped with the
 * hash so future re-ingests dedupe against it.
 *
 * `hash` is injectable for tests / non-crypto environments; defaults to the
 * shared SHA-256 `hashBlob` used by letter-import duplicate detection.
 */
export async function ingestAttachment(
  blob: Blob,
  meta: Omit<StagingItem, 'id' | 'createdAt' | 'status' | 'sourceHash'> & {
    id?: string;
    status?: StagingItemStatus;
  },
  deps: { hash?: AttachmentHasher } = {},
): Promise<StagingIngestResult> {
  const hash = await (deps.hash ?? hashBlob)(blob);
  const existing = await idbLoadStaging();
  const dup = findStagingByHash(existing, hash);
  if (dup) {
    return { outcome: 'duplicate', item: dup, duplicateOfId: dup.id };
  }
  const item = createStagingItem({ ...meta, sourceHash: hash });
  await idbSaveStaging([...existing, item]);
  return { outcome: 'added', item };
}
