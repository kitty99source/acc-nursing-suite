/** Shape of email-sync-status.json written by outlook-sync.ps1 on work laptop. */

export const EMAIL_SYNC_STATUS_VERSION = 1;

export const EMAIL_SYNC_STATUS_FILENAME = 'email-sync-status.json';
export const EMAIL_SYNC_STATE_FILENAME = 'email-sync-state.json';

/** Typical path on work laptop (ACC Inbox UI hint). */
export const EMAIL_SYNC_STATUS_HINT_PATH = '%USERPROFILE%\\ACC-Suite\\email-sync-status.json';

export interface EmailSyncScanStats {
  mailItemsScanned: number;
  matchedSender: number;
  matchedBoth: number;
  skippedCategory: number;
  alreadyProcessed: number;
  noSupportedAttachment: number;
}

export interface EmailSyncSavedFile {
  fileName: string;
  subject: string;
  sender: string;
  savedAt: string;
}

export interface EmailSyncStatus {
  version: number;
  lastRunAt: string;
  outcome: 'running' | 'ok' | 'fail' | 'paused';
  mode?: 'backlog' | 'recent';
  batchSize?: number;
  savedCount: number;
  skippedCount: number;
  errorCount: number;
  savedFiles: EmailSyncSavedFile[];
  errors: string[];
  inboxPath: string;
  sharedMailbox: string;
  stateFile?: string;
  processedTotal?: number;
  workHoursSkipped?: boolean;
  backlogRemaining?: number | null;
  scanStats?: EmailSyncScanStats;
  /** True when UI report was inferred from email-sync-state.json (status file missing). */
  inferredFromState?: boolean;
}

const VALID_OUTCOMES = new Set<EmailSyncStatus['outcome']>(['running', 'ok', 'fail', 'paused']);

function parseScanStats(raw: unknown): EmailSyncScanStats | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const s = raw as Record<string, unknown>;
  return {
    mailItemsScanned: typeof s.mailItemsScanned === 'number' ? s.mailItemsScanned : 0,
    matchedSender: typeof s.matchedSender === 'number' ? s.matchedSender : 0,
    matchedBoth: typeof s.matchedBoth === 'number' ? s.matchedBoth : 0,
    skippedCategory: typeof s.skippedCategory === 'number' ? s.skippedCategory : 0,
    alreadyProcessed: typeof s.alreadyProcessed === 'number' ? s.alreadyProcessed : 0,
    noSupportedAttachment: typeof s.noSupportedAttachment === 'number' ? s.noSupportedAttachment : 0,
  };
}

function pickString(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function looksLikeEmailSyncStateFile(o: Record<string, unknown>): boolean {
  return Array.isArray(o.processedEntryIds) && typeof o.outcome !== 'string';
}

export function stripJsonBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function describeEmailSyncStatusRejectReason(
  raw: unknown,
  fileName?: string,
): string {
  const hint = `Pick ${EMAIL_SYNC_STATUS_HINT_PATH} (from Start Email Sync.cmd or Start WFH Mode.cmd).`;

  if (fileName === EMAIL_SYNC_STATE_FILENAME) {
    return `Wrong file: ${EMAIL_SYNC_STATE_FILENAME} is the resume checkpoint, not the UI report. Load ${EMAIL_SYNC_STATUS_FILENAME} instead — ${hint}`;
  }

  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    if (looksLikeEmailSyncStateFile(o)) {
      return `Wrong file: this looks like ${EMAIL_SYNC_STATE_FILENAME} (has processedEntryIds). Load ${EMAIL_SYNC_STATUS_FILENAME} instead — ${hint}`;
    }
    if (typeof o.outcome !== 'string') {
      return `Not a valid ${EMAIL_SYNC_STATUS_FILENAME} — missing outcome field. ${hint}`;
    }
    if (typeof o.lastRunAt !== 'string') {
      return `Not a valid ${EMAIL_SYNC_STATUS_FILENAME} — missing lastRunAt field. ${hint}`;
    }
  }

  return `Not a valid ${EMAIL_SYNC_STATUS_FILENAME} from Start Email Sync.cmd. ${hint}`;
}

export const LOCAL_EMAIL_SYNC_STATUS_URL = '/_acc/email-sync-status.json';

