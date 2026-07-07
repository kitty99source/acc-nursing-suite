import { loadAuditLog, saveAuditLog } from './idb';

export interface AuditEntry {
  ts: number;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  user?: string;
}

const MAX_ENTRIES = 10_000;

export async function appendAudit(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  const existing = await loadAuditLog();
  const row: AuditEntry = { ...entry, ts: Date.now() };
  const next = [...existing, row];
  const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  await saveAuditLog(trimmed);
}

export async function readRecentAudit(limit = 50): Promise<AuditEntry[]> {
  const entries = await loadAuditLog();
  return entries.slice(-limit).reverse();
}

export async function clearAuditLog(): Promise<void> {
  await saveAuditLog([]);
}
