// ============================================================================
// Tiny IndexedDB key-value store. Holds:
//   - the in-progress working copy of the data (so nothing is lost pre-save)
//   - the File System Access handle (so we can re-open the same file later)
// ============================================================================

import type { AuditEntry } from './auditLog';

const DB_NAME = 'acc-nursing-suite';
const STORE = 'kv';
// Dedicated store for document file bytes (Blobs), one entry per document.
// Keeping bytes out of the `kv` working-copy blob is what lets the app scale to
// large numbers of attachments without slowing every autosave.
const DOC_STORE = 'documents';
const DB_VERSION = 2;

const WORKING_COPY_KEY = 'workingCopy';
const FILE_HANDLE_KEY = 'fileHandle';
const AUDIT_LOG_KEY = 'audit.jsonl';
const IMPORT_HISTORY_KEY = 'importHistory';
const COMPLIANCE_SNAPSHOT_KEY = 'complianceSnapshot';
const STAGING_QUEUE_KEY = 'stagingQueue';
const RECOVERY_RESOLVED_KEY = 'recoveryResolved';
const BACKUP_SNOOZE_KEY = 'backupReminderSnoozedUntil';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadWorkingCopy(): Promise<string | undefined> {
  return idbGet<string>(WORKING_COPY_KEY);
}

export async function saveWorkingCopy(serialized: string): Promise<void> {
  return idbSet(WORKING_COPY_KEY, serialized);
}

export async function clearWorkingCopy(): Promise<void> {
  return idbDelete(WORKING_COPY_KEY);
}

// FileSystemFileHandle is structured-clonable and can be stored in IndexedDB.
export async function saveFileHandle(handle: FileSystemFileHandle): Promise<void> {
  return idbSet(FILE_HANDLE_KEY, handle);
}

export async function loadFileHandle(): Promise<FileSystemFileHandle | undefined> {
  return idbGet<FileSystemFileHandle>(FILE_HANDLE_KEY);
}

export async function clearFileHandle(): Promise<void> {
  return idbDelete(FILE_HANDLE_KEY);
}

// ----------------------------------------------------------------------------
// Document blobs. Each attached file is stored as its own Blob keyed by its
// document id, so adding/removing a file is a single fast write and never
// touches the (potentially large) rest of the dataset.
// ----------------------------------------------------------------------------

export async function saveDocumentBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadDocumentBlob(id: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readonly');
    const req = tx.objectStore(DOC_STORE).get(id);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDocumentBlob(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readwrite');
    tx.objectStore(DOC_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listDocumentIds(): Promise<string[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOC_STORE, 'readonly');
    const req = tx.objectStore(DOC_STORE).getAllKeys();
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((k) => String(k)));
    req.onerror = () => reject(req.error);
  });
}

export async function loadAuditLog(): Promise<AuditEntry[]> {
  const raw = await idbGet<AuditEntry[]>(AUDIT_LOG_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveAuditLog(entries: AuditEntry[]): Promise<void> {
  return idbSet(AUDIT_LOG_KEY, entries);
}

export async function isRecoveryResolved(): Promise<boolean> {
  return (await idbGet<boolean>(RECOVERY_RESOLVED_KEY)) === true;
}

export async function setRecoveryResolved(resolved: boolean): Promise<void> {
  if (resolved) return idbSet(RECOVERY_RESOLVED_KEY, true);
  return idbDelete(RECOVERY_RESOLVED_KEY);
}

export async function loadBackupSnoozeUntil(): Promise<number | undefined> {
  return idbGet<number>(BACKUP_SNOOZE_KEY);
}

export async function saveBackupSnoozeUntil(until: number): Promise<void> {
  return idbSet(BACKUP_SNOOZE_KEY, until);
}

export async function loadImportHistory(): Promise<import('../types').ImportHistoryEntry[] | undefined> {
  const raw = await idbGet<import('../types').ImportHistoryEntry[]>(IMPORT_HISTORY_KEY);
  return Array.isArray(raw) ? raw : undefined;
}

export async function saveImportHistory(entries: import('../types').ImportHistoryEntry[]): Promise<void> {
  return idbSet(IMPORT_HISTORY_KEY, entries);
}

export interface ComplianceSnapshotRecord {
  hash: string;
  findings: import('./compliance').ComplianceFinding[];
  savedAt: number;
}

export async function loadComplianceSnapshot(): Promise<ComplianceSnapshotRecord | undefined> {
  return idbGet<ComplianceSnapshotRecord>(COMPLIANCE_SNAPSHOT_KEY);
}

export async function saveComplianceSnapshot(record: ComplianceSnapshotRecord): Promise<void> {
  return idbSet(COMPLIANCE_SNAPSHOT_KEY, record);
}

export async function loadStagingQueue(): Promise<import('./staging').StagingItem[]> {
  const raw = await idbGet<import('./staging').StagingItem[]>(STAGING_QUEUE_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveStagingQueue(items: import('./staging').StagingItem[]): Promise<void> {
  return idbSet(STAGING_QUEUE_KEY, items);
}
