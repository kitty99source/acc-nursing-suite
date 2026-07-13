/**
 * Pure geometry helpers for the walking-companion easter egg. No DOM, no React,
 * no timers — everything here is deterministic and unit-tested. The component
 * (`Companion.tsx`) feeds these live `getBoundingClientRect()` values and drives
 * a single rAF loop with the results.
 *
 * A "walkable segment" is the top edge of a laid-out box, in viewport
 * coordinates: a horizontal line from x1..x2 at height y.
 */

export interface Segment {
  x1: number;
  x2: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Minimal rect shape (compatible with DOMRect). */
export interface RectLike {
  left: number;
  right: number;
  top: number;
}

export function segmentWidth(seg: Segment): number {
  return seg.x2 - seg.x1;
}

export function sameSegment(a: Segment, b: Segment, epsilon = 0.5): boolean {
  return (
    Math.abs(a.x1 - b.x1) <= epsilon &&
    Math.abs(a.x2 - b.x2) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon
  );
}

/** Turn a rect into its (inset-trimmed) top-edge segment, or null if too thin. */
export function rectToTopEdge(rect: RectLike, inset = 6): Segment | null {
  const x1 = rect.left + inset;
  const x2 = rect.right - inset;
  if (x2 - x1 <= 0) return null;
  return { x1, x2, y: rect.top };
}

/** Drop segments narrower than `minWidth` (not worth walking on). */
export function pruneSegments(segments: Segment[], minWidth = 24): Segment[] {
  return segments.filter((s) => segmentWidth(s) >= minWidth);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Euclidean distance from a point to the closest spot on a segment. */
export function distanceToSegment(seg: Segment, p: Point): number {
  const cx = clamp(p.x, seg.x1, seg.x2);
  return Math.hypot(p.x - cx, p.y - seg.y);
}

/** The nearest segment to a point (e.g. to re-snap after a layout change). */
export function nearestSegment(segments: Segment[], p: Point): Segment | null {
  let best: Segment | null = null;
  let bestD = Infinity;
  for (const s of segments) {
    const d = distanceToSegment(s, p);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export type Direction = 1 | -1;

export interface StepResult {
  x: number;
  atEnd: boolean;
}

/** Advance x along a segment by `dist` in `dir`, clamped to the segment ends. */
export function stepAlong(x: number, seg: Segment, dir: Direction, dist: number): StepResult {
  const nx = x + dir * dist;
  if (dir >= 0) {
    if (nx >= seg.x2) return { x: seg.x2, atEnd: true };
    return { x: nx, atEnd: false };
  }
  if (nx <= seg.x1) return { x: seg.x1, atEnd: true };
  return { x: nx, atEnd: false };
}

export interface NextChoice {
  seg: Segment;
  dir: Direction;
}

/**
 * Choose the next segment to walk after reaching `endPoint`. Prefers a segment
 * *other* than the current one whose nearest end is closest to where we
 * finished, and returns the direction that walks away from that entry end. Falls
 * back to the current segment (turn around) when it's the only option.
 */
export function pickNextSegment(
  segments: Segment[],
  current: Segment | null,
  endPoint: Point,
): NextChoice | null {
  if (segments.length === 0) return null;
  const others = current ? segments.filter((s) => !sameSegment(s, current)) : segments;
  const pool = others.length > 0 ? others : segments;

  let best: Segment | null = null;
  let bestD = Infinity;
  let bestDir: Direction = 1;
  for (const s of pool) {
    const dStart = Math.hypot(endPoint.x - s.x1, endPoint.y - s.y);
    const dEnd = Math.hypot(endPoint.x - s.x2, endPoint.y - s.y);
    // Enter at the closer end and walk toward the far end.
    if (dStart < bestD) {
      bestD = dStart;
      best = s;
      bestDir = 1;
    }
    if (dEnd < bestD) {
      bestD = dEnd;
      best = s;
      bestDir = -1;
    }
  }
  return best ? { seg: best, dir: bestDir } : null;
}
