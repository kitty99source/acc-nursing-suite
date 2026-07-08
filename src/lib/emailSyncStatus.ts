/** Shape of email-sync-status.json written by outlook-sync.ps1 on work laptop. */

import { parseSubjectMetadata } from './accInboxFilters';

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

function parseSavedFiles(raw: unknown): EmailSyncSavedFile[] {
  if (!Array.isArray(raw)) return [];
  const files: EmailSyncSavedFile[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const f = entry as Record<string, unknown>;
    if (typeof f.fileName !== 'string' || f.fileName.length === 0) continue;
    files.push({
      fileName: f.fileName,
      subject: typeof f.subject === 'string' ? f.subject : '',
      sender: typeof f.sender === 'string' ? f.sender : '',
      savedAt: typeof f.savedAt === 'string' ? f.savedAt : '',
    });
  }
  return files;
}

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
    const parsed = parseEmailSyncStatusFromText(text);
    if (parsed) return parsed;
    try {
      return parseEmailSyncStateFallback(JSON.parse(stripJsonBom(text)) as unknown);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

export interface InboxEmptyStateCopy {
  title: string;
  message: string;
}

/** ACC Inbox list empty state — distinct from demo stubs and from HRQ staging. */
export function describeInboxEmptyState(
  status: EmailSyncStatus | null,
  loading: boolean,
  hiddenRowCount = 0,
): InboxEmptyStateCopy {
  if (loading) {
    return {
      title: 'Loading sync status…',
      message:
        'Reading email-sync-status.json from the work laptop. Demo rows stay hidden until this finishes.',
    };
  }
  if (!status) {
    return {
      title: 'No sync yet',
      message:
        'Run Start Email Sync.cmd (or Start WFH Mode.cmd) on the work laptop during 7am–6pm NZ, then reopen ACC Inbox or click Refresh sync status.',
    };
  }
  if (status.inferredFromState) {
    return {
      title: 'Checkpoint only — no letter list',
      message:
        'email-sync-state.json exists but email-sync-status.json is missing. Re-run Start Email Sync.cmd to write a full report with savedFiles and scan stats.',
    };
  }
  if (status.outcome === 'fail') {
    return {
      title: 'Last sync failed',
      message: status.errors[0] ?? 'See email-sync-bootstrap.log on the work laptop.',
    };
  }
  if (status.outcome === 'paused') {
    if (status.workHoursSkipped) {
      return {
        title: 'Outside work hours',
        message: 'Email sync runs 7am–6pm NZ only. Re-run during work hours or use Start Email Sync.cmd with -IgnoreWorkHours.',
      };
    }
    return {
      title: 'Automation paused',
      message: 'Turn off automation pause in Settings or remove .automation-paused from ACC-Inbox, then run sync again.',
    };
  }
  if (status.savedCount === 0 && status.savedFiles.length === 0) {
    const scan = status.scanStats ? formatScanStatsSummary(status.scanStats) : 'no scan stats in report';
    const mailbox = status.sharedMailbox || 'ACCDistrictNursing (default)';
    return {
      title: 'Sync ran — 0 letters saved',
      message: `Scan detail: ${scan}. Mailbox: ${mailbox}. Check ACC-Inbox folder for PDF/DOCX files; widen sender/subject filters in office-config.json if matches are zero.`,
    };
  }
  if (status.savedFiles.length > 0 && hiddenRowCount > 0) {
    return {
      title: `${hiddenRowCount} synced letter(s) hidden`,
      message:
        'Email sync saved attachments, but the ACC Inbox sender/subject filter rules (or Ignore) hid them all. Widen accInboxSenderAllowlist / accInboxSubjectPatterns via Settings office config, or open the ACC-Inbox folder directly.',
    };
  }
  return {
    title: 'No ACC letters in inbox',
    message: 'Filtered ACC correspondence will appear here after email sync saves attachments.',
  };
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
    const savedAtMs = new Date(f.savedAt).getTime();
    return {
      id: `sync-${i}-${f.fileName}`,
      sender: f.sender,
      subject: f.subject,
      receivedAt: Number.isNaN(savedAtMs) ? 0 : savedAtMs,
      attachmentName: f.fileName,
      attachmentExt: ext,
      ...parseSubjectMetadata(f.subject),
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
    savedFiles: parseSavedFiles(o.savedFiles),
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
