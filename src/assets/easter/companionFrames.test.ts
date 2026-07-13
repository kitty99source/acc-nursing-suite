import { describe, it, expect } from 'vitest';
import {
  COMPANION_FRAMES,
  COMPANION_FRAME_URLS,
  framesFor,
  frameDurationMs,
} from './companionFrames';
import type { CompanionCharacter } from '../../types';

const CHARACTERS: CompanionCharacter[] = ['cat', 'panda', 'fox'];

describe('companion frame catalogue', () => {
  it('provides multi-frame walk + sleep cycles for every character', () => {
    for (const c of CHARACTERS) {
      const set = COMPANION_FRAMES[c];
      expect(set.walk.length).toBe(4);
      expect(set.walkCalm.length).toBe(4);
      expect(set.idle.length).toBeGreaterThanOrEqual(2);
      expect(set.sleep.length).toBeGreaterThanOrEqual(2);
      expect(set.annoyed.length).toBeGreaterThanOrEqual(2);
      // Real multi-frame animation: the walk frames must actually differ.
      expect(new Set(set.walk).size).toBeGreaterThan(1);
    }
  });

  it('renders valid inline SVG (no binary assets, offline-safe)', () => {
    for (const c of CHARACTERS) {
      for (const svg of COMPANION_FRAMES[c].walk) {
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).toContain("viewBox='0 0 32 32'");
      }
    }
  });

  it('exposes encoded data-URLs ready for an <img src>', () => {
    for (const c of CHARACTERS) {
      for (const url of COMPANION_FRAME_URLS[c].sleep) {
        expect(url.startsWith('data:image/svg+xml,')).toBe(true);
      }
    }
  });

  it('framesFor swaps to the calmer walk under reduced motion', () => {
    const normal = framesFor('cat', 'walk', false);
    const calm = framesFor('cat', 'walk', true);
    expect(normal).toEqual(COMPANION_FRAME_URLS.cat.walk);
    expect(calm).toEqual(COMPANION_FRAME_URLS.cat.walkCalm);
    expect(normal).not.toEqual(calm);
  });

  it('slows the walk cadence under reduced motion', () => {
    expect(frameDurationMs('walk', true)).toBeGreaterThan(frameDurationMs('walk', false));
    expect(frameDurationMs('sleep', false)).toBeGreaterThan(0);
  });
});
