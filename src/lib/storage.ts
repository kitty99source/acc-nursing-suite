import type { AppData } from '../types';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../types';
import { DEFAULT_RATES } from './serviceCodes';
import { encryptString, decryptString, type EncryptedPayload } from './crypto';
import { assertNotDowngrade, migrateAppData, LATEST_FILE_VERSION } from './migrations';

// ============================================================================
// File persistence: file-format envelope, File System Access API helpers, and
// download/upload fallbacks. Everything is local; no network is ever touched.
// ============================================================================

export const FILE_FORMAT = 'accdata';
export const FILE_VERSION = LATEST_FILE_VERSION;
export const FILE_EXTENSION = '.accdata';

interface PlainEnvelope {
  format: typeof FILE_FORMAT;
  version: number;
  encrypted: false;
  data: AppData;
}

interface EncryptedEnvelope {
  format: typeof FILE_FORMAT;
  version: number;
  encrypted: true;
  payload: EncryptedPayload;
}

type Envelope = PlainEnvelope | EncryptedEnvelope;

export class PassphraseRequiredError extends Error {
  constructor() {
    super('This file is encrypted. A passphrase is required to open it.');
    this.name = 'PassphraseRequiredError';
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('Incorrect passphrase, or the file is corrupted.');
    this.name = 'WrongPassphraseError';
  }
}

/** Serialize app data to file text. When a passphrase is given, contents are encrypted. */
export async function serialize(data: AppData, passphrase?: string): Promise<string> {
  if (passphrase) {
    const payload = await encryptString(JSON.stringify(data), passphrase);
    const env: EncryptedEnvelope = {
      format: FILE_FORMAT,
      version: FILE_VERSION,
      encrypted: true,
      payload,
    };
    return JSON.stringify(env, null, 2);
  }
  const env: PlainEnvelope = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    encrypted: false,
    data,
  };
  return JSON.stringify(env, null, 2);
}

export function isEncryptedFile(text: string): boolean {
  try {
    const env = JSON.parse(text) as Partial<Envelope>;
    return env?.format === FILE_FORMAT && env?.encrypted === true;
  } catch {
    return false;
  }
}

/**
 * Backfill any settings fields missing from an older file so newly-added
 * options (enabled service codes, editable rates) never arrive as `undefined`.
 * Safe to run on every load; existing values are preserved.
 */
export function normalizeData(data: AppData): AppData {
  const settings = { ...DEFAULT_SETTINGS, ...data.settings };
  // Merge per-code so codes added in later versions always have a rate.
  settings.serviceRates = { ...DEFAULT_RATES, ...(data.settings?.serviceRates ?? {}) };
  const enabled = data.settings?.enabledServiceCodes;
  settings.enabledServiceCodes =
    Array.isArray(enabled) && enabled.length > 0 ? enabled : [...DEFAULT_SETTINGS.enabledServiceCodes];
  // Older files predate document attachments — ensure the array always exists.
  const documents = Array.isArray(data.documents) ? data.documents : [];
  const approvals = (data.approvals ?? []).map((a) => ({
    ...a,
    recordStatus: a.recordStatus ?? 'current',
  }));
  const schemaVersion = data.schemaVersion ?? SCHEMA_VERSION;
  return { ...data, schemaVersion, settings, documents, approvals };
}

function applyFileMigrations(data: AppData, fileVersion: number): AppData {
  const migrated =
    fileVersion < FILE_VERSION ? migrateAppData(data, fileVersion, FILE_VERSION) : normalizeData(data);
  return normalizeData({ ...migrated, schemaVersion: SCHEMA_VERSION });
}

export { validateReferentialIntegrity } from './integrity';

/** Parse file text into AppData. Throws PassphraseRequiredError / WrongPassphraseError. */
export async function deserialize(text: string, passphrase?: string): Promise<AppData> {
  let env: Envelope;
  try {
    env = JSON.parse(text) as Envelope;
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (env.format !== FILE_FORMAT) {
    // Be lenient: allow a bare AppData JSON (e.g. older manual export).
    const maybe = JSON.parse(text) as AppData;
    if (maybe && Array.isArray(maybe.patients)) return applyFileMigrations(maybe, 1);
    throw new Error('Unrecognised file format.');
  }
  const fileVersion = typeof env.version === 'number' ? env.version : 1;
  assertNotDowngrade(fileVersion, FILE_VERSION);
  if (env.encrypted) {
    if (!passphrase) throw new PassphraseRequiredError();
    try {
      const json = await decryptString(env.payload, passphrase);
      return applyFileMigrations(JSON.parse(json) as AppData, fileVersion);
    } catch {
      throw new WrongPassphraseError();
    }
  }
  return applyFileMigrations(env.data, fileVersion);
}

// ---------------------------------------------------------------------------
// File System Access API
// ---------------------------------------------------------------------------

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
}

const PICKER_TYPES = [
  {
    description: 'ACC Nursing data file',
    accept: { 'application/json': [FILE_EXTENSION as `.${string}`] },
  },
];

export async function pickSaveFile(): Promise<FileSystemFileHandle> {
  const handle = await window.showSaveFilePicker({
    suggestedName: `acc-nursing-data${FILE_EXTENSION}`,
    types: PICKER_TYPES,
  });
  return handle;
}

export async function pickOpenFile(): Promise<FileSystemFileHandle> {
  const [handle] = await window.showOpenFilePicker({
    types: PICKER_TYPES,
    multiple: false,
  });
  return handle;
}

export async function verifyPermission(
  handle: FileSystemFileHandle,
  readWrite: boolean,
): Promise<boolean> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: readWrite ? 'readwrite' : 'read' };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if ((await handle.requestPermission(opts)) === 'granted') return true;
  return false;
}

export async function readFromHandle(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function writeToHandle(handle: FileSystemFileHandle, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

// ---------------------------------------------------------------------------
// Download / upload fallbacks (no File System Access API)
// ---------------------------------------------------------------------------

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
