import { create } from 'zustand';
import type {
  AppData,
  Approval,
  Claim,
  ClaimDocument,
  ComplexCase,
  Decline,
  ImportHistoryEntry,
  InvoiceLine,
  Memo,
  Patient,
  ServiceLine,
  Settings,
} from '../types';
import { emptyData, sampleData, isSampleData } from '../lib/sampleData';
import { findMatchingPatient, mergePatientsIntoData } from '../lib/patients';
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
  normalizeData,
  PassphraseRequiredError,
  WrongPassphraseError,
} from '../lib/storage';
import { buildBackupZip, readBackupZip } from '../lib/backup';
import {
  loadWorkingCopy,
  saveWorkingCopy,
  clearWorkingCopy,
  saveFileHandle,
  loadFileHandle,
  clearFileHandle,
  loadRecentFiles,
  saveRecentFiles,
  saveDocumentBlob,
  loadDocumentBlob,
  deleteDocumentBlob,
  listDocumentIds,
  isRecoveryResolved,
  setRecoveryResolved,
  loadImportHistory,
  saveImportHistory,
  loadComplianceSnapshot,
  saveComplianceSnapshot,
  loadExcelImportSnapshot,
  saveExcelImportSnapshot,
  clearExcelImportSnapshot,
} from '../lib/idb';
import {
  invalidateComplianceCache,
  dataFingerprint,
  setComplianceSnapshot,
  getComplianceFindings,
} from '../lib/complianceCache';
import { appendAudit } from '../lib/auditLog';
import { validateReferentialIntegrity } from '../lib/integrity';
import { resolveWorkingCopyLoad } from '../lib/recovery';
import { uid, todayISO, formatDateNZ } from '../lib/format';
import { mergeImportIntoData, type ImportMode, type ImportResult } from '../lib/excelImport';
import { formatStorageError } from '../lib/storageQuota';
import { upsertRecent, removeRecentAt, type RecentFileEntry } from '../lib/recentFiles';
import type { EmailSyncStatus } from '../lib/emailSyncStatus';
import { determinePackage } from '../lib/calculator';
import { claimBillingState } from '../lib/compliance';
import { PACKAGE_CODES, MAX_PACKAGE_CONSULTS, getRate } from '../lib/serviceCodes';
import { buildInvoiceClaimIndex, claimKey, matchRemittanceToInvoice } from '../lib/billingReconcile';
import type { ParsedRemittanceLine } from '../lib/remittanceImport';
import type { RemittanceImportSummary } from '../lib/billingReconcile';
import {
  recomputeInvoiceFromPayments,
  type RemittanceImportBatch,
  type RemittancePayment,
  type RemittanceRemoveResult,
} from '../lib/remittancePayments';
import {
  loadAllStagingItems,
  removeDismissedStagingKeys,
  stagingIngressDedupKey,
  updateStagingItem,
} from '../lib/staging';
import {
  parseLetterFile as parseLetterFileLib,
  type LetterImportContext,
  type LetterParseResult,
  type ParsedApprovalLetter,
  type ParsedDeclineLetter,
  type ParsedServiceRow,
  type ParsedPackageRow,
  describeHistoricPackageRows,
  prefillFromParsed,
  letterKindToDocumentKind,
  sniffDocumentKindFromFileName,
  isDuplicateLetterImport,
  type DuplicateLetterImportOpts,
} from '../lib/letterImport';

export interface LetterImportCommitResult {
  patientId: string;
  claimId: string;
  kind: 'approval' | 'decline' | 'document-only';
  billingHint?: string;
  /** True when Accept created this patient (safe to remove on undo if empty). */
  createdPatient?: boolean;
  /** True when Accept created this claim (safe to remove on undo if empty). */
  createdClaim?: boolean;
  documentId?: string;
  approvalIds?: string[];
  declineId?: string;
}

export interface HrqAcceptUndoInput {
  stagingItemId: string;
  patientId: string;
  claimId: string;
  createdPatient?: boolean;
  createdClaim?: boolean;
  documentId?: string;
  approvalIds?: string[];
  declineId?: string;
}

export interface HrqAcceptUndoResult {
  restoredStaging: boolean;
  removedPatient: boolean;
  removedClaim: boolean;
}

// In-memory only. Never persisted, never logged, cleared on lock.
let sessionPassphrase: string | undefined;

// Recent-files handles kept in a module var (like sessionPassphrase): the raw
// FileSystemFileHandle objects live here, while only lightweight {name,
// lastUsedAt} rows are mirrored into state for rendering. Persisted to IDB.
let recentHandles: RecentFileEntry[] = [];
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const AUTOSAVE_DEBOUNCE_MS = 3000;
let autosavePaused = false;
let pendingSaveAfterPause = false;

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

// Cross-module navigation intent: lets one screen (e.g. the Flagged page) send
// the user to another with enough context to auto-open the right, pre-filled
// modal. `nonce` guarantees each request re-triggers even if the target repeats.
export type FocusTarget = 'patients' | 'approvals' | 'billing' | 'review';

export interface FocusRequest {
  module: FocusTarget;
  patientId?: string;
  claimId?: string;
  intent?: string; // matches FixIntent.action from lib/compliance
  prefill?: Record<string, unknown>;
  /** When navigating from Dashboard → Compliance with filter context (P5-020). */
  complianceFilter?: { severity?: string; ruleId?: string };
  nonce: number;
}

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

export interface RecoveryState {
  error: string;
  integrityWarnings?: string[];
}

export type TopBarFlashTone = 'good' | 'danger' | 'warn';

export interface TopBarFlashMessage {
  text: string;
  tone: TopBarFlashTone;
  nonce: number;
}

interface StoreState {
  ready: boolean;
  data: AppData;
  status: AppStatus;
  locked: boolean;
  needsPassphrase: boolean; // encrypted working copy present, awaiting unlock
  lastActivityAt: number;
  fileHandle: FileSystemFileHandle | null;
  /**
   * Lightweight, most-recent-first list of files the user can "Save into"
   * directly (names + timestamps only for rendering; the underlying
   * FileSystemFileHandle objects are kept internal in the store module).
   */
  recentFiles: { name: string; lastUsedAt: number }[];
  pendingEncryptedText?: string; // encrypted working copy awaiting passphrase
  focus?: FocusRequest; // pending cross-module navigation intent
  /**
   * Last ACC Inbox email-sync report shown to the user. Held in the store (not
   * AccInbox local state) so navigating away from ACC Inbox and back does not
   * drop the loaded rows to the "no sync yet" empty state. In-memory only —
   * never persisted, since it can carry PHI from savedFiles.
   */
  accInboxSyncStatus?: EmailSyncStatus;
  /** Blocks main UI until user picks a recovery path (P0-001). */
  recovery?: RecoveryState;
  /** Non-fatal integrity warnings from last successful load (P0-007). */
  integrityWarnings: string[];
  /** True when a pre-Excel-import snapshot is available for undo (P3-005). */
  excelImportRollbackAvailable: boolean;
  letterImport?: {
    file: File;
    context?: LetterImportContext;
    prefillOnly?: boolean;
    onPrefill?: (patches: ReturnType<typeof prefillFromParsed>) => void;
    entryPoint?: import('../components/LetterImportButton').LetterImportEntryPoint;
    /** HRQ sign-off — resolved when import commits successfully (P8-002). */
    stagingItemId?: string;
    onImportComplete?: () => void;
  };
  /** Cross-component TopBar flash (e.g. post letter import). */
  topBarFlash?: TopBarFlashMessage;

  // lifecycle
  init: () => Promise<void>;
  resolveRecoveryEmpty: () => Promise<void>;
  resolveRecoverySample: () => Promise<void>;
  resolveRecoveryFromAccdata: (text: string, passphrase?: string) => Promise<void>;
  resolveRecoveryFromZip: (zip: Blob) => Promise<void>;
  recordActivity: () => void;
  lock: () => void;
  unlock: (passphrase?: string) => Promise<boolean>;

