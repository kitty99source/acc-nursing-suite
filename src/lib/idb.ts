// ============================================================================
// Tiny IndexedDB key-value store. Holds:
//   - the in-progress working copy of the data (so nothing is lost pre-save)
//   - the File System Access handle (so we can re-open the same file later)
// ============================================================================

const DB_NAME = 'acc-nursing-suite';
const STORE = 'kv';
const DB_VERSION = 1;

const WORKING_COPY_KEY = 'workingCopy';
const FILE_HANDLE_KEY = 'fileHandle';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
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
