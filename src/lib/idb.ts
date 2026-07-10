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
// Dedicated store for staged letter bytes (Blobs), keyed by SHA-256 hash. Lets
// the Review Queue show + parse a letter fully offline (no launcher bridge) and
// keeps these potentially large bytes out of the staging-queue array.
const LETTER_BLOB_STORE = 'letterBlobs';
const DB_VERSION = 3;

const WORKING_COPY_KEY = 'workingCopy';
const FILE_HANDLE_KEY = 'fileHandle';
const RECENT_FILES_KEY = 'recentFiles';
const AUDIT_LOG_KEY = 'audit.jsonl';
const IMPORT_HISTORY_KEY = 'importHistory';
const COMPLIANCE_SNAPSHOT_KEY = 'complianceSnapshot';
const STAGING_QUEUE_KEY = 'stagingQueue';
const RECOVERY_RESOLVED_KEY = 'recoveryResolved';
const BACKUP_SNOOZE_KEY = 'backupReminderSnoozedUntil';
const EXCEL_IMPORT_SNAPSHOT_KEY = 'excelImportSnapshot';
const DISMISSED_STAGING_KEY = 'dismissedStaging';

const IDB_MAX_RETRIES = 3;
const IDB_RETRY_BASE_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Transient IDB transaction errors that are safe to retry (P3-007). */
export function isRetryableIdbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as DOMException).name;
  return name === 'AbortError' || name === 'TransactionInactiveError' || name === 'InvalidStateError';
}

export async function withIdbRetry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < IDB_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!isRetryableIdbError(err) || attempt === IDB_MAX_RETRIES - 1) throw err;
      await sleep(IDB_RETRY_BASE_MS * (attempt + 1));
    }
  }
  throw last;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
      if (!db.objectStoreNames.contains(LETTER_BLOB_STORE)) db.createObjectStore(LETTER_BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<T | undefined>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result as T | undefined);
          req.onerror = () => reject(req.error);
        }),
    );
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  });
}

async function idbDelete(key: string): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
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

// Recent .accdata files the user can "Save into" directly. Each record holds a
// structured-clonable FileSystemFileHandle plus lightweight display metadata.
// Stored most-recent-first; capped by the caller (see lib/recentFiles).
export async function loadRecentFiles(): Promise<import('./recentFiles').RecentFileEntry[]> {
  const raw = await idbGet<import('./recentFiles').RecentFileEntry[]>(RECENT_FILES_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveRecentFiles(entries: import('./recentFiles').RecentFileEntry[]): Promise<void> {
  return idbSet(RECENT_FILES_KEY, entries);
}

export async function clearRecentFiles(): Promise<void> {
  return idbDelete(RECENT_FILES_KEY);
}

// ----------------------------------------------------------------------------
// Document blobs. Each attached file is stored as its own Blob keyed by its
// document id, so adding/removing a file is a single fast write and never
// touches the (potentially large) rest of the dataset.
// ----------------------------------------------------------------------------

export async function saveDocumentBlob(id: string, blob: Blob): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DOC_STORE, 'readwrite');
          tx.objectStore(DOC_STORE).put(blob, id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  });
}

export async function loadDocumentBlob(id: string): Promise<Blob | undefined> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<Blob | undefined>((resolve, reject) => {
          const tx = db.transaction(DOC_STORE, 'readonly');
          const req = tx.objectStore(DOC_STORE).get(id);
          req.onsuccess = () => resolve(req.result as Blob | undefined);
          req.onerror = () => reject(req.error);
        }),
    );
  });
}

export async function deleteDocumentBlob(id: string): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(DOC_STORE, 'readwrite');
          tx.objectStore(DOC_STORE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  });
}

export async function listDocumentIds(): Promise<string[]> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<string[]>((resolve, reject) => {
          const tx = db.transaction(DOC_STORE, 'readonly');
          const req = tx.objectStore(DOC_STORE).getAllKeys();
          req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((k) => String(k)));
          req.onerror = () => reject(req.error);
        }),
    );
  });
}

// ----------------------------------------------------------------------------
// Staged letter bytes, keyed by SHA-256 hash. Populated when a letter's bytes
// are first obtained (folder-watch sidecar embed, or a one-off bridge fetch) so
// the Review Queue can render + parse the letter offline forever after.
// ----------------------------------------------------------------------------

export async function saveLetterBlob(hash: string, blob: Blob): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(LETTER_BLOB_STORE, 'readwrite');
          tx.objectStore(LETTER_BLOB_STORE).put(blob, hash);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  });
}

export async function loadLetterBlob(hash: string): Promise<Blob | undefined> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<Blob | undefined>((resolve, reject) => {
          const tx = db.transaction(LETTER_BLOB_STORE, 'readonly');
          const req = tx.objectStore(LETTER_BLOB_STORE).get(hash);
          req.onsuccess = () => resolve(req.result as Blob | undefined);
          req.onerror = () => reject(req.error);
        }),
    );
  });
}

export async function deleteLetterBlob(hash: string): Promise<void> {
  return withIdbRetry(() => {
    return openDB().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(LETTER_BLOB_STORE, 'readwrite');
          tx.objectStore(LETTER_BLOB_STORE).delete(hash);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  });
}

// ----------------------------------------------------------------------------
// Letter parse cache — one entry per letter hash, holding the parsed preview so
// a letter is parsed exactly once and hot-loaded on every subsequent open.
// Stored in the kv store under a namespaced key to avoid a schema bump.
// ----------------------------------------------------------------------------

const LETTER_PARSE_PREFIX = 'letterParse:';

export async function loadLetterParse<T = unknown>(hash: string): Promise<T | undefined> {
  return idbGet<T>(`${LETTER_PARSE_PREFIX}${hash}`);
}

export async function saveLetterParse(hash: string, record: unknown): Promise<void> {
  return idbSet(`${LETTER_PARSE_PREFIX}${hash}`, record);
}

export async function deleteLetterParse(hash: string): Promise<void> {
  return idbDelete(`${LETTER_PARSE_PREFIX}${hash}`);
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

// ----------------------------------------------------------------------------
// Excel import rollback snapshot (P3-005) — one pre-import copy for undo.
// ----------------------------------------------------------------------------

export interface ExcelImportSnapshot {
  savedAt: number;
  dataJson: string;
}

export async function loadExcelImportSnapshot(): Promise<ExcelImportSnapshot | undefined> {
  return idbGet<ExcelImportSnapshot>(EXCEL_IMPORT_SNAPSHOT_KEY);
}

export async function saveExcelImportSnapshot(snapshot: ExcelImportSnapshot): Promise<void> {
  return idbSet(EXCEL_IMPORT_SNAPSHOT_KEY, snapshot);
}

export async function clearExcelImportSnapshot(): Promise<void> {
  return idbDelete(EXCEL_IMPORT_SNAPSHOT_KEY);
}

// ----------------------------------------------------------------------------
// Dismissed-staging tombstones — persistent set of staging ingress keys the
// user has discarded/removed. Import skips these so dismissed letters never
// reappear from their .staging sidecars, and the dismissal survives a restart.
// ----------------------------------------------------------------------------

export async function loadDismissedStaging(): Promise<string[]> {
  const raw = await idbGet<string[]>(DISMISSED_STAGING_KEY);
  return Array.isArray(raw) ? raw : [];
}

export async function saveDismissedStaging(keys: string[]): Promise<void> {
  return idbSet(DISMISSED_STAGING_KEY, keys);
}