  // cross-module navigation intent
  setFocus: (req: Omit<FocusRequest, 'nonce'>) => void;
  clearFocus: () => void;

  // ACC Inbox loaded email-sync report (persists across module navigation)
  setAccInboxSyncStatus: (status: EmailSyncStatus | undefined) => void;

  showTopBarFlash: (text: string, tone?: TopBarFlashTone) => void;
  clearTopBarFlash: () => void;

  /**
   * Easter egg: transient (never-persisted) session flag for the disco-cats
   * overlay. Toggled by triple-clicking the NS brand mark; the persisted
   * `settings.discoCatsEnabled` toggle is independent and always-on.
   */
  discoActive: boolean;
  setDiscoActive: (active: boolean) => void;

  // ACC letter import (approval / decline PDFs)
  openLetterImport: (file: File, opts?: { context?: LetterImportContext; prefillOnly?: boolean; onPrefill?: (patches: ReturnType<typeof prefillFromParsed>) => void; entryPoint?: import('../components/LetterImportButton').LetterImportEntryPoint; stagingItemId?: string; onImportComplete?: () => void }) => void;
  closeLetterImport: () => void;
  parseLetterFile: (
    file: File,
    context?: LetterImportContext,
    onProgress?: import('../lib/letterImport').LetterImportProgressHandler,
  ) => Promise<LetterParseResult>;
  commitParsedApproval: (
    parsed: ParsedApprovalLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientPatch?: Partial<Patient>;
      claimPatch?: Partial<Claim>;
      rows: ParsedServiceRow[];
      /**
       * NS01–NS03 package rows to record as HISTORIC, non-billable history
       * (ACC dropped the NS03 approval requirement in March 2025). These never
       * create approvals and never bill — they are folded into the letter
       * document's note so the patient's history is complete.
       */
      historicRows?: ParsedPackageRow[];
      /**
       * True when this commit came from the Review Queue's "Auto-accept
       * ready" batch action rather than an individually human-reviewed
       * Accept — stamps every Approval record created here as auto-accepted
       * so it stays traceable/filterable later.
       */
      autoAccept?: boolean;
      /** When set, stamps the created document for patient-side Accept undo. */
      stagingItemId?: string;
    },
  ) => Promise<LetterImportCommitResult>;
  commitParsedDecline: (
    parsed: ParsedDeclineLetter,
    file: File,
    opts: {
      patientName?: string;
      claimNumber?: string;
      reason?: string;
      servicePeriodDeclined?: string;
      declineReceivedDate?: string;
      patientId?: string;
      claimId?: string;
      /** When set, stamps the created document for patient-side Accept undo. */
      stagingItemId?: string;
    },
  ) => Promise<LetterImportCommitResult>;
  attachDocumentOnly: (
    file: File,
    opts?: {
      claimId?: string;
      patientId?: string;
      kind?: ClaimDocument['kind'];
      /** Parsed letter type — maps to acc-approval-letter / acc-decline-letter. */
      letterKind?: 'approval' | 'decline';
      stagingItemId?: string;
    },
  ) => Promise<LetterImportCommitResult>;
  reparseDocument: (documentId: string) => Promise<void>;
  findDuplicateLetterImport: (
    claimId: string,
    file: Blob,
    opts?: DuplicateLetterImportOpts,
  ) => Promise<boolean>;

  // manual persistence (primary; works on file://)
  saveMyData: (filename?: string) => Promise<{ savedToFile: boolean; fileName: string }>;
  loadMyData: (text: string, passphrase?: string) => Promise<void>;

  // file ops (File System Access API — optional/advanced)
  connectNewFile: () => Promise<void>;
  openExistingFile: () => Promise<void>;
  /** Overwrite one of the recent files (by index into `recentFiles`). */
  saveIntoRecent: (index: number) => Promise<{ fileName: string }>;
  exportJsonDownload: () => void;
  importJsonText: (text: string) => Promise<void>;
  saveNow: () => Promise<void>;
  disconnectFile: () => Promise<void>;

  // data management
  loadSample: () => void;
  clearSampleData: () => void;
  resetToEmpty: () => void;
  replaceData: (data: AppData) => void;
  importFromExcel: (result: ImportResult, mode?: ImportMode) => Promise<void>;
  rollbackExcelImport: () => Promise<void>;

  // settings
  updateSettings: (patch: Partial<Settings>) => void;
  setPassphrase: (passphrase: string) => void;

  // patient CRUD
  addPatient: (p: Omit<Patient, 'id'>) => string;
  updatePatient: (id: string, patch: Partial<Patient>) => void;
  removePatient: (id: string) => void;
  /** Merge duplicate patient rows into keepId (reattach claims/approvals/docs/memos). */
  mergePatients: (keepId: string, dropIds: string[]) => void;

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
  // Guided billing: create the correct invoice lines for a claim from its
  // service-line records, with rates and patient/claim/PO/NHI auto-carried.
  // Returns the number of lines created (0 if already billed / nothing to do).
  generateInvoiceLinesForClaim: (claimId: string) => number;
  // Invoice-schedule import: upsert-by-(claim, service code, invoice sheet).
  // Returns how many lines were newly created vs updated.
  importInvoiceSchedule: (rows: Omit<InvoiceLine, 'id' | 'status'>[]) => { created: number; updated: number };
  // Remittance import: match each remittance line to an invoice line by
  // claim key (never by name) and update its paid/status/review fields.
  // Persists a batch + payment applications so Remove import can re-reconcile.
  importRemittanceBatch: (
    lines: ParsedRemittanceLine[],
    opts?: { fileName?: string },
  ) => RemittanceImportSummary & { batchId: string };
  removeRemittanceImport: (batchId: string) => RemittanceRemoveResult;

  /** Undo a Review Queue Accept: restore staging + remove accept-created artifacts. */
  undoHrqAccept: (input: HrqAcceptUndoInput) => Promise<HrqAcceptUndoResult>;
  /** Undo Accept using metadata stamped on the claim document (patient-side). */
  undoHrqAcceptFromDocument: (documentId: string) => Promise<HrqAcceptUndoResult>;

  // complex case CRUD
  addComplexCase: (c: Omit<ComplexCase, 'id'>) => string;
  updateComplexCase: (id: string, patch: Partial<ComplexCase>) => void;
  removeComplexCase: (id: string) => void;

  // decline CRUD
  addDecline: (d: Omit<Decline, 'id'>) => string;
  updateDecline: (id: string, patch: Partial<Decline>) => void;
  removeDecline: (id: string) => void;

  // memo CRUD (nurse follow-up tracking, distinct from Patient.notes)
  addMemo: (m: Omit<Memo, 'id' | 'createdAt' | 'resolved' | 'resolvedAt'>) => string;
  updateMemo: (id: string, patch: Partial<Memo>) => void;
  resolveMemo: (id: string, resolved: boolean) => void;
  removeMemo: (id: string) => void;

  // document attachments (metadata in `data.documents`, bytes in IndexedDB)
  addDocument: (meta: Omit<ClaimDocument, 'id' | 'addedDate'>, blob: Blob) => Promise<string>;
  updateDocument: (id: string, patch: Partial<ClaimDocument>) => void;
  removeDocument: (id: string) => Promise<void>;
  getDocumentBlob: (id: string) => Promise<Blob | undefined>;

  // full backup bundle (data + document bytes) as a portable .zip
  exportFullBackup: () => Promise<Blob>;
  importFullBackup: (zip: Blob) => Promise<void>;
}

function scheduleSave(get: () => StoreState) {
  if (autosavePaused) {
    pendingSaveAfterPause = true;
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void persistAll(get);
  }, AUTOSAVE_DEBOUNCE_MS);
}

export function pauseAutosave(): void {
  autosavePaused = true;
}

