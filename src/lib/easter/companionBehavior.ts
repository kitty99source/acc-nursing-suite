/**
 * Pure behaviour helpers for the walking companion's state machine (walk / idle
 * / sleep / annoyed). Kept free of DOM, React and timers so the transitions are
 * deterministic and unit-testable; `Companion.tsx` feeds it live clock values.
 */

import type { CompanionState } from '../../assets/easter/companionFrames';

export interface CompanionTimers {
  /** Current clock (ms, monotonic e.g. performance.now()). */
  now: number;
  /** Walking is paused (resting) until this time. */
  idleUntil: number;
  /** When the current rest began (used to fall asleep after a while). */
  idleStartedAt: number;
  /** An annoyed reaction is playing until this time (highest priority). */
  annoyedUntil: number;
  /** How long a continuous rest must last before the companion falls asleep. */
  sleepOnsetMs: number;
}

/**
 * Resolve which animation state the companion should be in right now.
 * Priority: annoyed (a reaction always wins) > sleep (long rest) > idle (short
 * rest / looking around) > walk.
 */
export function resolveCompanionState(t: CompanionTimers): CompanionState {
  if (t.now < t.annoyedUntil) return 'annoyed';
  const resting = t.now < t.idleUntil;
  if (resting && t.now - t.idleStartedAt >= t.sleepOnsetMs) return 'sleep';
  if (resting) return 'idle';
  return 'walk';
}

/** Whether the companion is walking (i.e. should advance along a segment). */
export function isMoving(t: CompanionTimers): boolean {
  return resolveCompanionState(t) === 'walk';
}

/**
 * Index into a frame list for a state that started `elapsedMs` ago, cycling
 * every `frameDurationMs`. Guards against empty lists and non-positive
 * durations.
 */
export function frameIndexFor(elapsedMs: number, frameCount: number, frameDurationMs: number): number {
  if (frameCount <= 1) return 0;
  if (frameDurationMs <= 0) return 0;
  const steps = Math.floor(elapsedMs / frameDurationMs);
  return ((steps % frameCount) + frameCount) % frameCount;
}
