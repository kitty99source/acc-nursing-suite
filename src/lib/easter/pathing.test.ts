import { describe, it, expect } from 'vitest';
import {
  KIND_WEIGHT,
  rectToTopEdge,
  rectToBottomEdge,
  horizontalEdge,
  verticalEdge,
  clampWalkY,
  defaultTopBarSegment,
  pruneSegments,
  dedupeSegments,
  segmentWidth,
  segmentLength,
  isHorizontal,
  sameSegment,
  pointAt,
  segEnd,
  distanceToSegment,
  nearestSegment,
  nearestParamOn,
  stepAlong,
  rankNextSegments,
  pickNextSegment,
  chooseNextSegment,
  hopArc,
  type Segment,
  type Viewport,
} from './pathing';

const VP: Viewport = { width: 1280, height: 800 };
const SPRITE = 30;

function h(x1: number, x2: number, y: number, weight = 1): Segment {
  return { x1, y1: y, x2, y2: y, weight, kind: 'card' };
}

describe('horizontalEdge / rectToTopEdge / rectToBottomEdge', () => {
  it('produces an inset, clamped top edge', () => {
    const seg = rectToTopEdge({ left: 0, right: 200, top: 120, bottom: 160 }, 'card', VP, SPRITE, 8);
    expect(seg).toEqual({ x1: 8, y1: 120, x2: 192, y2: 120, weight: KIND_WEIGHT.card, kind: 'card' });
  });
  it('uses the bottom edge for chrome at the top of the viewport', () => {
    const seg = rectToBottomEdge({ left: 0, right: 400, top: 0, bottom: 48 }, 'topbar', VP, SPRITE, 8);
    expect(seg).toEqual({ x1: 8, y1: 48, x2: 392, y2: 48, weight: KIND_WEIGHT.topbar, kind: 'topbar' });
  });
  it('clamps a too-wide edge inside the viewport width', () => {
    const seg = horizontalEdge(-100, 5000, 100, 'card', VP, SPRITE, 8);
    expect(seg?.x1).toBe(8);
    expect(seg?.x2).toBe(VP.width - 8);
  });
  it('returns null when the remaining span is too thin', () => {
    expect(horizontalEdge(0, 10, 100, 'card', VP, SPRITE, 8)).toBeNull();
  });
});

describe('verticalEdge', () => {
  it('produces a clamped vertical side segment', () => {
    const seg = verticalEdge(256, 60, 700, 'sidebar-side', VP, SPRITE, 8);
    expect(seg).toEqual({
      x1: 256,
      y1: 68,
      x2: 256,
      y2: 692,
      weight: KIND_WEIGHT['sidebar-side'],
      kind: 'sidebar-side',
    });
    expect(isHorizontal(seg!)).toBe(false);
  });
  it('returns null when too short', () => {
    expect(verticalEdge(100, 100, 105, 'sidebar-side', VP, SPRITE, 8)).toBeNull();
  });
});

describe('clampWalkY / defaultTopBarSegment', () => {
  it('keeps the sprite fully on-screen', () => {
    expect(clampWalkY(0, 30, 800)).toBe(30);
    expect(clampWalkY(900, 30, 800)).toBe(796);
  });
  it('builds a full-width fallback ledge', () => {
    expect(defaultTopBarSegment(VP, 30, 8, 48)).toEqual({
      x1: 8,
      y1: 48,
      x2: 1272,
      y2: 48,
      weight: KIND_WEIGHT.fallback,
      kind: 'fallback',
    });
  });
});

describe('segmentWidth / segmentLength / isHorizontal', () => {
  it('measures horizontal width and length', () => {
    const seg = h(10, 40, 0);
    expect(segmentWidth(seg)).toBe(30);
    expect(segmentLength(seg)).toBe(30);
    expect(isHorizontal(seg)).toBe(true);
  });
  it('measures a vertical segment length', () => {
    const seg: Segment = { x1: 5, y1: 10, x2: 5, y2: 60, weight: 1, kind: 'sidebar-side' };
    expect(segmentLength(seg)).toBe(50);
    expect(isHorizontal(seg)).toBe(false);
  });
});

describe('pruneSegments / dedupeSegments', () => {
  it('drops short segments by length', () => {
    const segs = [h(0, 10, 0), h(0, 100, 0)];
    expect(pruneSegments(segs, 24)).toEqual([h(0, 100, 0)]);
  });
  it('removes near-duplicate edges, keeping the higher weight', () => {
    const a = h(0, 100, 40, 0.5);
    const b = h(1, 101, 42, 0.9); // within epsilon of a
    const c = h(0, 100, 400, 0.5);
    const out = dedupeSegments([a, b, c], 6);
    expect(out).toHaveLength(2);
    expect(out[0].weight).toBe(0.9); // upgraded to the higher-weight duplicate
    expect(out).toContain(c);
  });
});

describe('pointAt / segEnd / nearestParamOn', () => {
  const seg = h(0, 100, 50);
  it('interpolates along the segment', () => {
    expect(pointAt(seg, 0)).toEqual({ x: 0, y: 50 });
    expect(pointAt(seg, 0.5)).toEqual({ x: 50, y: 50 });
    expect(pointAt(seg, 1)).toEqual({ x: 100, y: 50 });
  });
  it('clamps t outside [0,1]', () => {
    expect(pointAt(seg, -1)).toEqual({ x: 0, y: 50 });
    expect(pointAt(seg, 2)).toEqual({ x: 100, y: 50 });
  });
  it('returns endpoints', () => {
    expect(segEnd(seg, 0)).toEqual({ x: 0, y: 50 });
    expect(segEnd(seg, 1)).toEqual({ x: 100, y: 50 });
  });
  it('finds the nearest parameter to a point', () => {
    expect(nearestParamOn(seg, { x: 25, y: 90 })).toBeCloseTo(0.25, 5);
    expect(nearestParamOn(seg, { x: -50, y: 50 })).toBe(0);
  });
});

