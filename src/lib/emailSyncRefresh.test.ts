import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatElapsedMs,
  refreshEmailSyncStatus,
  syncRefreshStatusText,
} from './emailSyncRefresh';
import { LOCAL_EMAIL_SYNC_STATUS_URL } from './emailSyncStatus';

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

  it('maps phases to status copy', () => {
    expect(syncRefreshStatusText('connecting')).toMatch(/Connecting/i);
    expect(syncRefreshStatusText('fetching')).toMatch(/Fetching/i);
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
    ).toMatch(/still running/i);
    expect(syncRefreshStatusText('cancelled')).toMatch(/cancelled/i);
  });

  it('polls while outcome is running, then returns the final report', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) !== LOCAL_EMAIL_SYNC_STATUS_URL) {
          return { ok: false, text: async () => '' } as unknown as Response;
        }
        calls += 1;
        const outcome = calls < 3 ? 'running' : 'ok';
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              version: 1,
              lastRunAt: '2026-07-08T10:00:00.000Z',
              outcome,
              savedCount: calls,
              skippedCount: 0,
              errorCount: 0,
              savedFiles: [],
              errors: [],
              inboxPath: '',
              sharedMailbox: '',
            }),
        } as unknown as Response;
      }),
    );

    const phases: string[] = [];
    const promise = refreshEmailSyncStatus({
      pollIntervalMs: 100,
      onPhase: (p) => phases.push(p),
    });
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result.cancelled).toBe(false);
    expect(result.status?.outcome).toBe('ok');
    expect(phases).toContain('connecting');
    expect(phases).toContain('fetching');
    expect(phases).toContain('running');
    expect(phases).toContain('done');
  });

  it('soft-cancels mid-poll without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          JSON.stringify({
            version: 1,
            lastRunAt: '2026-07-08T10:00:00.000Z',
            outcome: 'running',
            savedCount: 0,
            skippedCount: 0,
            errorCount: 0,
            savedFiles: [],
            errors: [],
            inboxPath: '',
            sharedMailbox: '',
          }),
      }) as unknown as Response),
    );

    const ctrl = new AbortController();
    const promise = refreshEmailSyncStatus({
      signal: ctrl.signal,
      pollIntervalMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await vi.advanceTimersByTimeAsync(10);
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.phase).toBe('cancelled');
  });
});
