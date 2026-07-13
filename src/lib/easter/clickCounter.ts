/**
 * Pure, dependency-free helper for detecting an "N clicks within a window"
 * gesture (used by the NS-brand-mark triple-click disco trigger). Kept pure so
 * it is trivially unit-testable without timers or DOM.
 */

export interface ClickBurstState {
  /** Timestamps (ms) of the clicks currently inside the rolling window. */
  timestamps: number[];
}

export interface ClickBurstConfig {
  /** Number of clicks required to fire (e.g. 3 for triple-click). */
  threshold: number;
  /** Rolling window in ms within which the clicks must occur. */
  windowMs: number;
}

export function emptyClickBurst(): ClickBurstState {
  return { timestamps: [] };
}

export interface ClickBurstResult {
  /** Next state to carry forward. */
  state: ClickBurstState;
  /** True on the click that completes the burst. Resets the window when true. */
  triggered: boolean;
}

/**
 * Register a click at time `now`. Drops timestamps older than the window, then
 * checks whether the threshold has been reached. When it fires, the window is
 * cleared so the *next* burst must be a fresh set of clicks (no rolling
 * double-fire from a 4th click).
 */
export function registerClick(
  state: ClickBurstState,
  now: number,
  config: ClickBurstConfig,
): ClickBurstResult {
  const { threshold, windowMs } = config;
  const cutoff = now - windowMs;
  const recent = state.timestamps.filter((t) => t > cutoff);
  recent.push(now);
  if (recent.length >= threshold) {
    return { state: emptyClickBurst(), triggered: true };
  }
  return { state: { timestamps: recent }, triggered: false };
}
