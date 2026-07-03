import { create } from 'zustand';
import type {
  AppData,
  Approval,
  Claim,
  ComplexCase,
  Decline,
  InvoiceLine,
  Patient,
  ServiceLine,
  Settings,
} from '../types';
import { emptyData, sampleData, isSampleData } from '../lib/sampleData';
import {
  serialize,
  deserialize,
  isEncryptedFile,
  isFileSystemAccessSupported,
  pickSaveFile,
  pickOpenFile,
  verifyPermission,
  writeToHandle,
  readFromHandle,
  downloadText,
  PassphraseRequiredError,
  WrongPassphraseError,
} from '../lib/storage';
import {
  loadWorkingCopy,
  saveWorkingCopy,
  clearWorkingCopy,
  saveFileHandle,
  loadFileHandle,
  clearFileHandle,
} from '../lib/idb';
import { uid } from '../lib/format';
import { mergeImportIntoData, type ImportMode, type ImportResult } from '../lib/excelImport';

// In-memory only. Never persisted, never logged, cleared on lock.
let sessionPassphrase: string | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const AUTOSAVE_DEBOUNCE_MS = 1000;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface AppStatus {
  fileName?: string;
  fsaSupported: boolean;
  hasFileHandle: boolean;
  saveState: SaveState;
  lastSavedAt?: number;
  saveError?: string;
  // Manual-persistence model: true whenever in-app data has changed since the
  // last "Save my data" download or "Load my data". Drives the TopBar warning
  // and the beforeunload guard.
  dirty: boolean;
  // Timestamp of the last successful manual Save/Load my data (or file save).
  lastExportAt?: number;
}

interface StoreState {
  ready: boolean;
  data: AppData;
  status: AppStatus;
  locked: boolean;
  needsPassphrase: boolean; // encrypted working copy present, awaiting unlock
  lastActivityAt: number;
  fileHandle: FileSystemFileHandle | null;
  pendingEncryptedText?: string; // encrypted working copy awaiting passphrase

  // lifecycle
  init: () => Promise<void>;
  recordActivity: () => void;
  lock: () => void;
  unlock: (passphrase?: string) => Promise<boolean>;

  // manual persistence (primary; works on file://)
  saveMyData: (filename?: string) => Promise<void>;
  loadMyData: (text: string, passphrase?: string) => Promise<void>;

  // file ops (File System Access API — optional/advanced)
  connectNewFile: () => Promise<void>;
  openExistingFile: () => Promise<void>;
  exportJsonDownload: () => void;
  importJsonText: (text: string) => Promise<boolean>;
  saveNow: () => Promise<void>;
  disconnectFile: () => Promise<void>;

  // data management
  loadSample: () => void;
  clearSampleData: () => void;
  resetToEmpty: () => void;
  replaceData: (data: AppData) => void;
  importFromExcel: (result: ImportResult, mode?: ImportMode) => void;

  // settings
  updateSettings: (patch: Partial<Settings>) => void;
  setPassphrase: (passphrase: string) => void;

  // patient CRUD
  addPatient: (p: Omit<Patient, 'id'>) => string;
  updatePatient: (id: string, patch: Partial<Patient>) => void;
  removePatient: (id: string) => void;

  // claim CRUD
  addClaim: (c: Omit<Claim, 'id'>) => string;
  updateClaim: (id: string, patch: Partial<Claim>) => void;
  removeClaim: (id: string) => void;

  // service line CRUD
  addServiceLine: (s: Omit<ServiceLine, 'id'>) => string;
  updateServiceLine: (id: string, patch: Partial<ServiceLine>) => void;
  removeServiceLine: (id: string) => void;

  // approval CRUD
  addApproval: (a: Omit<Approval, 'id'>) => string;
  updateApproval: (id: string, patch: Partial<Approval>) => void;
  removeApproval: (id: string) => void;

  // invoice CRUD
  addInvoiceLine: (i: Omit<InvoiceLine, 'id'>) => string;
  addInvoiceLines: (rows: Omit<InvoiceLine, 'id'>[]) => void;
  updateInvoiceLine: (id: string, patch: Partial<InvoiceLine>) => void;
  removeInvoiceLine: (id: string) => void;

  // complex case CRUD
  addComplexCase: (c: Omit<ComplexCase, 'id'>) => string;
  updateComplexCase: (id: string, patch: Partial<ComplexCase>) => void;
  removeComplexCase: (id: string) => void;

  // decline CRUD
  addDecline: (d: Omit<Decline, 'id'>) => string;
  updateDecline: (id: string, patch: Partial<Decline>) => void;
  removeDecline: (id: string) => void;
}

function scheduleSave(get: () => StoreState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistAll(get);
  }, AUTOSAVE_DEBOUNCE_MS);
}

