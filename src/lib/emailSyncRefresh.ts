// ============================================================================
// ACC Inbox sync-refresh UX — phases, elapsed formatting, and a poll loop that
// waits while outlook-sync.ps1 still reports outcome "running". Soft cancel
// only aborts the UI wait (AbortSignal); it never stops Outlook itself.
// ============================================================================

import {
  fetchLocalEmailSyncStatus,
  type EmailSyncStatus,
} from './emailSyncStatus';

export type SyncRefreshPhase =
  | 'connecting'
  | 'fetching'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error';

export const SYNC_REFRESH_POLL_MS = 2_000;

export function formatElapsedMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function syncRefreshStatusText(
  phase: SyncRefreshPhase,
  status?: EmailSyncStatus | null,
): string {
  switch (phase) {
    case 'connecting':
      return 'Connecting to local helper…';
    case 'fetching':
      return 'Fetching sync report…';
    case 'running': {
      const mode = status?.mode === 'backlog' ? 'backlog' : status?.mode === 'recent' ? 'recent' : 'email';
      const saved =
        typeof status?.savedCount === 'number' ? ` · ${status.savedCount} saved so far` : '';
      return `Outlook ${mode} sync still running${saved}…`;
    }
    case 'done':
      return 'Refresh complete';
    case 'cancelled':
      return 'Refresh cancelled — showing last loaded status';
    case 'error':
      return 'Could not load sync report';
    default:
      return 'Please wait…';
  }
}

export interface RefreshEmailSyncResult {
  status: EmailSyncStatus | null;
  phase: SyncRefreshPhase;
  cancelled: boolean;
}

/**
 * Fetch email-sync-status.json (and poll while outcome is still "running").
 * Soft-cancel via `signal` stops waiting in the UI only.
 */
export async function refreshEmailSyncStatus(opts?: {
  signal?: AbortSignal;
  pollIntervalMs?: number;
  onPhase?: (phase: SyncRefreshPhase, status: EmailSyncStatus | null) => void;
}): Promise<RefreshEmailSyncResult> {
  const signal = opts?.signal;
  const pollMs = opts?.pollIntervalMs ?? SYNC_REFRESH_POLL_MS;
  const onPhase = opts?.onPhase;

  const emit = (phase: SyncRefreshPhase, status: EmailSyncStatus | null) => {
    onPhase?.(phase, status);
  };

  if (signal?.aborted) {
    emit('cancelled', null);
    return { status: null, phase: 'cancelled', cancelled: true };
  }

  emit('connecting', null);

  const fetchOnce = async (): Promise<EmailSyncStatus | null> => {
    emit('fetching', null);
    return fetchLocalEmailSyncStatus({ signal });
  };

  try {
    let status = await fetchOnce();
    if (signal?.aborted) {
      emit('cancelled', status);
      return { status, phase: 'cancelled', cancelled: true };
    }

    while (status?.outcome === 'running') {
      emit('running', status);
      await sleep(pollMs, signal);
      if (signal?.aborted) {
        emit('cancelled', status);
        return { status, phase: 'cancelled', cancelled: true };
      }
      status = await fetchOnce();
      if (signal?.aborted) {
        emit('cancelled', status);
        return { status, phase: 'cancelled', cancelled: true };
      }
    }

    emit('done', status);
    return { status, phase: 'done', cancelled: false };
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      emit('cancelled', null);
      return { status: null, phase: 'cancelled', cancelled: true };
    }
    emit('error', null);
    return { status: null, phase: 'error', cancelled: false };
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
