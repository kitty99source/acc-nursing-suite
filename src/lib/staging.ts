// ============================================================================
// Staging / Human Review Queue draft store — automation writes here, never
// directly to live AppData until sign-off (P8-001).
// ============================================================================

import { loadStagingQueue as idbLoadStaging, saveStagingQueue as idbSaveStaging } from './idb';

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

export async function addStagingItem(item: StagingItem): Promise<void> {
  const existing = await idbLoadStaging();
  if (item.sourceHash && existing.some((e) => e.sourceHash === item.sourceHash && e.status === 'pending')) {
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
    const dup = sc.item.sourceHash && before.some((e) => e.sourceHash === sc.item.sourceHash);
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

/** Staging items must never call store.mutate() — this guard is for tests and future HRQ sign-off. */
export function assertStagingIsolation(liveMutated: boolean, fromStaging: boolean): void {
  if (fromStaging && liveMutated) {
    throw new Error('Staging ingress must not mutate live AppData without HRQ sign-off');
  }
}
