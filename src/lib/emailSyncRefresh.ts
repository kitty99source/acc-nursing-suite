// ============================================================================
// ACC Inbox sync-refresh UX — plain-language phases, elapsed formatting, and a
// poll loop that waits while Outlook sync reports outcome "running".
// Soft cancel only aborts the UI wait (AbortSignal); it never stops Outlook.
// ============================================================================

import {
  fetchLocalEmailSyncStatus,
  type EmailSyncStatus,
} from './emailSyncStatus';

export type SyncRefreshPhase =
  | 'connecting'
  | 'starting'
  | 'checking'
  | 'running'
  | 'done'
  | 'cancelled'
  | 'error'
  | 'stopped';

export const SYNC_REFRESH_POLL_MS = 2_000;
/** After POST, how long to wait for a new lastRunAt (sync actually started). */
export const SYNC_REFRESH_START_TIMEOUT_MS = 45_000;
/** Once a run is underway, max wait for outcome to leave "running". */
export const SYNC_REFRESH_RUNNING_TIMEOUT_MS = 8 * 60_000;
/** On load (no trigger), do not hang forever on a stale outcome=running report. */
export const SYNC_REFRESH_STALE_RUNNING_MS = 90_000;
export const LOCAL_EMAIL_SYNC_TRIGGER_URL = '/_acc/email-sync';

export function formatElapsedMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Coworker-facing status line — no script / path jargon. */
export function syncRefreshStatusText(
  phase: SyncRefreshPhase,
  status?: EmailSyncStatus | null,
): string {
  switch (phase) {
    case 'connecting':
      return 'Starting local helper…';
    case 'starting':
      return 'Asking the helper to check mail…';
    case 'checking':
      return 'Checking mail…';
    case 'running': {
      const saved =
        typeof status?.savedCount === 'number' && status.savedCount > 0
          ? ` · ${status.savedCount} letter(s) saved so far`
          : '';
      return `Checking mail in Outlook${saved}…`;
    }
    case 'done':
      return 'Refresh complete';
    case 'cancelled':
      return 'Stopped waiting — showing the last status we have';
    case 'stopped':
      return 'Sync stopped — retry';
    case 'error':
      return 'Could not reach the local helper — is the suite open via the quiet starter?';
    default:
      return 'Please wait…';
  }
}

export interface TriggerEmailSyncResult {
  ok: boolean;
  queued?: boolean;
  started?: boolean;
  /** True when the helper bridge is down (404 / network). */
  unavailable?: boolean;
}

/** Ask the local helper to run Outlook email sync (supervisor picks it up). */
export async function triggerEmailSync(opts?: {
  signal?: AbortSignal;
}): Promise<TriggerEmailSyncResult> {
  try {
    const res = await fetch(LOCAL_EMAIL_SYNC_TRIGGER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: '{}',
      signal: opts?.signal,
      cache: 'no-store',
    });
    if (res.status === 404) return { ok: false, unavailable: true };
    if (!res.ok) return { ok: false, unavailable: false };
    const raw = (await res.json()) as { ok?: boolean; queued?: boolean; started?: boolean };
    return {
      ok: raw.ok !== false,
      queued: raw.queued === true,
      started: raw.started === true,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return { ok: false, unavailable: true };
  }
}

export interface RefreshEmailSyncResult {
  status: EmailSyncStatus | null;
  phase: SyncRefreshPhase;
  cancelled: boolean;
  /** True when Outlook sync was requested (or already running). */
  triggered: boolean;
}

function isTerminalOutcome(outcome: EmailSyncStatus['outcome'] | undefined): boolean {
  return (
    outcome === 'ok' ||
    outcome === 'fail' ||
    outcome === 'paused' ||
    outcome === 'connection-lost'
  );
}

function isNewRun(status: EmailSyncStatus | null, baselineRunAt: string | null): boolean {
  if (!status?.lastRunAt) return false;
  if (!baselineRunAt) return true;
  return status.lastRunAt !== baselineRunAt;
}

/**
 * Trigger Outlook sync (when the helper is up), then poll email-sync-status
 * until it leaves "running". Soft-cancel via `signal` stops waiting in the UI.
 * Always ends: success, fail/stopped, cancel, helper-down error, or timeout.
 */
