import { describe, it, expect } from 'vitest';
import {
  rectToTopEdge,
  pruneSegments,
  segmentWidth,
  sameSegment,
  distanceToSegment,
  nearestSegment,
  stepAlong,
  pickNextSegment,
  type Segment,
} from './pathing';

describe('rectToTopEdge', () => {
  it('produces an inset top edge', () => {
    const seg = rectToTopEdge({ left: 0, right: 100, top: 40 }, 6);
    expect(seg).toEqual({ x1: 6, x2: 94, y: 40 });
  });
  it('returns null when the rect is too thin for the inset', () => {
    expect(rectToTopEdge({ left: 0, right: 10, top: 0 }, 6)).toBeNull();
  });
});

describe('pruneSegments', () => {
  it('drops narrow segments', () => {
    const segs: Segment[] = [
      { x1: 0, x2: 10, y: 0 },
      { x1: 0, x2: 100, y: 0 },
    ];
    expect(pruneSegments(segs, 24)).toEqual([{ x1: 0, x2: 100, y: 0 }]);
  });
});

describe('segmentWidth / sameSegment', () => {
  it('measures width', () => {
    expect(segmentWidth({ x1: 10, x2: 40, y: 0 })).toBe(30);
  });
  it('compares within epsilon', () => {
    expect(sameSegment({ x1: 0, x2: 10, y: 0 }, { x1: 0.2, x2: 10.1, y: 0 }, 0.5)).toBe(true);
    expect(sameSegment({ x1: 0, x2: 10, y: 0 }, { x1: 5, x2: 10, y: 0 })).toBe(false);
  });
});

describe('distanceToSegment / nearestSegment', () => {
  const segs: Segment[] = [
    { x1: 0, x2: 100, y: 0 },
    { x1: 0, x2: 100, y: 200 },
  ];
  it('clamps horizontally then measures', () => {
    expect(distanceToSegment({ x1: 0, x2: 100, y: 0 }, { x: 50, y: 10 })).toBe(10);
    expect(distanceToSegment({ x1: 0, x2: 100, y: 0 }, { x: 150, y: 0 })).toBe(50);
  });
  it('finds the nearest', () => {
    expect(nearestSegment(segs, { x: 50, y: 20 })).toBe(segs[0]);
    expect(nearestSegment(segs, { x: 50, y: 180 })).toBe(segs[1]);
  });
  it('returns null for empty', () => {
    expect(nearestSegment([], { x: 0, y: 0 })).toBeNull();
  });
});

describe('stepAlong', () => {
  const seg: Segment = { x1: 0, x2: 100, y: 0 };
  it('moves forward without reaching the end', () => {
    expect(stepAlong(10, seg, 1, 5)).toEqual({ x: 15, atEnd: false });
  });
  it('clamps and flags the end going forward', () => {
    expect(stepAlong(98, seg, 1, 5)).toEqual({ x: 100, atEnd: true });
  });
  it('clamps and flags the end going backward', () => {
    expect(stepAlong(2, seg, -1, 5)).toEqual({ x: 0, atEnd: true });
  });
});

describe('pickNextSegment', () => {
  const a: Segment = { x1: 0, x2: 100, y: 0 };
  const b: Segment = { x1: 110, x2: 200, y: 0 };
  it('picks a different nearby segment and enters from the closest end', () => {
    // finished at right end of `a` (x=100). `b` starts at x=110 → enter start, go +1.
    const choice = pickNextSegment([a, b], a, { x: 100, y: 0 });
    expect(choice?.seg).toBe(b);
    expect(choice?.dir).toBe(1);
  });
  it('turns around on the same segment when it is the only one', () => {
    const choice = pickNextSegment([a], a, { x: 100, y: 0 });
    expect(choice?.seg).toBe(a);
    expect(choice?.dir).toBe(-1); // entered from the far (right) end → walk back
  });
  it('returns null with no segments', () => {
    expect(pickNextSegment([], null, { x: 0, y: 0 })).toBeNull();
  });
});
