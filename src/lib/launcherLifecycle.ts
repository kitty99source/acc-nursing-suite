// ============================================================================
// Browser-tab lifecycle for the local launcher (launch.ps1).
//
// When the suite is served by launch.ps1, closing the last app tab should also
// stop the Hidden PowerShell app server + folder-watch (quiet mode has no
// console window to close by hand).
//
// - Each tab gets a sessionStorage clientId (multi-tab: only the last goodbye /
//   stale heartbeat shuts the server down).
// - Heartbeat every ~15s; server drops clients after ~60s without a ping.
// - pagehide sendsBeacon (or fetch keepalive) to /_acc/goodbye.
// No-ops harmlessly when /_acc/* is unavailable (npm run dev, file://, etc.).
// ============================================================================

export const LAUNCHER_HEARTBEAT_URL = '/_acc/heartbeat';
export const LAUNCHER_GOODBYE_URL = '/_acc/goodbye';
export const LAUNCHER_CLIENT_ID_KEY = 'acc-adminsuite-launcher-client-id';

/** Default heartbeat interval (server stale timeout is ~60s). */
export const LAUNCHER_HEARTBEAT_INTERVAL_MS = 15_000;

export function buildLauncherClientUrl(base: string, clientId: string): string {
  const id = clientId.trim();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}clientId=${encodeURIComponent(id)}`;
}

export function getOrCreateLauncherClientId(
  storage: Pick<Storage, 'getItem' | 'setItem'> | null | undefined = typeof sessionStorage !== 'undefined'
    ? sessionStorage
    : null,
): string {
  if (!storage) {
    return `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }
  try {
    const existing = storage.getItem(LAUNCHER_CLIENT_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    storage.setItem(LAUNCHER_CLIENT_ID_KEY, id);
    return id;
  } catch {
    return `tab_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }
}

export async function postLauncherHeartbeat(clientId: string): Promise<boolean> {
  const id = clientId.trim();
  if (!id) return false;
  try {
    const res = await fetch(buildLauncherClientUrl(LAUNCHER_HEARTBEAT_URL, id), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ clientId: id }),
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort "this tab is leaving" signal. Prefer sendBeacon; also fire a
 * keepalive fetch. Safe to call more than once.
 */
export function signalLauncherGoodbye(clientId: string): void {
  const id = clientId.trim();
  if (!id) return;
  const url = buildLauncherClientUrl(LAUNCHER_GOODBYE_URL, id);
  const body = JSON.stringify({ clientId: id });
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    }
  } catch {
    /* ignore */
  }
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
      keepalive: true,
      cache: 'no-store',
    });
  } catch {
    /* ignore */
  }
}

export interface LauncherLifecycleHandle {
  clientId: string;
  stop: () => void;
}

/**
 * Start heartbeats + unload goodbye for this tab. Call once from App mount.
 * Returns a stop() that clears the interval and listeners (does not goodbye).
 */
export function startLauncherSessionLifecycle(options?: {
  intervalMs?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}): LauncherLifecycleHandle {
  const clientId = getOrCreateLauncherClientId(options?.storage);
  const intervalMs = options?.intervalMs ?? LAUNCHER_HEARTBEAT_INTERVAL_MS;

  void postLauncherHeartbeat(clientId);
  const timer = window.setInterval(() => {
    void postLauncherHeartbeat(clientId);
  }, intervalMs);

  const onPageHide = (e: PageTransitionEvent) => {
    // bfcache: page may come back - don't kill the server.
    if (e.persisted) return;
    signalLauncherGoodbye(clientId);
  };
  // Do NOT goodbye on beforeunload: a canceled "unsaved changes" dialog would
  // still fire beforeunload and orphan the user with a dead local server.
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) void postLauncherHeartbeat(clientId);
  };

  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);

  return {
    clientId,
    stop: () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    },
  };
}