export async function refreshEmailSyncStatus(opts?: {
  signal?: AbortSignal;
  pollIntervalMs?: number;
  startTimeoutMs?: number;
  runningTimeoutMs?: number;
  staleRunningMs?: number;
  /** When false, only re-read the last report (no new Outlook sync). Default true. */
  triggerSync?: boolean;
  onPhase?: (phase: SyncRefreshPhase, status: EmailSyncStatus | null) => void;
}): Promise<RefreshEmailSyncResult> {
  const signal = opts?.signal;
  const pollMs = opts?.pollIntervalMs ?? SYNC_REFRESH_POLL_MS;
  const startTimeoutMs = opts?.startTimeoutMs ?? SYNC_REFRESH_START_TIMEOUT_MS;
  const runningTimeoutMs = opts?.runningTimeoutMs ?? SYNC_REFRESH_RUNNING_TIMEOUT_MS;
  const staleRunningMs = opts?.staleRunningMs ?? SYNC_REFRESH_STALE_RUNNING_MS;
  const shouldTrigger = opts?.triggerSync !== false;
  const onPhase = opts?.onPhase;

  const emit = (phase: SyncRefreshPhase, status: EmailSyncStatus | null) => {
    onPhase?.(phase, status);
  };

  if (signal?.aborted) {
    emit('cancelled', null);
    return { status: null, phase: 'cancelled', cancelled: true, triggered: false };
  }

  emit('connecting', null);

  let triggered = false;

  const fetchOnce = async (): Promise<EmailSyncStatus | null> => {
    return fetchLocalEmailSyncStatus({ signal });
  };

  const requestSync = async (): Promise<TriggerEmailSyncResult> => {
    emit('starting', null);
    return triggerEmailSync({ signal });
  };

  const finishStopped = (status: EmailSyncStatus | null): RefreshEmailSyncResult => {
    emit('stopped', status);
    return { status, phase: 'stopped', cancelled: false, triggered };
  };

  const finishDone = (status: EmailSyncStatus | null): RefreshEmailSyncResult => {
    emit('done', status);
    return { status, phase: 'done', cancelled: false, triggered };
  };

  try {
    // Snapshot before trigger so we can tell a NEW run from a stale "running" file.
    let baseline = await fetchOnce();
    const baselineRunAt = baseline?.lastRunAt ?? null;

    if (shouldTrigger) {
      const trig = await requestSync();
      if (signal?.aborted) {
        emit('cancelled', null);
        return { status: null, phase: 'cancelled', cancelled: true, triggered: false };
      }
      if (trig.unavailable) {
        emit('checking', null);
        const leftover = await fetchOnce().catch(() => null);
        if (leftover) return finishDone(leftover);
        emit('error', null);
        return { status: null, phase: 'error', cancelled: false, triggered: false };
      }
      if (!trig.ok) {
        // Helper answered but could not queue — coworker-safe stop, not an infinite spinner.
        const leftover = await fetchOnce().catch(() => null);
        return finishStopped(leftover);
      }
      triggered = true;
    }

    emit('checking', null);
    let status = await fetchOnce();
    if (signal?.aborted) {
      emit('cancelled', status);
      return { status, phase: 'cancelled', cancelled: true, triggered };
    }

    if (triggered) {
      // Wait until lastRunAt advances (new sync wrote status) or we time out.
      const startDeadline = Date.now() + startTimeoutMs;
      while (!isNewRun(status, baselineRunAt) && Date.now() < startDeadline) {
        if (status && isTerminalOutcome(status.outcome) && status.lastRunAt !== baselineRunAt) {
          break;
        }
        await sleep(pollMs, signal);
        if (signal?.aborted) {
          emit('cancelled', status);
          return { status, phase: 'cancelled', cancelled: true, triggered };
        }
        status = await fetchOnce();
      }

      if (!isNewRun(status, baselineRunAt)) {
        // Sync never started (supervisor stuck, Outlook missing, elevation, etc.).
        return finishStopped(status);
      }
    } else if (status?.outcome === 'running') {
      // Mount / re-read only: do not hang forever on a stale running report.
      const staleDeadline = Date.now() + staleRunningMs;
      while (status?.outcome === 'running' && Date.now() < staleDeadline) {
        emit('running', status);
        await sleep(pollMs, signal);
        if (signal?.aborted) {
          emit('cancelled', status);
          return { status, phase: 'cancelled', cancelled: true, triggered };
        }
        status = await fetchOnce();
      }
      if (status?.outcome === 'running') {
        return finishDone(status);
      }
    }

    // Active run: wait until outcome leaves running, with a hard timeout.
    if (status?.outcome === 'running') {
      const runDeadline = Date.now() + runningTimeoutMs;
      let retried = false;
      while (status?.outcome === 'running') {
        emit('running', status);
        if (Date.now() >= runDeadline) {
          return finishStopped(status);
        }
        await sleep(pollMs, signal);
        if (signal?.aborted) {
          emit('cancelled', status);
          return { status, phase: 'cancelled', cancelled: true, triggered };
        }
        status = await fetchOnce();
        if (signal?.aborted) {
          emit('cancelled', status);
          return { status, phase: 'cancelled', cancelled: true, triggered };
        }

        if (
          shouldTrigger &&
          !retried &&
          status &&
          (status.outcome === 'fail' || status.outcome === 'connection-lost')
        ) {
          retried = true;
          baseline = status;
          emit('starting', status);
          await requestSync();
          status = await fetchOnce();
          continue;
        }

        if (triggered && !status && !retried) {
          retried = true;
          emit('starting', null);
          await requestSync();
          status = await fetchOnce();
          if (!status) return finishStopped(null);
          continue;
        }
      }
    }

    if (!status && triggered) return finishStopped(null);

    if (status?.outcome === 'fail' || status?.outcome === 'connection-lost') {
      return finishStopped(status);
    }

    return finishDone(status);
  } catch (err) {
    if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
      emit('cancelled', null);
      return { status: null, phase: 'cancelled', cancelled: true, triggered };
    }
    emit('error', null);
    return { status: null, phase: 'error', cancelled: false, triggered };
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
