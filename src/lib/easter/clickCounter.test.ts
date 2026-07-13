import { describe, it, expect } from 'vitest';
import { emptyClickBurst, registerClick } from './clickCounter';

const CFG = { threshold: 3, windowMs: 1500 };

describe('registerClick', () => {
  it('fires on the third click within the window', () => {
    let s = emptyClickBurst();
    let r = registerClick(s, 0, CFG);
    expect(r.triggered).toBe(false);
    s = r.state;
    r = registerClick(s, 500, CFG);
    expect(r.triggered).toBe(false);
    s = r.state;
    r = registerClick(s, 1000, CFG);
    expect(r.triggered).toBe(true);
  });

  it('does not fire when clicks are too slow', () => {
    let s = emptyClickBurst();
    let r = registerClick(s, 0, CFG);
    s = r.state;
    r = registerClick(s, 1600, CFG); // first click aged out
    s = r.state;
    r = registerClick(s, 1700, CFG); // only 2 within window
    expect(r.triggered).toBe(false);
    expect(r.state.timestamps).toHaveLength(2);
  });

  it('resets the window after firing so a 4th click does not re-trigger', () => {
    let s = emptyClickBurst();
    for (const t of [0, 100, 200]) s = registerClick(s, t, CFG).state;
    // after the 3rd click above, state is empty
    const fourth = registerClick(s, 300, CFG);
    expect(fourth.triggered).toBe(false);
    expect(fourth.state.timestamps).toEqual([300]);
  });

  it('supports a fresh burst after a reset', () => {
    let s = emptyClickBurst();
    let triggered = 0;
    for (const t of [0, 200, 400, 600, 800, 1000]) {
      const r = registerClick(s, t, CFG);
      if (r.triggered) triggered += 1;
      s = r.state;
    }
    expect(triggered).toBe(2);
  });

  it('drops stale timestamps beyond the window', () => {
    let s = emptyClickBurst();
    s = registerClick(s, 0, CFG).state;
    s = registerClick(s, 100, CFG).state;
    const r = registerClick(s, 5000, CFG);
    expect(r.triggered).toBe(false);
    expect(r.state.timestamps).toEqual([5000]);
  });
});
