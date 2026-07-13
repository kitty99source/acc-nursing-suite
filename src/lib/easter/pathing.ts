/**
 * Pure geometry helpers for the walking-companion easter egg. No DOM, no React,
 * no timers — everything here is deterministic and unit-tested. The component
 * (`Companion.tsx`) feeds these live `getBoundingClientRect()` values and drives
 * a single rAF loop with the results.
 *
 * A "walkable segment" is an axis-aligned edge of a laid-out box, expressed as a
 * line from (x1,y1) to (x2,y2) in viewport coordinates. Horizontal segments
 * (y1 === y2) are card / top-bar / sidebar tops; vertical segments (x1 === x2)
 * are sidebar sides. Every segment carries a `weight` (how strongly the pather
 * prefers it) and a `kind` (for tuning / debugging). The sprite walks along a
 * segment, and when it reaches an end it hops to a nearby segment rather than
 * walking off-screen.
 */

export type SegmentKind =
  | 'topbar'
  | 'sidebar-top'
  | 'sidebar-side'
  | 'card'
  | 'main'
  | 'fallback';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Relative preference for path selection (higher = walked more often). */
  weight: number;
  /** Semantic source of the segment, for tuning + debugging. */
  kind: SegmentKind;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Minimal rect shape (compatible with DOMRect). */
export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type Direction = 1 | -1;

/** Default preference weights per surface kind. Higher = preferred. */
export const KIND_WEIGHT: Record<SegmentKind, number> = {
  topbar: 1,
  card: 0.9,
  'sidebar-top': 0.7,
  main: 0.5,
  'sidebar-side': 0.35, // vertical walks: only occasionally
  fallback: 0.4,
};

export function segmentLength(seg: Segment): number {
  return Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
}

/** Horizontal span (for width-based pruning of near-horizontal ledges). */
export function segmentWidth(seg: Segment): number {
  return Math.abs(seg.x2 - seg.x1);
}

export function isHorizontal(seg: Segment): boolean {
  return Math.abs(seg.y2 - seg.y1) <= Math.abs(seg.x2 - seg.x1);
}