export function resumeAutosave(get: () => StoreState): void {
  autosavePaused = false;
  if (pendingSaveAfterPause) {
    pendingSaveAfterPause = false;
    scheduleSave(get);
  }
}

/** Strip importHistory from IDB working copy to shrink autosave payload (P1-009). */
function dataForWorkingCopy(data: AppData): AppData {
  const { importHistory: _history, ...rest } = data;
  return rest as AppData;
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
    const text = await serialize(dataForWorkingCopy(data), usePass);
    await saveWorkingCopy(text);
    if (data.importHistory?.length) {
      await saveImportHistory(data.importHistory);
    }
    const hash = dataFingerprint(data);
    const findings = getComplianceFindings(data);
    await saveComplianceSnapshot({ hash, findings, savedAt: Date.now() });
    setComplianceSnapshot(findings, hash);
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
      status: { ...s.status, saveState: 'error', saveError: formatStorageError(err) },
    }));
  }
}

/** Mirror the internal recent-handles list into state for rendering (names only). */
function publishRecentFiles(): void {
  useStore.setState({
    recentFiles: recentHandles.map((e) => ({ name: e.name, lastUsedAt: e.lastUsedAt })),
  });
}

/** Add/bump a handle to the front of the recent list; persist + publish. */
async function recordRecentFile(handle: FileSystemFileHandle): Promise<void> {
  recentHandles = upsertRecent(recentHandles, {
    handle,
    name: handle.name,
    lastUsedAt: Date.now(),
  });
  publishRecentFiles();
  try {
    await saveRecentFiles(recentHandles);
  } catch {
    // non-fatal: the in-memory list still works for this session
  }
}

/** Drop a recent entry (permission denied / file gone); persist + publish. */
async function dropRecentFileAt(index: number): Promise<void> {
  recentHandles = removeRecentAt(recentHandles, index);
  publishRecentFiles();
  try {
    await saveRecentFiles(recentHandles);
  } catch {
    // non-fatal
  }
}

function audit(action: string, entityType: string, entityId: string | undefined, summary: string) {
  const user = useStore.getState().data.settings.userDisplayName?.trim();
  void appendAudit({ action, entityType, entityId, summary, ...(user ? { user } : {}) }).catch(() => {});
}

async function enrichLoadedData(data: AppData): Promise<AppData> {
  let enriched = data;
  try {
    const history = await loadImportHistory();
    if (history?.length) enriched = { ...enriched, importHistory: history };
  } catch {
    // non-fatal
  }
  try {
    const snap = await loadComplianceSnapshot();
    if (snap?.findings?.length && snap.hash === dataFingerprint(enriched)) {
      setComplianceSnapshot(snap.findings, snap.hash);
    }
  } catch {
    // non-fatal
  }
  return enriched;
}

function adoptLoadedData(
  data: AppData,
  opts: { markExported?: boolean; dirty?: boolean; statusPatch?: Partial<AppStatus> } = {},
): Pick<StoreState, 'data' | 'integrityWarnings' | 'status'> {
  const warnings = validateReferentialIntegrity(data);
  const now = Date.now();
  return {
    data,
    integrityWarnings: warnings,
    status: {
      ...useStore.getState().status,
      saveState: 'saved',
      lastSavedAt: now,
      saveError: undefined,
      dirty: opts.dirty ?? false,
      ...(opts.markExported ? { lastExportAt: now, dirty: false } : {}),
      ...opts.statusPatch,
    },
  };
}

function mutate(
  get: () => StoreState,
  updater: (data: AppData) => AppData,
  scope?: { claimIds?: string[] },
) {
  useStore.setState((s) => ({
    data: updater(s.data),
    status: s.status.dirty ? s.status : { ...s.status, dirty: true },
  }));
  const next = get().data;
  if (scope?.claimIds?.length) {
    getComplianceFindings(next, { dirtyClaimIds: scope.claimIds });
  } else {
    invalidateComplianceCache();
    getComplianceFindings(next, { forceFull: true });
  }
  scheduleSave(get);
}

function pushImportHistory(get: () => StoreState, entry: Omit<ImportHistoryEntry, 'id' | 'importedAt'>) {
  mutate(get, (data) => {
    const row: ImportHistoryEntry = { ...entry, id: uid('imp'), importedAt: Date.now() };
    const history = [row, ...(data.importHistory ?? [])].slice(0, 20);
    return { ...data, importHistory: history };
  });
  void saveImportHistory(get().data.importHistory ?? []).catch(() => {});
}

