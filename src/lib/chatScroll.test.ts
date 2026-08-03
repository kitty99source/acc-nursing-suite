import { describe, expect, it } from 'vitest';
import { shouldAutoScroll } from './chatScroll';

describe('shouldAutoScroll (sticky-scroll helper for AiChatPanel)', () => {
  it('is true when scrolled all the way to the bottom', () => {
    expect(shouldAutoScroll(920, 1000, 80)).toBe(true);
  });

  it('is true when within the default threshold of the bottom', () => {
    // distance from bottom = 1000 - 900 - 80 = 20, well under the 80px default threshold
    expect(shouldAutoScroll(900, 1000, 80)).toBe(true);
  });

  it('is false once scrolled meaningfully far from the bottom', () => {
    // distance from bottom = 1000 - 200 - 80 = 720
    expect(shouldAutoScroll(200, 1000, 80)).toBe(false);
  });

  it('respects a custom threshold', () => {
    // distance from bottom = 1000 - 850 - 80 = 70
    expect(shouldAutoScroll(850, 1000, 80, 50)).toBe(false);
    expect(shouldAutoScroll(850, 1000, 80, 100)).toBe(true);
  });

  it('is true for a short conversation that does not overflow the container at all', () => {
    // scrollHeight <= clientHeight — nothing to scroll, always "at the bottom".
    expect(shouldAutoScroll(0, 400, 500)).toBe(true);
  });
});
