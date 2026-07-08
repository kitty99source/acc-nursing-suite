/** Shape of email-sync-status.json written by outlook-sync.ps1 on work laptop. */

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
  savedCount: number;
  skippedCount: number;
  errorCount: number;
  savedFiles: EmailSyncSavedFile[];
  errors: string[];
  inboxPath: string;
  sharedMailbox: string;
}

export function parseEmailSyncStatus(raw: unknown): EmailSyncStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.lastRunAt !== 'string' || typeof o.outcome !== 'string') return null;
  return {
    version: typeof o.version === 'number' ? o.version : 1,
    lastRunAt: o.lastRunAt,
    outcome: o.outcome as EmailSyncStatus['outcome'],
    savedCount: typeof o.savedCount === 'number' ? o.savedCount : 0,
    skippedCount: typeof o.skippedCount === 'number' ? o.skippedCount : 0,
    errorCount: typeof o.errorCount === 'number' ? o.errorCount : 0,
    savedFiles: Array.isArray(o.savedFiles) ? (o.savedFiles as EmailSyncSavedFile[]) : [],
    errors: Array.isArray(o.errors) ? (o.errors as string[]) : [],
    inboxPath: typeof o.inboxPath === 'string' ? o.inboxPath : '',
    sharedMailbox: typeof o.sharedMailbox === 'string' ? o.sharedMailbox : '',
  };
}

export function formatSyncOutcome(status: EmailSyncStatus): string {
  const when = new Date(status.lastRunAt).toLocaleString('en-NZ');
  if (status.outcome === 'ok') {
    return `Last sync ${when} — saved ${status.savedCount} attachment(s).`;
  }
  if (status.outcome === 'paused') {
    return `Automation paused — last check ${when}.`;
  }
  if (status.outcome === 'fail') {
    return `Last sync failed ${when} — ${status.errors[0] ?? 'see log on work laptop'}.`;
  }
  return `Sync status from ${when}.`;
}