export async function fetchLocalEmailSyncStatus(): Promise<EmailSyncStatus | null> {
  try {
    const res = await fetch(LOCAL_EMAIL_SYNC_STATUS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = await res.text();
    return parseEmailSyncStatusFromText(text);
  } catch {
    return null;
  }
}

export function parseEmailSyncStatusFromText(text: string): EmailSyncStatus | null {
  try {
    return parseEmailSyncStatus(JSON.parse(stripJsonBom(text)) as unknown);
  } catch {
    return null;
  }
}

export function inboxRowsFromSyncStatus(
  status: EmailSyncStatus,
): import('./accInboxFilters').AccInboxRow[] {
  return status.savedFiles.map((f, i) => {
    const ext = f.fileName.includes('.') ? f.fileName.slice(f.fileName.lastIndexOf('.')).toLowerCase() : '';
    return {
      id: `sync-${i}-${f.fileName}`,
      sender: f.sender,
      subject: f.subject,
      receivedAt: new Date(f.savedAt).getTime(),
      attachmentName: f.fileName,
      attachmentExt: ext,
    };
  });
}

export function parseEmailSyncStateFallback(raw: unknown): EmailSyncStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.processedEntryIds)) return null;

  const runStats =
    o.runStats && typeof o.runStats === 'object' ? (o.runStats as Record<string, unknown>) : {};
  const lastRunAt = pickString(runStats, 'lastRunAt', 'LastRunAt');
  if (!lastRunAt) return null;

  return {
    version: EMAIL_SYNC_STATUS_VERSION,
    lastRunAt,
    outcome: 'ok',
    mode: 'backlog',
    savedCount: 0,
    skippedCount: typeof runStats.totalSkipped === 'number' ? runStats.totalSkipped : 0,
    errorCount: typeof runStats.totalErrors === 'number' ? runStats.totalErrors : 0,
    savedFiles: [],
    errors: [],
    inboxPath: '',
    sharedMailbox: '',
    processedTotal: o.processedEntryIds.length,
    inferredFromState: true,
  };
}

export function parseEmailSyncStatus(raw: unknown): EmailSyncStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const lastRunAt = pickString(o, 'lastRunAt', 'LastRunAt');
  const outcomeRaw = pickString(o, 'outcome', 'Outcome');
  if (!lastRunAt || !outcomeRaw || !VALID_OUTCOMES.has(outcomeRaw as EmailSyncStatus['outcome'])) {
    return null;
  }

  const version = typeof o.version === 'number' ? o.version : typeof o.Version === 'number' ? o.Version : 1;

  return {
    version,
    lastRunAt,
    outcome: outcomeRaw as EmailSyncStatus['outcome'],
    mode: o.mode === 'backlog' || o.mode === 'recent' ? o.mode : undefined,
    batchSize: typeof o.batchSize === 'number' ? o.batchSize : undefined,
    savedCount: typeof o.savedCount === 'number' ? o.savedCount : 0,
    skippedCount: typeof o.skippedCount === 'number' ? o.skippedCount : 0,
    errorCount: typeof o.errorCount === 'number' ? o.errorCount : 0,
    savedFiles: Array.isArray(o.savedFiles) ? (o.savedFiles as EmailSyncSavedFile[]) : [],
    errors: Array.isArray(o.errors) ? (o.errors as string[]) : [],
    inboxPath: typeof o.inboxPath === 'string' ? o.inboxPath : '',
    sharedMailbox: typeof o.sharedMailbox === 'string' ? o.sharedMailbox : '',
    stateFile: typeof o.stateFile === 'string' ? o.stateFile : undefined,
    processedTotal: typeof o.processedTotal === 'number' ? o.processedTotal : undefined,
    workHoursSkipped: o.workHoursSkipped === true,
    backlogRemaining: typeof o.backlogRemaining === 'number' ? o.backlogRemaining : undefined,
    scanStats: parseScanStats(o.scanStats),
    inferredFromState: o.inferredFromState === true,
  };
}

export function formatScanStatsSummary(stats: EmailSyncScanStats): string {
  return `${stats.mailItemsScanned} scanned, ${stats.matchedSender} sender match, ${stats.matchedBoth} sender+subject match`;
}

export function formatSyncOutcome(status: EmailSyncStatus): string {
  const when = new Date(status.lastRunAt).toLocaleString('en-NZ');
  const mode = status.mode === 'backlog' ? 'backlog' : status.mode === 'recent' ? 'recent' : 'sync';
  if (status.inferredFromState) {
    const processed =
      typeof status.processedTotal === 'number'
        ? ` (${status.processedTotal} emails processed overall)`
        : '';
    return `Checkpoint only — last run ${when}${processed}. Re-run Start Email Sync.cmd to create email-sync-status.json with scan detail.`;
  }
  if (status.outcome === 'ok') {
    const processed =
      typeof status.processedTotal === 'number' ? ` (${status.processedTotal} emails processed overall)` : '';
    const more =
      status.backlogRemaining != null && status.backlogRemaining !== 0
        ? ' — run again during work hours for more backlog.'
        : '';
    const scan =
      status.savedCount === 0 && status.scanStats
        ? ` — ${formatScanStatsSummary(status.scanStats)}.`
        : '';
    return `Last ${mode} ${when} — saved ${status.savedCount} attachment(s)${processed}${more}${scan}`;
  }
  if (status.outcome === 'paused') {
    if (status.workHoursSkipped) {
      return `Outside work hours — last check ${when}. Run again 7am–6pm NZ.`;
    }
    return `Automation paused — last check ${when}.`;
  }
  if (status.outcome === 'fail') {
    return `Last sync failed ${when} — ${status.errors[0] ?? 'see log on work laptop'}.`;
  }
  return `Sync status from ${when}.`;
}
