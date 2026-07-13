import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  LAUNCHER_CLIENT_ID_KEY,
  LAUNCHER_GOODBYE_URL,
  LAUNCHER_HEARTBEAT_URL,
  buildLauncherClientUrl,
  getOrCreateLauncherClientId,
  postLauncherHeartbeat,
  signalLauncherGoodbye,
} from './launcherLifecycle';

describe('launcherLifecycle helpers', () => {
  it('buildLauncherClientUrl encodes clientId', () => {
    expect(buildLauncherClientUrl(LAUNCHER_HEARTBEAT_URL, 'abc 1')).toBe(
      '/_acc/heartbeat?clientId=abc%201',
    );
    expect(buildLauncherClientUrl(`${LAUNCHER_GOODBYE_URL}?x=1`, 'id')).toBe(
      '/_acc/goodbye?x=1&clientId=id',
    );
  });

  it('getOrCreateLauncherClientId reuses sessionStorage', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    const a = getOrCreateLauncherClientId(storage);
    const b = getOrCreateLauncherClientId(storage);
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(store.get(LAUNCHER_CLIENT_ID_KEY)).toBe(a);
  });

  it('getOrCreateLauncherClientId returns a fresh id without storage', () => {
    const a = getOrCreateLauncherClientId(null);
    const b = getOrCreateLauncherClientId(null);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('launcherLifecycle network', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('postLauncherHeartbeat POSTs clientId', async () => {
    const ok = await postLauncherHeartbeat('tab-1');
    expect(ok).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/_acc/heartbeat?clientId=tab-1',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clientId: 'tab-1' }),
      }),
    );
  });

  it('signalLauncherGoodbye uses sendBeacon and keepalive fetch', () => {
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('navigator', { sendBeacon });
    signalLauncherGoodbye('tab-2');
    expect(sendBeacon).toHaveBeenCalled();
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe('/_acc/goodbye?clientId=tab-2');
    expect(blob).toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith(
      '/_acc/goodbye?clientId=tab-2',
      expect.objectContaining({ method: 'POST', keepalive: true }),
    );
  });
});