async function persistAll(get: () => StoreState) {
  const state = get();
  if (state.locked) return;
  const { data } = state;
  const usePass = data.settings.encryptionEnabled ? sessionPassphrase : undefined;
  // If encryption is enabled but we don't have a passphrase, do not write
  // a plaintext working copy. Wait until a passphrase is set.
  if (data.settings.encryptionEnabled && !usePass) return;

  useStore.setState((s) => ({ status: { ...s.status, saveState: 'saving' } }));
  try {
    const text = await serialize(data, usePass);
    await saveWorkingCopy(text);
    const handle = get().fileHandle;
    let wroteToFile = false;
    if (handle) {
      const ok = await verifyPermission(handle, true);
      if (ok) {
        await writeToHandle(handle, text);
        wroteToFile = true;
      }
    }
    useStore.setState((s) => ({
      status: {
        ...s.status,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        saveError: undefined,
        // Writing to a real file the user controls counts as a save: clear
        // dirty. The silent IndexedDB working copy alone does NOT clear it.
        ...(wroteToFile ? { dirty: false, lastExportAt: Date.now() } : {}),
      },
    }));
  } catch (err) {
    useStore.setState((s) => ({
      status: { ...s.status, saveState: 'error', saveError: (err as Error).message },
    }));
  }
}

function mutate(get: () => StoreState, updater: (data: AppData) => AppData) {
  useStore.setState((s) => ({
    data: updater(s.data),
    status: s.status.dirty ? s.status : { ...s.status, dirty: true },
  }));
  scheduleSave(get);
}

