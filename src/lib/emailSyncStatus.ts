/** Shape of email-sync-status.json written by outlook-sync.ps1 on work laptop. */

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

export const LOCAL_EMAIL_SYNC_STATUS_URL = '/_acc/email-sync-status.json';

export async function fetchLocalEmailSyncStatus(): Promise<EmailSyncStatus | null> {
  try {
    const res = await fetch(LOCAL_EMAIL_SYNC_STATUS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    return parseEmailSyncStatus((await res.json()) as unknown);
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

export function parseEmailSyncStatus(raw: unknown): EmailSyncStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.lastRunAt !== 'string' || typeof o.outcome !== 'string') return null;
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    lastRunAt: o.lastRunAt,
    outcome: o.outcome as EmailSyncStatus['outcome'],
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
  };
}

export function formatScanStatsSummary(stats: EmailSyncScanStats): string {
  return `${stats.mailItemsScanned} scanned, ${stats.matchedSender} sender match, ${stats.matchedBoth} sender+subject match`;
}

export function formatSyncOutcome(status: EmailSyncStatus): string {
  const when = new Date(status.lastRunAt).toLocaleString('en-NZ');
  const mode = status.mode === 'backlog' ? 'backlog' : status.mode === 'recent' ? 'recent' : 'sync';
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