describe('distanceToSegment / nearestSegment', () => {
  const segs = [h(0, 100, 0), h(0, 100, 200)];
  it('measures distance to a horizontal segment', () => {
    expect(distanceToSegment(h(0, 100, 0), { x: 50, y: 10 })).toBe(10);
    expect(distanceToSegment(h(0, 100, 0), { x: 150, y: 0 })).toBe(50);
  });
  it('measures distance to a vertical segment', () => {
    const v: Segment = { x1: 10, y1: 0, x2: 10, y2: 100, weight: 1, kind: 'sidebar-side' };
    expect(distanceToSegment(v, { x: 40, y: 50 })).toBe(30);
    expect(distanceToSegment(v, { x: 10, y: 150 })).toBe(50);
  });
  it('finds the nearest segment', () => {
    expect(nearestSegment(segs, { x: 50, y: 20 })).toBe(segs[0]);
    expect(nearestSegment(segs, { x: 50, y: 180 })).toBe(segs[1]);
  });
  it('returns null for empty', () => {
    expect(nearestSegment([], { x: 0, y: 0 })).toBeNull();
  });
});

describe('stepAlong', () => {
  const seg = h(0, 100, 0); // length 100
  it('advances by param without reaching the end', () => {
    const res = stepAlong(0.1, seg, 1, 20);
    expect(res.atEnd).toBe(false);
    expect(res.t).toBeCloseTo(0.3, 10);
  });
  it('clamps and flags the end going forward', () => {
    expect(stepAlong(0.95, seg, 1, 20)).toEqual({ t: 1, atEnd: true });
  });
  it('clamps and flags the end going backward', () => {
    expect(stepAlong(0.05, seg, -1, 20)).toEqual({ t: 0, atEnd: true });
  });
  it('handles a zero-length segment gracefully', () => {
    const z = h(50, 50, 0);
    expect(stepAlong(0.5, z, 1, 10)).toEqual({ t: 1, atEnd: true });
  });
});

describe('rankNextSegments / pickNextSegment', () => {
  const a = h(0, 100, 0, 1);
  const b = h(110, 200, 0, 1);
  it('prefers a nearby, high-weight segment and enters from the closest end', () => {
    // finished at right end of `a` (x=100); `b` starts at x=110 → enter start, +1.
    const choice = pickNextSegment([a, b], a, { x: 100, y: 0 });
    expect(choice?.seg).toBe(b);
    expect(choice?.enterT).toBe(0);
    expect(choice?.dir).toBe(1);
  });
  it('weights preference: a slightly farther but much heavier edge can win', () => {
    const near = h(120, 220, 0, 0.3); // 20px away, low weight
    const far = h(160, 300, 0, 1); // 60px away, high weight
    const ranked = rankNextSegments([near, far], null, { x: 100, y: 0 });
    expect(ranked[0].seg).toBe(far);
  });
  it('turns around on the same segment when it is the only one', () => {
    const choice = pickNextSegment([a], a, { x: 100, y: 0 });
    expect(choice?.seg).toBe(a);
    expect(choice?.dir).toBe(-1);
  });
  it('returns null with no segments', () => {
    expect(pickNextSegment([], null, { x: 0, y: 0 })).toBeNull();
  });
});

describe('chooseNextSegment', () => {
  const a = h(0, 100, 0, 1);
  const b = h(110, 200, 0, 1);
  const c = h(210, 320, 0, 1);
  it('is deterministic given an injected rng (picks the top candidate at r≈0)', () => {
    const choice = chooseNextSegment([a, b, c], a, { x: 100, y: 0 }, () => 0);
    expect(choice?.seg).toBe(b); // nearest → highest score → first bucket
  });
  it('can select a lower-ranked candidate when rng points high', () => {
    const choice = chooseNextSegment([a, b, c], a, { x: 100, y: 0 }, () => 0.999);
    expect(choice?.seg).toBe(c);
  });
  it('returns null with no segments', () => {
    expect(chooseNextSegment([], null, { x: 0, y: 0 }, () => 0)).toBeNull();
  });
});

describe('hopArc', () => {
  const from = { x: 0, y: 100 };
  const to = { x: 100, y: 100 };
  it('starts and ends at the endpoints', () => {
    expect(hopArc(from, to, 0, 40)).toEqual({ x: 0, y: 100 });
    expect(hopArc(from, to, 1, 40)).toEqual({ x: 100, y: 100 });
  });
  it('lifts upward at the apex', () => {
    const mid = hopArc(from, to, 0.5, 40);
    expect(mid.x).toBe(50);
    expect(mid.y).toBe(60); // 100 - (4 * 40 * 0.25)
  });
  it('clamps t outside [0,1]', () => {
    expect(hopArc(from, to, 2, 40)).toEqual({ x: 100, y: 100 });
  });
});

describe('sameSegment', () => {
  it('compares all four coordinates within epsilon', () => {
    expect(sameSegment(h(0, 10, 0), h(0.2, 10.1, 0.3), 1)).toBe(true);
    expect(sameSegment(h(0, 10, 0), h(5, 10, 0), 1)).toBe(false);
  });
});