export const useStore = create<StoreState>((set, get) => ({
  ready: false,
  data: emptyData(),
  status: {
    fsaSupported: isFileSystemAccessSupported(),
    hasFileHandle: false,
    saveState: 'idle',
    dirty: false,
  },
  locked: false,
  needsPassphrase: false,
  lastActivityAt: Date.now(),
  fileHandle: null,

  init: async () => {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = (await loadFileHandle()) ?? null;
    } catch {
      handle = null;
    }
    let workingText: string | undefined;
    try {
      workingText = await loadWorkingCopy();
    } catch {
      workingText = undefined;
    }

    if (!workingText) {
      // First run: seed sample data.
      set({
        ready: true,
        data: sampleData(),
        locked: false,
        needsPassphrase: false,
        fileHandle: handle,
        status: {
          ...get().status,
          hasFileHandle: !!handle,
          fileName: handle?.name,
        },
      });
      // Persist the seeded sample so the working copy exists.
      scheduleSave(get);
      return;
    }

    if (isEncryptedFile(workingText)) {
      set({
        ready: true,
        locked: true,
        needsPassphrase: true,
        pendingEncryptedText: workingText,
        fileHandle: handle,
        status: { ...get().status, hasFileHandle: !!handle, fileName: handle?.name },
      });
      return;
    }

    try {
      const data = await deserialize(workingText);
      set({
        ready: true,
        data,
        locked: false,
        needsPassphrase: false,
        fileHandle: handle,
        status: { ...get().status, hasFileHandle: !!handle, fileName: handle?.name },
      });
    } catch {
      set({
        ready: true,
        data: sampleData(),
        status: { ...get().status, hasFileHandle: !!handle, fileName: handle?.name },
      });
    }
  },

  recordActivity: () => set({ lastActivityAt: Date.now() }),

  lock: () => {
    if (get().data.settings.encryptionEnabled) {
      sessionPassphrase = undefined;
      set({ locked: true, needsPassphrase: true });
    } else {
      set({ locked: true });
    }
  },

  unlock: async (passphrase?: string) => {
    const state = get();
    if (!state.data.settings.encryptionEnabled && !state.needsPassphrase) {
      set({ locked: false, lastActivityAt: Date.now() });
      return true;
    }
    if (!passphrase) return false;
    // We have an encrypted working copy (either at startup or after lock).
    let encryptedText = state.pendingEncryptedText;
    if (!encryptedText) {
      try {
        encryptedText = await loadWorkingCopy();
      } catch {
        encryptedText = undefined;
      }
    }
    if (!encryptedText) {
      // Nothing to verify against (e.g. encryption just enabled). Accept and keep passphrase.
      sessionPassphrase = passphrase;
      set({ locked: false, needsPassphrase: false, lastActivityAt: Date.now() });
      scheduleSave(get);
      return true;
    }
    try {
      const data = await deserialize(encryptedText, passphrase);
      sessionPassphrase = passphrase;
      set({
        data,
        locked: false,
        needsPassphrase: false,
        pendingEncryptedText: undefined,
        lastActivityAt: Date.now(),
      });
      return true;
    } catch (err) {
      if (err instanceof WrongPassphraseError || err instanceof PassphraseRequiredError) return false;
      return false;
    }
  },

  saveMyData: async (filename = 'acc-nursing-data.accdata') => {
    const { data } = get();
    // Mirror the file-save path: encrypt with the session passphrase when
    // encryption is enabled in settings, otherwise write readable JSON.
    const usePass = data.settings.encryptionEnabled ? sessionPassphrase : undefined;
    const text = await serialize(data, usePass);
    downloadText(filename, text);
    set({
      status: {
        ...get().status,
        dirty: false,
        lastExportAt: Date.now(),
        saveState: 'saved',
        lastSavedAt: Date.now(),
        saveError: undefined,
      },
    });
  },

  loadMyData: async (text: string, passphrase?: string) => {
    const encrypted = isEncryptedFile(text);
    // Use the explicitly-provided passphrase, falling back to the session one.
    const pass = passphrase ?? sessionPassphrase;
    if (encrypted && !pass) throw new PassphraseRequiredError();
    // deserialize throws PassphraseRequiredError / WrongPassphraseError as needed.
    const data = await deserialize(text, pass);
    // Adopt the working passphrase so subsequent silent saves stay encrypted.
    if (encrypted && pass) sessionPassphrase = pass;
    set({
      data,
      status: {
        ...get().status,
        dirty: false,
        lastExportAt: Date.now(),
        saveState: 'saved',
        lastSavedAt: Date.now(),
        saveError: undefined,
      },
    });
    // Persist the freshly-loaded data into the IndexedDB working copy.
    scheduleSave(get);
  },

  connectNewFile: async () => {
    const handle = await pickSaveFile();
    const usePass = get().data.settings.encryptionEnabled ? sessionPassphrase : undefined;
    const text = await serialize(get().data, usePass);
    await writeToHandle(handle, text);
    await saveFileHandle(handle);
    set({
      fileHandle: handle,
      status: {
        ...get().status,
        hasFileHandle: true,
        fileName: handle.name,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        dirty: false,
        lastExportAt: Date.now(),
      },
    });
  },

  openExistingFile: async () => {
    const handle = await pickOpenFile();
    const ok = await verifyPermission(handle, true);
    if (!ok) throw new Error('Permission to read the file was not granted.');
    const text = await readFromHandle(handle);
    if (isEncryptedFile(text)) {
      await saveFileHandle(handle);
      set({
        fileHandle: handle,
        locked: true,
        needsPassphrase: true,
        pendingEncryptedText: text,
        status: { ...get().status, hasFileHandle: true, fileName: handle.name },
      });
      return;
    }
    const data = await deserialize(text);
    await saveFileHandle(handle);
    set({
      data,
      fileHandle: handle,
      locked: false,
      needsPassphrase: false,
      status: {
        ...get().status,
        hasFileHandle: true,
        fileName: handle.name,
        saveState: 'saved',
        lastSavedAt: Date.now(),
        dirty: false,
        lastExportAt: Date.now(),
      },
    });
    scheduleSave(get);
  },

  exportJsonDownload: () => {
    const env = JSON.stringify(
      { format: 'accdata', version: 1, encrypted: false, data: get().data },
      null,
      2,
    );
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`acc-nursing-backup-${stamp}.json`, env);
  },

  importJsonText: async (text: string) => {
    try {
      const data = await deserialize(text, sessionPassphrase);
      set({ data });
      scheduleSave(get);
      return true;
    } catch {
      return false;
    }
  },

  saveNow: async () => {
    if (saveTimer) clearTimeout(saveTimer);
    await persistAll(get);
  },

  disconnectFile: async () => {
    await clearFileHandle();
    set({ fileHandle: null, status: { ...get().status, hasFileHandle: false, fileName: undefined } });
  },

  loadSample: () => {
    set((s) => ({ data: sampleData(), status: { ...s.status, dirty: true } }));
    scheduleSave(get);
  },

  clearSampleData: () => {
    mutate(get, (data) => {
      const sampleNames = new Set(
        data.patients.filter((p) => p.id.startsWith('p_sample_')).map((p) => p.name),
      );
      return {
        ...data,
        patients: data.patients.filter((p) => !p.id.startsWith('p_sample_')),
        claims: data.claims.filter((c) => !c.id.startsWith('c_sample_')),
        serviceLines: data.serviceLines.filter((s) => !s.id.startsWith('sl_sample_')),
        approvals: data.approvals.filter((a) => !a.id.startsWith('ap_sample_')),
        invoiceLines: data.invoiceLines.filter((i) => !i.id.startsWith('inv_sample_') && !sampleNames.has(i.patientName)),
        complexCases: data.complexCases.filter((c) => !c.id.startsWith('cx_sample_')),
        declines: data.declines.filter((d) => !d.id.startsWith('dc_sample_')),
      };
    });
  },

  resetToEmpty: () => {
    const settings = get().data.settings;
    set((s) => ({ data: { ...emptyData(), settings: { ...settings } }, status: { ...s.status, dirty: true } }));
    scheduleSave(get);
  },

  replaceData: (data: AppData) => {
    set({ data });
    scheduleSave(get);
  },

  importFromExcel: (result: ImportResult, mode: ImportMode = 'merge') => {
    set((s) => ({
      data: mergeImportIntoData(s.data, result, mode),
      status: { ...s.status, dirty: true },
    }));
    scheduleSave(get);
  },

  updateSettings: (patch) => {
    mutate(get, (data) => ({ ...data, settings: { ...data.settings, ...patch } }));
  },

  setPassphrase: (passphrase: string) => {
    sessionPassphrase = passphrase;
    scheduleSave(get);
  },

  addPatient: (p) => {
    const id = uid('p');
    mutate(get, (data) => ({ ...data, patients: [...data.patients, { ...p, id }] }));
    return id;
  },
  updatePatient: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      patients: data.patients.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removePatient: (id) =>
    mutate(get, (data) => {
      const claimIds = new Set(data.claims.filter((c) => c.patientId === id).map((c) => c.id));
      return {
        ...data,
        patients: data.patients.filter((x) => x.id !== id),
        claims: data.claims.filter((c) => c.patientId !== id),
        serviceLines: data.serviceLines.filter((s) => !claimIds.has(s.claimId)),
        approvals: data.approvals.filter((a) => a.patientId !== id),
      };
    }),

  addClaim: (c) => {
    const id = uid('c');
    mutate(get, (data) => ({ ...data, claims: [...data.claims, { ...c, id }] }));
    return id;
  },
  updateClaim: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      claims: data.claims.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeClaim: (id) =>
    mutate(get, (data) => ({
      ...data,
      claims: data.claims.filter((x) => x.id !== id),
      serviceLines: data.serviceLines.filter((s) => s.claimId !== id),
      approvals: data.approvals.filter((a) => a.claimId !== id),
    })),

  addServiceLine: (s) => {
    const id = uid('sl');
    mutate(get, (data) => ({ ...data, serviceLines: [...data.serviceLines, { ...s, id }] }));
    return id;
  },
  updateServiceLine: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      serviceLines: data.serviceLines.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeServiceLine: (id) =>
    mutate(get, (data) => ({
      ...data,
      serviceLines: data.serviceLines.filter((x) => x.id !== id),
    })),

  addApproval: (a) => {
    const id = uid('ap');
    mutate(get, (data) => ({ ...data, approvals: [...data.approvals, { ...a, id }] }));
    return id;
  },
  updateApproval: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      approvals: data.approvals.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeApproval: (id) =>
    mutate(get, (data) => ({ ...data, approvals: data.approvals.filter((x) => x.id !== id) })),

  addInvoiceLine: (i) => {
    const id = uid('inv');
    mutate(get, (data) => ({ ...data, invoiceLines: [...data.invoiceLines, { ...i, id }] }));
    return id;
  },
  addInvoiceLines: (rows) =>
    mutate(get, (data) => ({
      ...data,
      invoiceLines: [...data.invoiceLines, ...rows.map((r) => ({ ...r, id: uid('inv') }))],
    })),
  updateInvoiceLine: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      invoiceLines: data.invoiceLines.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeInvoiceLine: (id) =>
    mutate(get, (data) => ({ ...data, invoiceLines: data.invoiceLines.filter((x) => x.id !== id) })),

  addComplexCase: (c) => {
    const id = uid('cx');
    mutate(get, (data) => ({ ...data, complexCases: [...data.complexCases, { ...c, id }] }));
    return id;
  },
  updateComplexCase: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      complexCases: data.complexCases.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeComplexCase: (id) =>
    mutate(get, (data) => ({ ...data, complexCases: data.complexCases.filter((x) => x.id !== id) })),

  addDecline: (d) => {
    const id = uid('dc');
    mutate(get, (data) => ({ ...data, declines: [...data.declines, { ...d, id }] }));
    return id;
  },
  updateDecline: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      declines: data.declines.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removeDecline: (id) =>
    mutate(get, (data) => ({ ...data, declines: data.declines.filter((x) => x.id !== id) })),
}));

export function hasSessionPassphrase(): boolean {
  return !!sessionPassphrase;
}

export { isSampleData };
export async function wipeAllLocalStorage(): Promise<void> {
  await clearWorkingCopy();
  await clearFileHandle();
}