export function sameSegment(a: Segment, b: Segment, epsilon = 1): boolean {
  return (
    Math.abs(a.x1 - b.x1) <= epsilon &&
    Math.abs(a.y1 - b.y1) <= epsilon &&
    Math.abs(a.x2 - b.x2) <= epsilon &&
    Math.abs(a.y2 - b.y2) <= epsilon
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** The point at parameter `t` in [0,1] along a segment (0 = start, 1 = end). */
export function pointAt(seg: Segment, t: number): Point {
  const c = clamp01(t);
  return {
    x: seg.x1 + (seg.x2 - seg.x1) * c,
    y: seg.y1 + (seg.y2 - seg.y1) * c,
  };
}

/** The endpoint of a segment (`which` = 0 for start, 1 for end). */
export function segEnd(seg: Segment, which: 0 | 1): Point {
  return which === 0 ? { x: seg.x1, y: seg.y1 } : { x: seg.x2, y: seg.y2 };
}

/** Ensure a walk y keeps a sprite of `spriteSize` fully inside the viewport. */
export function clampWalkY(y: number, spriteSize: number, viewportHeight: number): number {
  const min = spriteSize;
  const max = Math.max(min, viewportHeight - 4);
  return clamp(y, min, max);
}

/**
 * Build a horizontal walk edge at height `y` from `left`..`right`, trimmed by
 * `inset` on each side, clamped fully inside the viewport. Returns null when the
 * remaining span is too thin to bother walking.
 */
export function horizontalEdge(
  left: number,
  right: number,
  y: number,
  kind: SegmentKind,
  vp: Viewport,
  spriteSize: number,
  inset: number,
): Segment | null {
  const halfMin = inset;
  const x1 = clamp(left + inset, halfMin, vp.width - halfMin);
  const x2 = clamp(right - inset, halfMin, vp.width - halfMin);
  if (x2 - x1 < 1) return null;
  const cy = clampWalkY(y, spriteSize, vp.height);
  return { x1, y1: cy, x2, y2: cy, weight: KIND_WEIGHT[kind], kind };
}

/**
 * Build a vertical walk edge at column `x` from `top`..`bottom`, trimmed by
 * `inset` on each end, clamped inside the viewport. Returns null when too short.
 */
export function verticalEdge(
  x: number,
  top: number,
  bottom: number,
  kind: SegmentKind,
  vp: Viewport,
  spriteSize: number,
  inset: number,
): Segment | null {
  const cx = clamp(x, spriteSize / 2, vp.width - spriteSize / 2);
  const y1 = clampWalkY(top + inset, spriteSize, vp.height);
  const y2 = clampWalkY(bottom - inset, spriteSize, vp.height);
  if (y2 - y1 < 1) return null;
  return { x1: cx, y1, x2: cx, y2, weight: KIND_WEIGHT[kind], kind };
}

/** Top-edge horizontal segment of a rect (cards, sidebar top, main content). */
export function rectToTopEdge(
  rect: RectLike,
  kind: SegmentKind,
  vp: Viewport,
  spriteSize: number,
  inset = 8,
): Segment | null {
  return horizontalEdge(rect.left, rect.right, rect.top, kind, vp, spriteSize, inset);
}

/** Bottom-edge horizontal segment — used for top-of-viewport chrome (top bar). */
export function rectToBottomEdge(
  rect: RectLike,
  kind: SegmentKind,
  vp: Viewport,
  spriteSize: number,
  inset = 8,
): Segment | null {
  return horizontalEdge(rect.left, rect.right, rect.bottom, kind, vp, spriteSize, inset);
}

/** Full-width fallback ledge near the top of the viewport (top-bar bottom). */
export function defaultTopBarSegment(
  vp: Viewport,
  spriteSize: number,
  inset = 8,
  preferredY = 48,
): Segment {
  const x1 = inset;
  const x2 = Math.max(x1 + 48, vp.width - inset);
  const y = clampWalkY(preferredY, spriteSize, vp.height);
  return { x1, y1: y, x2, y2: y, weight: KIND_WEIGHT.fallback, kind: 'fallback' };
}

/** Drop segments shorter than `minLength` (not worth walking on). */
export function pruneSegments(segments: Segment[], minLength = 48): Segment[] {
  return segments.filter((s) => segmentLength(s) >= minLength);
}

/**
 * Drop near-duplicate segments (e.g. nested cards whose top edges coincide, or a
 * card top that sits right on the top-bar bottom). Keeps the first / higher-
 * weighted occurrence.
 */
export function dedupeSegments(segments: Segment[], epsilon = 6): Segment[] {
  const kept: Segment[] = [];
  for (const s of segments) {
    const dup = kept.find((k) => sameSegment(k, s, epsilon));
    if (!dup) {
      kept.push(s);
    } else if (s.weight > dup.weight) {
      // Prefer the higher-weighted duplicate.
      kept[kept.indexOf(dup)] = s;
    }
  }
  return kept;
}

/** Euclidean distance from a point to the closest spot on a segment. */
export function distanceToSegment(seg: Segment, p: Point): number {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - seg.x1, p.y - seg.y1);
  const t = clamp01(((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / len2);
  const cx = seg.x1 + t * dx;
  const cy = seg.y1 + t * dy;
  return Math.hypot(p.x - cx, p.y - cy);
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

/** The parameter `t` (0..1) of the closest point on a segment to `p`. */
export function nearestParamOn(seg: Segment, p: Point): number {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return clamp01(((p.x - seg.x1) * dx + (p.y - seg.y1) * dy) / len2);
}

export interface StepResult {
  /** New parameter along the segment, in [0,1]. */
  t: number;
  atEnd: boolean;
}

/**
 * Advance parameter `t` along a segment by `dist` pixels in `dir`, clamped to
 * the segment ends. `atEnd` is set when a clamp happened.
 */
export function stepAlong(t: number, seg: Segment, dir: Direction, dist: number): StepResult {
  const len = segmentLength(seg);
  if (len <= 0) return { t: dir >= 0 ? 1 : 0, atEnd: true };
  const nt = t + (dir * dist) / len;
  if (dir >= 0) {
    if (nt >= 1) return { t: 1, atEnd: true };
    return { t: nt, atEnd: false };
  }
  if (nt <= 0) return { t: 0, atEnd: true };
  return { t: nt, atEnd: false };
}

export interface NextChoice {
  seg: Segment;
  /** Which end of `seg` the sprite enters at (0 = start, 1 = end). */
  enterT: 0 | 1;
  /** Direction to walk after entering (walks toward the far end). */
  dir: Direction;
  /** Distance from the finish point to the entry end. */
  distance: number;
  /** Selection score (higher = more preferred): weight vs. jump distance. */
  score: number;
}

/** Distance-falloff constant: candidates this many px away halve in appeal. */
const DISTANCE_FALLOFF = 160;

function choiceFor(seg: Segment, endPoint: Point): NextChoice {
  const d0 = Math.hypot(endPoint.x - seg.x1, endPoint.y - seg.y1);
  const d1 = Math.hypot(endPoint.x - seg.x2, endPoint.y - seg.y2);
  const enterT: 0 | 1 = d0 <= d1 ? 0 : 1;
  const distance = Math.min(d0, d1);
  const dir: Direction = enterT === 0 ? 1 : -1;
  const score = seg.weight / (1 + distance / DISTANCE_FALLOFF);
  return { seg, enterT, dir, distance, score };
}

/**
 * Rank every candidate segment for the next hop after finishing at `endPoint`.
 * Prefers segments that are close AND highly weighted. The current segment is
 * excluded when there are other options (so the sprite explores), but kept as a
 * turn-around fallback when it's the only walkable edge. Sorted best-first.
 */
export function rankNextSegments(
  segments: Segment[],
  current: Segment | null,
  endPoint: Point,
): NextChoice[] {
  if (segments.length === 0) return [];
  const others = current ? segments.filter((s) => s !== current) : segments;
  const pool = others.length > 0 ? others : segments;
  return pool.map((s) => choiceFor(s, endPoint)).sort((a, b) => b.score - a.score);
}

/** The single best next segment (deterministic). */
export function pickNextSegment(
  segments: Segment[],
  current: Segment | null,
  endPoint: Point,
): NextChoice | null {
  const ranked = rankNextSegments(segments, current, endPoint);
  return ranked.length > 0 ? ranked[0] : null;
}

/**
 * Choose the next segment with a little variety: score-weighted random pick
 * among the best few candidates. `rand` is injectable for deterministic tests.
 */
export function chooseNextSegment(
  segments: Segment[],
  current: Segment | null,
  endPoint: Point,
  rand: () => number = Math.random,
  topN = 4,
): NextChoice | null {
  const ranked = rankNextSegments(segments, current, endPoint);
  if (ranked.length === 0) return null;
  const top = ranked.slice(0, Math.min(topN, ranked.length));
  const total = top.reduce((sum, c) => sum + c.score, 0);
  if (total <= 0) return top[0];
  let r = rand() * total;
  for (const c of top) {
    r -= c.score;
    if (r <= 0) return c;
  }
  return top[top.length - 1];
}

/**
 * A point along a parabolic hop arc from `from` to `to` at parameter `t` (0..1),
 * lifted by `lift` px at the apex. Used to animate jumping between borders.
 */
export function hopArc(from: Point, to: Point, t: number, lift: number): Point {
  const c = clamp01(t);
  const x = from.x + (to.x - from.x) * c;
  const y = from.y + (to.y - from.y) * c;
  // Parabola peaking at c = 0.5 with value `lift`; subtracted so it arcs upward.
  const arc = 4 * lift * c * (1 - c);
  return { x, y: y - arc };
}