function billingHintForClaim(data: AppData, claimId: string): string | undefined {
  const claim = data.claims.find((c) => c.id === claimId);
  if (!claim) return undefined;
  const lines = data.serviceLines.filter((l) => l.claimId === claimId);
  const approvals = data.approvals.filter((a) => a.claimId === claimId);
  const key = (claim.claimNumber || '').trim().toUpperCase();
  const acc = (claim.acc45Number || '').trim().toUpperCase();
  const claimInvoices = data.invoiceLines.filter(
    (i) =>
      (key && (i.claimNumber || '').trim().toUpperCase() === key) ||
      (acc && (i.acc45Number || '').trim().toUpperCase() === acc),
  );
  const state = claimBillingState(claim, lines, approvals, claimInvoices);
  if (state.state === 'ready') return 'Safe to bill';
  return `Still blocked: ${state.reason}`;
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
  recentFiles: [],
  integrityWarnings: [],
  excelImportRollbackAvailable: false,
  discoActive: false,

  init: async () => {
    let handle: FileSystemFileHandle | null = null;
    try {
      handle = (await loadFileHandle()) ?? null;
    } catch {
      handle = null;
    }
    try {
      recentHandles = await loadRecentFiles();
    } catch {
      recentHandles = [];
    }
    const recentFiles = recentHandles.map((e) => ({ name: e.name, lastUsedAt: e.lastUsedAt }));
    let excelImportRollbackAvailable = false;
    try {
      excelImportRollbackAvailable = !!(await loadExcelImportSnapshot());
    } catch {
      excelImportRollbackAvailable = false;
    }
    let workingText: string | undefined;
    try {
      workingText = await loadWorkingCopy();
    } catch {
      workingText = undefined;
    }

    const baseStatus = {
      ...get().status,
      hasFileHandle: !!handle,
      fileName: handle?.name,
    };

    const loadResult = await resolveWorkingCopyLoad(workingText);

    if (loadResult.type === 'empty') {
      set({
        ready: true,
        data: sampleData(),
        locked: false,
        needsPassphrase: false,
        fileHandle: handle,
        recentFiles,
        integrityWarnings: [],
        excelImportRollbackAvailable,
        status: baseStatus,
      });
      scheduleSave(get);
      return;
    }

    if (loadResult.type === 'encrypted') {
      set({
        ready: true,
        locked: true,
        needsPassphrase: true,
        pendingEncryptedText: loadResult.text,
        fileHandle: handle,
        recentFiles,
        integrityWarnings: [],
        excelImportRollbackAvailable,
        status: baseStatus,
      });
      return;
    }

    if (loadResult.type === 'corrupt') {
      const alreadyResolved = await isRecoveryResolved();
      set({
        ready: true,
        data: emptyData(),
        locked: false,
        needsPassphrase: false,
        fileHandle: handle,
        recentFiles,
        integrityWarnings: [],
        excelImportRollbackAvailable,
        recovery: alreadyResolved
          ? { error: `${loadResult.error} (recovery was attempted before — choose again)` }
          : { error: loadResult.error },
        status: baseStatus,
      });
      return;
    }

    const enriched = await enrichLoadedData(loadResult.data);
    set({
      ready: true,
      locked: false,
      needsPassphrase: false,
      fileHandle: handle,
      recentFiles,
      excelImportRollbackAvailable,
      ...adoptLoadedData(enriched, { statusPatch: baseStatus }),
    });
  },

  resolveRecoveryEmpty: async () => {
    await clearWorkingCopy();
    await setRecoveryResolved(true);
    const settings = get().data.settings;
    set({
      data: { ...emptyData(), settings: { ...settings } },
      recovery: undefined,
      integrityWarnings: [],
      status: { ...get().status, dirty: true },
    });
    audit('recovery', 'system', undefined, 'Started empty after corrupt working copy');
    scheduleSave(get);
  },

  resolveRecoverySample: async () => {
    if (get().data.settings.productionMode !== false) {
      throw new Error('Sample data recovery is only available in dev mode.');
    }
    await clearWorkingCopy();
    await setRecoveryResolved(true);
    set({
      data: sampleData(),
      recovery: undefined,
      integrityWarnings: [],
      status: { ...get().status, dirty: true },
    });
    audit('recovery', 'system', undefined, 'Loaded sample data after corrupt working copy');
    scheduleSave(get);
  },

  resolveRecoveryFromAccdata: async (text: string, passphrase?: string) => {
    const encrypted = isEncryptedFile(text);
    const pass = passphrase ?? sessionPassphrase;
    if (encrypted && !pass) throw new PassphraseRequiredError();
    const data = await deserialize(text, pass);
    if (encrypted && pass) sessionPassphrase = pass;
    await clearWorkingCopy();
    await setRecoveryResolved(true);
    set({
      recovery: undefined,
      ...adoptLoadedData(data, { markExported: true }),
    });
    audit('recovery', 'system', undefined, 'Restored from .accdata after corrupt working copy');
    scheduleSave(get);
  },

  resolveRecoveryFromZip: async (zip: Blob) => {
    const { data, blobs } = await readBackupZip(zip);
    for (const [id, blob] of blobs) await saveDocumentBlob(id, blob);
    await clearWorkingCopy();
    await setRecoveryResolved(true);
    set({
      recovery: undefined,
      ...adoptLoadedData(normalizeData(data), { dirty: true }),
    });
    audit('recovery', 'system', undefined, `Restored ZIP backup (${blobs.size} document blobs)`);
    scheduleSave(get);
  },

  recordActivity: () => set({ lastActivityAt: Date.now() }),

  setFocus: (req) => set({ focus: { ...req, nonce: Date.now() } }),
  clearFocus: () => set({ focus: undefined }),

  setAccInboxSyncStatus: (status) => set({ accInboxSyncStatus: status }),

  showTopBarFlash: (text, tone = 'good') =>
    set({ topBarFlash: { text, tone, nonce: Date.now() } }),
  clearTopBarFlash: () => set({ topBarFlash: undefined }),

  setDiscoActive: (active) => set({ discoActive: active }),

  openLetterImport: (file, opts) =>
    set({
      letterImport: {
        file,
        context: opts?.context,
        prefillOnly: opts?.prefillOnly,
        onPrefill: opts?.onPrefill,
        entryPoint: opts?.entryPoint ?? (opts?.prefillOnly ? 'prefill' : opts?.context?.claimId ? 'claim-documents' : 'global'),
        stagingItemId: opts?.stagingItemId,
        onImportComplete: opts?.onImportComplete,
      },
    }),
  closeLetterImport: () => set({ letterImport: undefined }),

  parseLetterFile: async (file, context, onProgress) => {
    const data = get().data;
    return parseLetterFileLib(file, data, context, onProgress);
  },

  commitParsedApproval: async (parsed, file, opts) => {
    const priorData = get().data;
    const priorDirty = get().status.dirty;
    let createdDocId: string | undefined;
    try {
      const state = get();
      let patientId = opts.patientId;
      let claimId = opts.claimId;
      let createdPatient = !patientId;
      const createdClaim = !claimId;
      const approvalIds: string[] = [];

      if (!patientId && opts.patientPatch?.name) {
        const match = findMatchingPatient(state.data.patients, {
          name: opts.patientPatch.name,
          nhi: opts.patientPatch.nhi ?? parsed.patient.nhi ?? '',
          dob: opts.patientPatch.dob ?? parsed.patient.dob ?? '',
        });
        if (match) {
          patientId = match.patient.id;
          createdPatient = false;
          if (opts.patientPatch) state.updatePatient(patientId, opts.patientPatch);
        } else {
          patientId = state.addPatient({
            name: opts.patientPatch.name,
            nhi: opts.patientPatch.nhi ?? parsed.patient.nhi ?? '',
            dob: opts.patientPatch.dob ?? parsed.patient.dob ?? '',
            notes: '',
          });
        }
      } else if (patientId && opts.patientPatch) {
        state.updatePatient(patientId, opts.patientPatch);
      }

      if (!patientId) throw new Error('Patient is required to file an approval letter.');

      if (!claimId) {
        claimId = state.addClaim({
          patientId,
          claimNumber: opts.claimPatch?.claimNumber ?? parsed.claim.claimNumber ?? '',
          acc45Number: opts.claimPatch?.acc45Number ?? parsed.claim.acc45Number ?? '',
          poNumber: opts.claimPatch?.poNumber ?? parsed.claim.poNumber ?? '',
          injuryDescription: opts.claimPatch?.injuryDescription ?? parsed.claim.injuryDescription ?? '',
          type: 'original',
          status: 'active',
          day1Date: opts.claimPatch?.day1Date ?? parsed.claim.dateOfInjury ?? todayISO(),
        });
      } else if (opts.claimPatch) {
        const patch = { ...opts.claimPatch };
        const claim = state.data.claims.find((c) => c.id === claimId);
        if (claim && !claim.poNumber && parsed.claim.poNumber) {
          patch.poNumber = patch.poNumber ?? parsed.claim.poNumber;
        }
        state.updateClaim(claimId, patch);
      }

      // Fold any NS01–NS03 package rows into the document note as HISTORIC,
      // non-billable history. These never become approvals and never bill.
      const historicRows = opts.historicRows ?? [];
      const noteParts: string[] = [];
      if (parsed.letterDate) noteParts.push(`Letter dated ${formatDateNZ(parsed.letterDate)}`);
      if (historicRows.length > 0) noteParts.push(describeHistoricPackageRows(historicRows));

      const docId = await state.addDocument(
        {
          claimId,
          kind: 'acc-approval-letter',
          fileName: file instanceof File ? file.name : 'approval-letter.pdf',
          mimeType: file.type || 'application/pdf',
          sizeBytes: file.size,
          notes: noteParts.length ? noteParts.join(' · ') : undefined,
          ...(opts.stagingItemId
            ? {
                stagingItemId: opts.stagingItemId,
                fromReviewAccept: true,
                reviewAcceptCreatedPatient: createdPatient || undefined,
                reviewAcceptCreatedClaim: createdClaim || undefined,
              }
            : {}),
        },
        file,
      );
      createdDocId = docId;

      // Demote any existing current approvals for codes we're importing.
      const codes = new Set(opts.rows.map((r) => r.serviceCode));
      for (const a of state.data.approvals) {
        if (a.claimId === claimId && codes.has(a.serviceCode) && a.recordStatus !== 'historical') {
          state.updateApproval(a.id, { recordStatus: 'historical' });
        }
      }

      let currentApprovalId: string | undefined;
      for (const row of opts.rows) {
        const id = state.addApproval({
          patientId,
          claimId,
          serviceCode: row.serviceCode,
          approvalStartDate: row.approvalStartDate,
          approvalEndDate: row.approvalEndDate,
          approvedHoursOrConsults: row.approvedHoursOrConsults,
          consultsUsed: undefined,
          accEmailedRenewalDate: undefined,
          poNumber: parsed.claim.poNumber ?? '',
          notes: `Imported from ACC letter (${parsed.formCode ?? 'NUR02'})`,
          recordStatus: row.recordStatus ?? 'historical',
          sourceDocumentId: docId,
          ...(opts.autoAccept ? { autoAccepted: true, autoAcceptedAt: Date.now() } : {}),
        });
        approvalIds.push(id);
        if (row.recordStatus === 'current') currentApprovalId = id;
      }

      // Link the current NS04/NS05 service line to the latest approval.
      if (currentApprovalId) {
        const currentRow = opts.rows.find((r) => r.recordStatus === 'current');
        if (currentRow) {
          const line = state.data.serviceLines.find(
            (l) => l.claimId === claimId && l.serviceCode === currentRow.serviceCode,
          );
          if (line) {
            state.updateServiceLine(line.id, { approvalId: currentApprovalId });
          } else {
            state.addServiceLine({
              claimId,
              serviceCode: currentRow.serviceCode,
              day1Date: currentRow.approvalStartDate,
              lastConsultDate: undefined,
              consultCount: 0,
              interruptions: [],
              approvalId: currentApprovalId,
            });
          }
        }
      }

      pushImportHistory(get, {
        fileName: file instanceof File ? file.name : 'approval-letter.pdf',
        kind: 'approval',
        patientId,
        claimId,
        sizeBytes: file.size,
      });
      const billingHint = billingHintForClaim(get().data, claimId);
      return {
        patientId,
        claimId,
        kind: 'approval',
        billingHint,
        createdPatient,
        createdClaim,
        documentId: docId,
        approvalIds,
      };
    } catch (err) {
      // Nothing partially created should survive a failed accept: put the
      // patient/claim/approval/service-line arrays back exactly as they were,
      // and remove any document blob bytes already written to IndexedDB
      // before the failure (the metadata row was rolled back with `data`, so
      // an un-deleted blob would otherwise be orphaned, unreferenced bytes).
      useStore.setState((s) => ({ data: priorData, status: { ...s.status, dirty: priorDirty } }));
      if (createdDocId) await deleteDocumentBlob(createdDocId).catch(() => {});
      throw err;
    }
  },

  commitParsedDecline: async (parsed, file, opts) => {
    const priorData = get().data;
    const priorDirty = get().status.dirty;
    let createdDocId: string | undefined;
    try {
      const state = get();
      const claimNumber = opts.claimNumber ?? parsed.claim.claimNumber ?? '';
      let patientId = opts.patientId;
      let claimId = opts.claimId ?? state.data.claims.find((c) => c.claimNumber.replace(/\s/g, '') === claimNumber.replace(/\s/g, ''))?.id;
      let createdPatient = !patientId;
      let createdClaim = !claimId;
      let declineId: string | undefined;

      if (!patientId && claimId) {
        patientId = state.data.claims.find((c) => c.id === claimId)?.patientId;
      }
      if (!patientId) {
        const match = findMatchingPatient(state.data.patients, {
          name: opts.patientName ?? parsed.patient.name ?? '',
          nhi: parsed.patient.nhi ?? '',
          dob: parsed.patient.dob ?? '',
        });
        if (match) patientId = match.patient.id;
      }
      if (patientId) createdPatient = false;
      if (!patientId) {
        const name = (opts.patientName ?? parsed.patient.name ?? '').trim();
        if (name) {
          patientId = state.addPatient({
            name,
            nhi: parsed.patient.nhi ?? '',
            dob: parsed.patient.dob ?? '',
            notes: '',
          });
        }
      }

      if (claimId) createdClaim = false;
      if (!claimId && claimNumber && patientId) {
        createdClaim = true;
        claimId = state.addClaim({
          patientId,
          claimNumber,
          acc45Number: parsed.claim.acc45Number ?? '',
          poNumber: '',
          injuryDescription: parsed.claim.injuryDescription ?? '',
          type: 'original',
          status: 'active',
          day1Date: parsed.claim.dateOfInjury ?? todayISO(),
        });
      }

      let docId: string | undefined;
      if (claimId) {
        docId = await state.addDocument(
          {
            claimId,
            kind: 'acc-decline-letter',
            fileName: file instanceof File ? file.name : 'decline-letter.pdf',
            mimeType: file.type || 'application/pdf',
            sizeBytes: file.size,
            ...(opts.stagingItemId
              ? {
                  stagingItemId: opts.stagingItemId,
                  fromReviewAccept: true,
                  reviewAcceptCreatedPatient: createdPatient || undefined,
                  reviewAcceptCreatedClaim: createdClaim || undefined,
                }
              : {}),
          },
          file,
        );
        createdDocId = docId;
      }

      declineId = state.addDecline({
        patientId,
        claimId,
        patientName: opts.patientName ?? parsed.patient.name ?? '',
        claimNumber,
        declineReceivedDate: opts.declineReceivedDate ?? parsed.letterDate ?? todayISO(),
        servicePeriodDeclined: opts.servicePeriodDeclined ?? parsed.serviceRequested ?? 'Extended Nursing',
        reason: opts.reason ?? parsed.reason ?? '',
        status: 'Awaiting nursing docs for resubmission',
        notes: parsed.formCode ? `Imported from ${parsed.formCode}` : '',
        sourceDocumentId: docId,
      });

      pushImportHistory(get, {
        fileName: file instanceof File ? file.name : 'decline-letter.pdf',
        kind: 'decline',
        patientId,
        claimId,
        sizeBytes: file.size,
      });
      if (!patientId || !claimId) {
        return {
          patientId: patientId ?? '',
          claimId: claimId ?? '',
          kind: 'decline',
          createdPatient,
          createdClaim,
          documentId: docId,
          declineId,
        };
      }
      return {
        patientId,
        claimId,
        kind: 'decline',
        createdPatient,
        createdClaim,
        documentId: docId,
        declineId,
      };
    } catch (err) {
      useStore.setState((s) => ({ data: priorData, status: { ...s.status, dirty: priorDirty } }));
      if (createdDocId) await deleteDocumentBlob(createdDocId).catch(() => {});
      throw err;
    }
  },

  attachDocumentOnly: async (file, opts) => {
    const state = get();
    let patientId = opts?.patientId;
    let claimId = opts?.claimId;

    if (!claimId && patientId) {
      const claims = state.data.claims.filter((c) => c.patientId === patientId);
      if (claims.length === 1) claimId = claims[0].id;
    }
    if (!claimId) throw new Error('Select or create a claim before attaching a document.');

    if (!patientId) patientId = state.data.claims.find((c) => c.id === claimId)?.patientId;
    if (!patientId) throw new Error('Could not resolve patient for this claim.');

    const docKind =
      opts?.kind ??
      letterKindToDocumentKind(opts?.letterKind) ??
      sniffDocumentKindFromFileName(file.name) ??
      'other';

    const docId = await state.addDocument(
      {
        claimId,
        kind: docKind,
        fileName: file.name,
        mimeType: file.type || 'application/pdf',
        sizeBytes: file.size,
        notes: docKind === 'other' ? 'Attached without parsing' : 'Attached from letter import',
        ...(opts?.stagingItemId
          ? {
              stagingItemId: opts.stagingItemId,
              fromReviewAccept: true,
            }
          : {}),
      },
      file,
    );

    pushImportHistory(get, { fileName: file.name, kind: 'document-only', patientId, claimId, sizeBytes: file.size });
    return { patientId, claimId, kind: 'document-only', documentId: docId };
  },

  reparseDocument: async (documentId) => {
    const state = get();
    const doc = state.data.documents.find((d) => d.id === documentId);
    if (!doc) throw new Error('Document not found');
    const blob = await state.getDocumentBlob(documentId);
    if (!blob) throw new Error('Document file missing from storage');
    const claim = state.data.claims.find((c) => c.id === doc.claimId);
    const file = new File([blob], doc.fileName, { type: doc.mimeType || 'application/pdf' });
    state.openLetterImport(file, {
      context: { claimId: doc.claimId, patientId: claim?.patientId },
    });
  },

  findDuplicateLetterImport: async (claimId, file, opts) =>
    isDuplicateLetterImport(get().data, claimId, file, (id) => loadDocumentBlob(id), opts),

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
    const { data, fileHandle } = get();
    const usePass = data.settings.encryptionEnabled ? sessionPassphrase : undefined;
    const text = await serialize(data, usePass);
    // If the user has connected a real file (via Open / Save to file…), overwrite
    // that same file instead of downloading a fresh copy every time. Only fall
    // back to a browser download when no file handle is connected.
    let savedToFile = false;
    let savedName = filename;
    if (fileHandle) {
      const ok = await verifyPermission(fileHandle, true);
      if (ok) {
        await writeToHandle(fileHandle, text);
        savedToFile = true;
        savedName = fileHandle.name;
        void recordRecentFile(fileHandle);
      }
    }
    if (!savedToFile) downloadText(filename, text);
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
    audit(
      'export',
      'accdata',
      undefined,
      savedToFile
        ? `Saved .accdata to ${savedName} (${data.patients.length} patients, ${data.claims.length} claims)`
        : `Exported .accdata (${data.patients.length} patients, ${data.claims.length} claims)`,
    );
    return { savedToFile, fileName: savedName };
  },

  loadMyData: async (text: string, passphrase?: string) => {
    const encrypted = isEncryptedFile(text);
    const pass = passphrase ?? sessionPassphrase;
    if (encrypted && !pass) throw new PassphraseRequiredError();
    const data = await deserialize(text, pass);
    if (encrypted && pass) sessionPassphrase = pass;
    set(adoptLoadedData(data, { markExported: true }));
    audit('import', 'accdata', undefined, `Loaded .accdata (${data.patients.length} patients)`);
    scheduleSave(get);
  },

  connectNewFile: async () => {
    const handle = await pickSaveFile();
    const usePass = get().data.settings.encryptionEnabled ? sessionPassphrase : undefined;
    const text = await serialize(get().data, usePass);
    await writeToHandle(handle, text);
    await saveFileHandle(handle);
    void recordRecentFile(handle);
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
      void recordRecentFile(handle);
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
    void recordRecentFile(handle);
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

  saveIntoRecent: async (index: number) => {
    const entry = recentHandles[index];
    if (!entry) throw new Error('That recent file is no longer available.');
    const handle = entry.handle;

    // May prompt the user to re-grant write permission for a persisted handle.
    let granted = false;
    try {
      granted = await verifyPermission(handle, true);
    } catch {
      granted = false;
    }
    if (!granted) {
      await dropRecentFileAt(index);
      throw new Error(
        `Permission to write “${entry.name}” was denied — it has been removed from recent files.`,
      );
    }

    const { data } = get();
    const usePass = data.settings.encryptionEnabled ? sessionPassphrase : undefined;
    const text = await serialize(data, usePass);
    try {
      await writeToHandle(handle, text);
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (name === 'NotFoundError' || name === 'NotAllowedError') {
        await dropRecentFileAt(index);
        throw new Error(
          `“${entry.name}” could not be written (it may have been moved or deleted) — it has been removed from recent files.`,
        );
      }
      throw err;
    }

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
        saveError: undefined,
      },
    });
    await recordRecentFile(handle);
    audit(
      'export',
      'accdata',
      undefined,
      `Saved .accdata into ${handle.name} (${data.patients.length} patients, ${data.claims.length} claims)`,
    );
    return { fileName: handle.name };
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
    const data = await deserialize(text, sessionPassphrase);
    set({ ...adoptLoadedData(data), status: { ...get().status, dirty: true } });
    audit('import', 'json', undefined, `Imported JSON backup (${data.patients.length} patients)`);
    scheduleSave(get);
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

  importFromExcel: async (result: ImportResult, mode: ImportMode = 'merge') => {
    pauseAutosave();
    const snapshot = get().data;
    await saveExcelImportSnapshot({
      savedAt: Date.now(),
      dataJson: JSON.stringify(snapshot),
    });
    set((s) => ({
      data: mergeImportIntoData(s.data, result, mode),
      status: { ...s.status, dirty: true },
      excelImportRollbackAvailable: true,
    }));
    invalidateComplianceCache();
    getComplianceFindings(get().data, { forceFull: true });
    audit('import', 'excel', undefined, `Excel import (${mode})`);
    resumeAutosave(get);
  },

  rollbackExcelImport: async () => {
    const snap = await loadExcelImportSnapshot();
    if (!snap) {
      set({ excelImportRollbackAvailable: false });
      return;
    }
    let restored: AppData;
    try {
      restored = normalizeData(JSON.parse(snap.dataJson) as AppData);
    } catch {
      await clearExcelImportSnapshot();
      set({ excelImportRollbackAvailable: false });
      return;
    }
    pauseAutosave();
    set({
      ...adoptLoadedData(restored, { dirty: true }),
      excelImportRollbackAvailable: false,
    });
    await clearExcelImportSnapshot();
    invalidateComplianceCache();
    getComplianceFindings(get().data, { forceFull: true });
    audit('rollback', 'excel', undefined, 'Rolled back Excel import');
    resumeAutosave(get);
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
    audit('create', 'patient', id, `Added patient ${p.name}`);
    return id;
  },
  updatePatient: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      patients: data.patients.map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  removePatient: (id) => {
    const name = get().data.patients.find((p) => p.id === id)?.name ?? id;
    mutate(get, (data) => {
      const claimIds = new Set(data.claims.filter((c) => c.patientId === id).map((c) => c.id));
      data.documents
        .filter((d) => claimIds.has(d.claimId))
        .forEach((d) => void deleteDocumentBlob(d.id).catch(() => {}));
      return {
        ...data,
        patients: data.patients.filter((x) => x.id !== id),
        claims: data.claims.filter((c) => c.patientId !== id),
        serviceLines: data.serviceLines.filter((s) => !claimIds.has(s.claimId)),
        approvals: data.approvals.filter((a) => a.patientId !== id),
        documents: data.documents.filter((d) => !claimIds.has(d.claimId)),
        memos: (data.memos ?? []).filter((m) => m.patientId !== id),
      };
    });
    audit('delete', 'patient', id, `Removed patient ${name}`);
  },
  mergePatients: (keepId, dropIds) => {
    const drops = dropIds.filter((id) => id !== keepId);
    if (drops.length === 0) return;
    const keepName = get().data.patients.find((p) => p.id === keepId)?.name ?? keepId;
    mutate(get, (data) => mergePatientsIntoData(data, keepId, drops));
    audit(
      'update',
      'patient',
      keepId,
      `Merged ${drops.length} duplicate patient(s) into ${keepName}`,
    );
  },

  addClaim: (c) => {
    const id = uid('c');
    mutate(get, (data) => ({ ...data, claims: [...data.claims, { ...c, id }] }));
    return id;
  },
  updateClaim: (id, patch) =>
    mutate(
      get,
      (data) => ({
        ...data,
        claims: data.claims.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      { claimIds: [id] },
    ),
  removeClaim: (id) => {
    const claimNo = get().data.claims.find((c) => c.id === id)?.claimNumber ?? id;
    mutate(get, (data) => {
      data.documents
        .filter((d) => d.claimId === id)
        .forEach((d) => void deleteDocumentBlob(d.id).catch(() => {}));
      return {
        ...data,
        claims: data.claims.filter((x) => x.id !== id),
        serviceLines: data.serviceLines.filter((s) => s.claimId !== id),
        approvals: data.approvals.filter((a) => a.claimId !== id),
        documents: data.documents.filter((d) => d.claimId !== id),
      };
    });
    audit('delete', 'claim', id, `Removed claim ${claimNo}`);
  },

  addServiceLine: (s) => {
    const id = uid('sl');
    mutate(get, (data) => ({ ...data, serviceLines: [...data.serviceLines, { ...s, id }] }));
    return id;
  },
  updateServiceLine: (id, patch) => {
    const claimId = get().data.serviceLines.find((x) => x.id === id)?.claimId;
    mutate(
      get,
      (data) => ({
        ...data,
        serviceLines: data.serviceLines.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      claimId ? { claimIds: [claimId] } : undefined,
    );
  },
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
  updateApproval: (id, patch) => {
    const claimId = get().data.approvals.find((x) => x.id === id)?.claimId;
    mutate(
      get,
      (data) => ({
        ...data,
        approvals: data.approvals.map((x) => (x.id === id ? { ...x, ...patch } : x)),
      }),
      claimId ? { claimIds: [claimId] } : undefined,
    );
  },
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

  generateInvoiceLinesForClaim: (claimId) => {
    const data = get().data;
    const claim = data.claims.find((c) => c.id === claimId);
    if (!claim) return 0;
    const patient = data.patients.find((p) => p.id === claim.patientId);
    const lines = data.serviceLines.filter((l) => l.claimId === claimId);
    const rates = { serviceRates: data.settings.serviceRates };
    const claimKey = (claim.claimNumber || '').trim().toUpperCase();

    // Don't duplicate: skip if a package/NS04/NS05 line already exists for this claim.
    const alreadyBilled = data.invoiceLines.some(
      (i) =>
        (i.claimNumber || '').trim().toUpperCase() === claimKey &&
        (PACKAGE_CODES.includes(i.serviceCode) || i.serviceCode === 'NS04' || i.serviceCode === 'NS05'),
    );
    if (alreadyBilled) return 0;

    const carry = {
      patientName: patient?.name ?? '',
      nhi: patient?.nhi ?? '',
      claimNumber: claim.claimNumber,
      poNumber: claim.poNumber,
      acc45Number: claim.acc45Number,
      invoiceSheet: '',
      invoiceDate: todayISO(),
      datePaid: undefined,
      amountPaid: undefined,
      status: 'Awaiting Billing' as const,
    };
    const makeLine = (serviceCode: InvoiceLine['serviceCode'], amount: number, notes: string): Omit<InvoiceLine, 'id'> => ({
      ...carry,
      serviceCode,
      amountInvoiced: Math.round(amount * 100) / 100,
      notes,
    });

    const rows: Omit<InvoiceLine, 'id'>[] = [];
    for (const line of lines) {
      if (PACKAGE_CODES.includes(line.serviceCode)) {
        const det = determinePackage(
          {
            day1: line.day1Date,
            lastConsult: line.lastConsultDate || undefined,
            consultCount: line.consultCount,
            interruptions: line.interruptions,
          },
          data.settings.serviceRates,
        );
        const code = line.overridePackage ?? det.primaryPackage;
        rows.push(makeLine(code, getRate(code, rates), 'Auto-generated from service line'));
        if (line.consultCount > MAX_PACKAGE_CONSULTS) {
          const extra = line.consultCount - MAX_PACKAGE_CONSULTS;
          rows.push(makeLine('NS04', getRate('NS04', rates) * extra, `Auto-generated: ${extra} consult(s) beyond the 25 cap`));
        }
      } else if (line.serviceCode === 'NS04' || line.serviceCode === 'NS05') {
        const qty = Math.max(1, line.consultCount || 1);
        rows.push(makeLine(line.serviceCode, getRate(line.serviceCode, rates) * qty, `Auto-generated (${qty} ${line.serviceCode === 'NS05' ? 'hour(s)' : 'consult(s)'})`));
      }
    }
    if (rows.length === 0) return 0;
    get().addInvoiceLines(rows);
    return rows.length;
  },

  importInvoiceSchedule: (rows) => {
    let created = 0;
    let updated = 0;
    mutate(get, (data) => {
      const existing = [...data.invoiceLines];
      // Upsert key: same claim + service code + invoice sheet — a re-import of the
      // same monthly schedule (e.g. re-downloaded after ACC corrects a row) updates
      // in place instead of duplicating.
      const keyOf = (l: { claimNumber: string; serviceCode: string; invoiceSheet: string }) =>
        `${claimKey(l.claimNumber)}|${l.serviceCode.trim().toUpperCase()}|${l.invoiceSheet.trim().toUpperCase()}`;
      const byKey = new Map(existing.map((l, idx) => [keyOf(l), idx]));
      for (const row of rows) {
        const key = keyOf(row);
        const idx = byKey.get(key);
        if (idx != null) {
          existing[idx] = {
            ...existing[idx],
            patientName: row.patientName || existing[idx].patientName,
            nhi: row.nhi || existing[idx].nhi,
            invoiceDate: row.invoiceDate || existing[idx].invoiceDate,
            amountInvoiced: row.amountInvoiced,
          };
          updated += 1;
        } else {
          const id = uid('inv');
          existing.push({ ...row, id, status: 'Awaiting Billing' });
          byKey.set(key, existing.length - 1);
          created += 1;
        }
      }
      return { ...data, invoiceLines: existing };
    });
    if (created || updated) {
      audit('import', 'invoiceLine', undefined, `Imported invoice schedule: ${created} new, ${updated} updated`);
    }
    return { created, updated };
  },

  importRemittanceBatch: (lines, opts) => {
    const batchId = uid('rbatch');
    const summary: RemittanceImportSummary & { batchId: string } = {
      matchedCount: 0,
      paidInFullCount: 0,
      heldCount: 0,
      unmatchedCount: 0,
      unmatched: [],
      batchId,
    };
    const unmatchedClaims: string[] = [];
    const newPayments: RemittancePayment[] = [];
    mutate(get, (data) => {
      const invoiceLines = [...data.invoiceLines];
      const index = buildInvoiceClaimIndex(invoiceLines);
      for (const rem of lines) {
        const matched = matchRemittanceToInvoice(rem, index);
        if (!matched) {
          summary.unmatchedCount += 1;
          unmatchedClaims.push(rem.claimNumber);
          summary.unmatched.push({ claimNumber: rem.claimNumber, clientName: rem.clientName, amountPaid: rem.amountPaid });
          continue;
        }
        summary.matchedCount += 1;
        const idx = invoiceLines.findIndex((l) => l.id === matched.id);
        if (idx < 0) continue;
        const payment: RemittancePayment = {
          id: uid('rpay'),
          batchId,
          invoiceLineId: matched.id,
          claimNumber: rem.claimNumber,
          amountPaid: rem.amountPaid,
          paymentDate: rem.amountPaid > 0 ? todayISO() : undefined,
          reasonCode: rem.reasonCode,
          reasonText: rem.reasonText,
          lineNeedsReview: Boolean(rem.lineNeedsReview),
        };
        newPayments.push(payment);
        const allPayments = [...(data.remittancePayments ?? []), ...newPayments].filter(
          (p) => p.invoiceLineId === matched.id,
        );
        const patch = recomputeInvoiceFromPayments(invoiceLines[idx], allPayments);
        if (patch.needsReview) summary.heldCount += 1;
        else if (patch.status === 'Billed') summary.paidInFullCount += 1;
        invoiceLines[idx] = { ...invoiceLines[idx], ...patch };
      }
      const batch: RemittanceImportBatch = {
        id: batchId,
        importedAt: Date.now(),
        sourceFileName: opts?.fileName?.trim() || 'remittance-import',
        lineCount: lines.length,
        matchedCount: summary.matchedCount,
        unmatchedClaimNumbers: unmatchedClaims,
      };
      return {
        ...data,
        invoiceLines,
        remittanceImports: [...(data.remittanceImports ?? []), batch],
        remittancePayments: [...(data.remittancePayments ?? []), ...newPayments],
      };
    });
    audit(
      'import',
      'invoiceLine',
      batchId,
      `Imported remittance "${opts?.fileName ?? 'file'}": ${summary.matchedCount} matched (${summary.paidInFullCount} paid in full, ${summary.heldCount} need review), ${summary.unmatchedCount} unmatched`,
    );
    return summary;
  },

  removeRemittanceImport: (batchId) => {
    const data = get().data;
    const batch = (data.remittanceImports ?? []).find((b) => b.id === batchId);
    if (!batch) {
      return { ok: false, error: 'That remittance import was not found — it may already have been removed.' };
    }
    const removedPayments = (data.remittancePayments ?? []).filter((p) => p.batchId === batchId);
    const affectedInvoiceIds = new Set(removedPayments.map((p) => p.invoiceLineId));
    mutate(get, (next) => {
      const remittancePayments = (next.remittancePayments ?? []).filter((p) => p.batchId !== batchId);
      const remittanceImports = (next.remittanceImports ?? []).filter((b) => b.id !== batchId);
      const invoiceLines = next.invoiceLines.map((line) => {
        if (!affectedInvoiceIds.has(line.id)) return line;
        return { ...line, ...recomputeInvoiceFromPayments(line, remittancePayments) };
      });
      return { ...next, remittancePayments, remittanceImports, invoiceLines };
    });
    audit(
      'delete',
      'invoiceLine',
      batchId,
      `Removed remittance import "${batch.sourceFileName}" (${removedPayments.length} payment(s), ${affectedInvoiceIds.size} invoice(s) re-reconciled)`,
    );
    return {
      ok: true,
      batchId,
      fileName: batch.sourceFileName,
      removedLineCount: removedPayments.length,
      affectedInvoiceCount: affectedInvoiceIds.size,
    };
  },

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

  addMemo: (m) => {
    const id = uid('memo');
    mutate(get, (data) => ({
      ...data,
      memos: [...(data.memos ?? []), { ...m, id, createdAt: Date.now() }],
    }));
    const patient = get().data.patients.find((p) => p.id === m.patientId);
    audit('create', 'memo', id, `Added memo for ${patient?.name ?? m.patientId}`);
    return id;
  },
  updateMemo: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      memos: (data.memos ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
    })),
  resolveMemo: (id, resolved) =>
    mutate(get, (data) => ({
      ...data,
      memos: (data.memos ?? []).map((x) =>
        x.id === id ? { ...x, resolved, resolvedAt: resolved ? Date.now() : undefined } : x,
      ),
    })),
  removeMemo: (id) => {
    mutate(get, (data) => ({ ...data, memos: (data.memos ?? []).filter((x) => x.id !== id) }));
    audit('delete', 'memo', id, 'Removed memo');
  },

  addDocument: async (meta, blob) => {
    const id = uid('doc');
    // Write the bytes first; only record the metadata if that succeeds.
    await saveDocumentBlob(id, blob);
    const doc: ClaimDocument = { ...meta, id, addedDate: new Date().toISOString() };
    mutate(get, (data) => ({ ...data, documents: [...data.documents, doc] }));
    return id;
  },
  updateDocument: (id, patch) =>
    mutate(get, (data) => ({
      ...data,
      documents: data.documents.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    })),
  removeDocument: async (id) => {
    const doc = get().data.documents.find((d) => d.id === id);
    try {
      await deleteDocumentBlob(id);
    } catch (err) {
      throw new Error(`Could not delete document file from storage: ${(err as Error).message}`);
    }
    mutate(get, (data) => ({ ...data, documents: data.documents.filter((d) => d.id !== id) }));
    audit('delete', 'document', id, `Removed document ${doc?.fileName ?? id}`);
  },
  getDocumentBlob: async (id) => loadDocumentBlob(id),

  exportFullBackup: async () => {
    const blob = await buildBackupZip(get().data, (id) => loadDocumentBlob(id));
    const ids = await listDocumentIds();
    audit(
      'export',
      'zip',
      undefined,
      `Full ZIP backup (${get().data.documents.length} docs metadata, ${ids.length} blobs in IDB)`,
    );
    return blob;
  },
  importFullBackup: async (zip) => {
    const prior = get().data;
    try {
      const { data, blobs } = await readBackupZip(zip);
      for (const [id, blob] of blobs) await saveDocumentBlob(id, blob);
      set({ ...adoptLoadedData(normalizeData(data)), status: { ...get().status, dirty: true } });
      audit('import', 'zip', undefined, `Restored ZIP (${blobs.size} document blobs)`);
      scheduleSave(get);
    } catch (err) {
      set({ data: prior });
      throw err;
    }
  },

  undoHrqAccept: async (input) => {
    const allStaging = await loadAllStagingItems();
    const stagingItem = allStaging.find((i) => i.id === input.stagingItemId);

    if (input.documentId) {
      await get().removeDocument(input.documentId);
    }
    for (const approvalId of input.approvalIds ?? []) {
      const linkedLines = get().data.serviceLines.filter((l) => l.approvalId === approvalId);
      for (const line of linkedLines) {
        if ((line.consultCount ?? 0) > 0 || (line.interruptions?.length ?? 0) > 0) {
          get().updateServiceLine(line.id, { approvalId: undefined });
        } else {
          get().removeServiceLine(line.id);
        }
      }
      get().removeApproval(approvalId);
    }
    if (input.declineId) {
      get().removeDecline(input.declineId);
    }

    let removedClaim = false;
    if (input.createdClaim && input.claimId) {
      const remainingDocs = get().data.documents.filter((d) => d.claimId === input.claimId);
      const remainingApprovals = get().data.approvals.filter((a) => a.claimId === input.claimId);
      const remainingDeclines = get().data.declines.filter((d) => d.claimId === input.claimId);
      const remainingLines = get().data.serviceLines.filter((l) => l.claimId === input.claimId);
      if (
        remainingDocs.length === 0 &&
        remainingApprovals.length === 0 &&
        remainingDeclines.length === 0 &&
        remainingLines.length === 0
      ) {
        get().removeClaim(input.claimId);
        removedClaim = true;
      }
    }

    let removedPatient = false;
    if (input.createdPatient && input.patientId) {
      const remainingClaims = get().data.claims.filter((c) => c.patientId === input.patientId);
      const remainingDeclines = get().data.declines.filter((d) => d.patientId === input.patientId);
      if (remainingClaims.length === 0 && remainingDeclines.length === 0) {
        get().removePatient(input.patientId);
        removedPatient = true;
      }
    }

    let restoredStaging = false;
    if (stagingItem) {
      await updateStagingItem(input.stagingItemId, { status: 'pending' });
      await removeDismissedStagingKeys([stagingIngressDedupKey(stagingItem)]);
      restoredStaging = true;
    }

    audit(
      'delete',
      'staging',
      input.stagingItemId,
      `Undid Review Queue Accept${restoredStaging ? ' — letter restored to queue' : ''}`,
    );

    return { restoredStaging, removedPatient, removedClaim };
  },

  undoHrqAcceptFromDocument: async (documentId) => {
    const doc = get().data.documents.find((d) => d.id === documentId);
    if (!doc?.fromReviewAccept || !doc.stagingItemId) {
      throw new Error(
        'This document was not created by a Review Queue Accept, so it cannot be undone that way.',
      );
    }
    const claim = get().data.claims.find((c) => c.id === doc.claimId);
    if (!claim) {
      throw new Error('Claim for this document is missing.');
    }
    const approvalIds = get()
      .data.approvals.filter((a) => a.sourceDocumentId === documentId)
      .map((a) => a.id);
    const declineId = get().data.declines.find((d) => d.sourceDocumentId === documentId)?.id;
    return get().undoHrqAccept({
      stagingItemId: doc.stagingItemId,
      patientId: claim.patientId,
      claimId: doc.claimId,
      createdPatient: doc.reviewAcceptCreatedPatient,
      createdClaim: doc.reviewAcceptCreatedClaim,
      documentId: doc.id,
      approvalIds,
      declineId,
    });
  },

}));

export function hasSessionPassphrase(): boolean {
  return !!sessionPassphrase;
}

export { isSampleData };
export async function wipeAllLocalStorage(): Promise<void> {
  await clearWorkingCopy();
  await clearFileHandle();
}
