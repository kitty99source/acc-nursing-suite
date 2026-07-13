import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatElapsedMs,
  LOCAL_EMAIL_SYNC_TRIGGER_URL,
  refreshEmailSyncStatus,
  syncRefreshStatusText,
  triggerEmailSync,
} from './emailSyncRefresh';
import { LOCAL_EMAIL_SYNC_STATUS_URL } from './emailSyncStatus';

function statusBody(partial: {
  outcome: string;
  lastRunAt: string;
  savedCount?: number;
  errors?: string[];
}) {
  return JSON.stringify({
    version: 1,
    lastRunAt: partial.lastRunAt,
    outcome: partial.outcome,
    savedCount: partial.savedCount ?? 0,
    skippedCount: 0,
    errorCount: partial.errors?.length ?? 0,
    savedFiles: [],
    errors: partial.errors ?? [],
    inboxPath: '',
    sharedMailbox: '',
  });
}

describe('emailSyncRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('formats elapsed time as seconds then m:ss', () => {
    expect(formatElapsedMs(0)).toBe('0s');
    expect(formatElapsedMs(4_200)).toBe('4s');
    expect(formatElapsedMs(65_000)).toBe('1:05');
  });

  it('maps phases to plain coworker copy (no script jargon)', () => {
    expect(syncRefreshStatusText('connecting')).toMatch(/local helper/i);
    expect(syncRefreshStatusText('starting')).toMatch(/check mail/i);
    expect(syncRefreshStatusText('checking')).toMatch(/Checking mail/i);
    expect(
      syncRefreshStatusText('running', {
        version: 1,
        lastRunAt: '2026-07-08T10:00:00.000Z',
        outcome: 'running',
        mode: 'backlog',
        savedCount: 3,
        skippedCount: 0,
        errorCount: 0,
        savedFiles: [],
        errors: [],
        inboxPath: '',
        sharedMailbox: '',
      }),
    ).toMatch(/Outlook/i);
    expect(syncRefreshStatusText('stopped')).toMatch(/retry/i);
    expect(syncRefreshStatusText('connecting')).not.toMatch(/launch\.ps1/i);
    expect(syncRefreshStatusText('error')).not.toMatch(/launch\.ps1/i);
  });

  it('POSTs /_acc/email-sync then polls while a NEW run is running', async () => {
    let statusCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          expect(init?.method).toBe('POST');
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, queued: true }),
          } as unknown as Response;
        }
        if (String(url) !== LOCAL_EMAIL_SYNC_STATUS_URL) {
          return { ok: false, status: 404, text: async () => '' } as unknown as Response;
        }
        statusCalls += 1;
        // Call 1 = baseline before trigger (old ok). Then new run starts.
        if (statusCalls === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              statusBody({ outcome: 'ok', lastRunAt: '2026-07-08T09:00:00.000Z' }),
          } as unknown as Response;
        }
        if (statusCalls < 4) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              statusBody({
                outcome: 'running',
                lastRunAt: '2026-07-08T10:00:00.000Z',
                savedCount: statusCalls,
              }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            statusBody({
              outcome: 'ok',
              lastRunAt: '2026-07-08T10:00:00.000Z',
              savedCount: 3,
            }),
        } as unknown as Response;
      }),
    );

    const phases: string[] = [];
    const promise = refreshEmailSyncStatus({
      pollIntervalMs: 100,
      onPhase: (p) => phases.push(p),
    });
    await vi.advanceTimersByTimeAsync(800);
    const result = await promise;
    expect(result.cancelled).toBe(false);
    expect(result.triggered).toBe(true);
    expect(result.status?.outcome).toBe('ok');
    expect(phases).toContain('connecting');
    expect(phases).toContain('starting');
    expect(phases).toContain('running');
    expect(phases).toContain('done');
  });

  it('stops with Retry when sync never advances lastRunAt after trigger', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, queued: true }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            statusBody({ outcome: 'ok', lastRunAt: '2026-07-08T09:00:00.000Z' }),
        } as unknown as Response;
      }),
    );

    const promise = refreshEmailSyncStatus({
      pollIntervalMs: 100,
      startTimeoutMs: 350,
    });
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;
    expect(result.phase).toBe('stopped');
    expect(result.triggered).toBe(true);
    expect(result.status?.outcome).toBe('ok');
  });

  it('does not hang forever on stale running when only re-reading', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          throw new Error('should not trigger');
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            statusBody({ outcome: 'running', lastRunAt: '2026-07-08T09:00:00.000Z' }),
        } as unknown as Response;
      }),
    );

    const promise = refreshEmailSyncStatus({
      triggerSync: false,
      pollIntervalMs: 50,
      staleRunningMs: 200,
    });
    await vi.advanceTimersByTimeAsync(400);
    const result = await promise;
    expect(result.phase).toBe('done');
    expect(result.triggered).toBe(false);
    expect(result.status?.outcome).toBe('running');
  });

  it('soft-cancels mid-poll without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, queued: true }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          text: async () =>
            statusBody({
              outcome: 'running',
              lastRunAt: '2026-07-08T10:00:00.000Z',
            }),
        } as unknown as Response;
      }),
    );

    const ctrl = new AbortController();
    const promise = refreshEmailSyncStatus({
      signal: ctrl.signal,
      pollIntervalMs: 5_000,
      startTimeoutMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(50);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(50);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.phase).toBe('cancelled');
  });

  it('triggerEmailSync reports unavailable on 404', async () => {
    vi.useRealTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response),
    );
    const result = await triggerEmailSync();
    expect(result.unavailable).toBe(true);
    expect(result.ok).toBe(false);
  });
});
