import { describe, it, expect } from 'vitest';
import {
  resolveCompanionState,
  isMoving,
  frameIndexFor,
  type CompanionTimers,
} from './companionBehavior';

const base: CompanionTimers = {
  now: 1000,
  idleUntil: 0,
  idleStartedAt: 0,
  annoyedUntil: 0,
  sleepOnsetMs: 2500,
};

describe('resolveCompanionState', () => {
  it('walks when not resting or annoyed', () => {
    expect(resolveCompanionState(base)).toBe('walk');
    expect(isMoving(base)).toBe(true);
  });

  it('idles during a short rest before the sleep onset', () => {
    const t: CompanionTimers = { ...base, now: 1000, idleStartedAt: 800, idleUntil: 3000 };
    expect(resolveCompanionState(t)).toBe('idle');
    expect(isMoving(t)).toBe(false);
  });

  it('falls asleep once a rest outlasts the sleep onset', () => {
    const t: CompanionTimers = { ...base, now: 4000, idleStartedAt: 1000, idleUntil: 9000 };
    expect(resolveCompanionState(t)).toBe('sleep');
  });

  it('annoyed reaction beats sleeping and resting', () => {
    const t: CompanionTimers = {
      ...base,
      now: 4000,
      idleStartedAt: 1000,
      idleUntil: 9000,
      annoyedUntil: 5000,
    };
    expect(resolveCompanionState(t)).toBe('annoyed');
  });

  it('resumes walking after the rest window ends', () => {
    const t: CompanionTimers = { ...base, now: 3001, idleStartedAt: 500, idleUntil: 3000 };
    expect(resolveCompanionState(t)).toBe('walk');
  });
});

describe('frameIndexFor', () => {
  it('returns 0 for single-frame or degenerate states', () => {
    expect(frameIndexFor(9999, 1, 100)).toBe(0);
    expect(frameIndexFor(9999, 4, 0)).toBe(0);
  });

  it('cycles through frames over time', () => {
    expect(frameIndexFor(0, 4, 100)).toBe(0);
    expect(frameIndexFor(150, 4, 100)).toBe(1);
    expect(frameIndexFor(250, 4, 100)).toBe(2);
    expect(frameIndexFor(350, 4, 100)).toBe(3);
    expect(frameIndexFor(450, 4, 100)).toBe(0);
  });
});
