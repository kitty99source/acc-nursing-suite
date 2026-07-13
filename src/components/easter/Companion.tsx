import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { COMPANION_FRAME_URLS, framesFor, frameDurationMs } from '../../assets/easter/companionFrames';
import {
  resolveCompanionState,
  frameIndexFor,
  type CompanionTimers,
} from '../../lib/easter/companionBehavior';
import { emptyClickBurst, registerClick, type ClickBurstState } from '../../lib/easter/clickCounter';
import {
  chooseNextSegment,
  defaultTopBarSegment,
  dedupeSegments,
  hopArc,
  nearestParamOn,
  nearestSegment,
  pointAt,
  pruneSegments,
  rectToBottomEdge,
  rectToTopEdge,
  segEnd,
  stepAlong,
  verticalEdge,
  type Direction,
  type NextChoice,
  type Point,
  type Segment,
  type Viewport,
} from '../../lib/easter/pathing';

/**
 * Easter egg #3 — a cute sprite that walks the whole UI along real component
 * borders: the top bar, the sidebar (top edge *and* its vertical side), the tops
 * of cards / panels / action rows, and the main content box. See
 * docs/EASTER-COMPANION.md for the full A–Z design.
 *
 * v3 (this file) upgrades the pather from a single top-bar ledge into a small
 * *path graph* across every discovered edge: the sprite walks a border, and when
 * it reaches the end it **hops** (a short parabolic jump) to a nearby border
 * rather than reversing forever or walking off-screen. Every position is clamped
 * to the viewport, so it can never disappear off the right edge. It still keeps
 * the v2 multi-frame sprites, sleep/"z z z", and the poke-to-annoy interaction,
 * runs on a single rAF loop, remeasures on resize/scroll/nav, and pauses when
 * the tab is hidden.
 *
 * Visibility note: chrome at the very top of the viewport (header) uses its
 * *bottom* edge as the ledge so the sprite sits on-screen; everything else uses
 * top edges with a y-clamp. A synthetic top-bar fallback always exists.
 */

const SPRITE_SIZE = 30;
const MIN_SEGMENT_LENGTH = 48;
const EDGE_INSET = 8;
const BASE_SPEED = 42; // px/sec along a border
const IDLE_CHANCE = 0.32; // chance to pause on reaching a border end
const LONG_REST_CHANCE = 0.3; // of those pauses, chance it's a long (sleepy) rest
const SHORT_IDLE_MS: [number, number] = [700, 1800];
const LONG_REST_MS: [number, number] = [5000, 11000];
const SLEEP_ONSET_MS = 2600; // continuous rest before dozing off
const ANNOYED_MS = 1300;
const CLICK_BURST = { threshold: 3, windowMs: 1300 };

// Hop (jump between borders) tuning.
const HOP_MIN_DISTANCE = 8; // below this we just step onto the next border
const HOP_MS_PER_PX = 2.4;
const HOP_MIN_MS = 220;
const HOP_MAX_MS = 640;
const HOP_LIFT_RATIO = 0.5;
const HOP_MIN_LIFT = 14;
const HOP_MAX_LIFT = 46;

// Selectors for auto-discovered walkable surfaces.
const TOPBAR_SELECTOR = 'header, [data-companion-ledge="bottom"]';
const CARD_SELECTOR = '[data-companion-edge], .card, .clickable-card, .action-row';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface HopState {
  from: Point;
  to: Point;
  start: number;
  dur: number;
  lift: number;
  next: NextChoice;
}

/** Whether an element is visible enough (and not inside a modal) to walk on. */
function isWalkable(el: HTMLElement, vp: Viewport): DOMRect | null {
  if (el.closest('[role="dialog"]') || el.closest('[data-companion-skip]')) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  // Must have some presence inside the viewport.
  if (r.bottom < 0 || r.top > vp.height || r.right < 0 || r.left > vp.width) return null;
  return r;
}

function measureSegments(): Segment[] {
  if (typeof document === 'undefined' || typeof window === 'undefined') return [];
  const vp: Viewport = { width: window.innerWidth, height: window.innerHeight };
  const segs: Segment[] = [];
  const seen = new Set<HTMLElement>();

  const push = (seg: Segment | null) => {
    if (seg) segs.push(seg);
  };

  // Top bar: walk the *bottom* edge so the sprite sits on the chrome (top edge
  // at y≈0 would clip above the viewport).
  document.querySelectorAll<HTMLElement>(TOPBAR_SELECTOR).forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = isWalkable(el, vp);
    if (r) push(rectToBottomEdge(r, 'topbar', vp, SPRITE_SIZE, EDGE_INSET));
  });

  // Sidebar: both the top edge and the vertical right side (for occasional
  // vertical walks along a clean border between sidebar and content).
  document.querySelectorAll<HTMLElement>('aside').forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = isWalkable(el, vp);
    if (!r) return;
    push(rectToTopEdge(r, 'sidebar-top', vp, SPRITE_SIZE, EDGE_INSET));
    push(verticalEdge(r.right, r.top, r.bottom, 'sidebar-side', vp, SPRITE_SIZE, EDGE_INSET));
  });

  // Main content box: a wide top ledge just under the top bar.
  document.querySelectorAll<HTMLElement>('main').forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = isWalkable(el, vp);
    if (r) push(rectToTopEdge(r, 'main', vp, SPRITE_SIZE, EDGE_INSET));
  });

  // Cards / panels / action rows / explicit opt-ins: top edges.
  document.querySelectorAll<HTMLElement>(CARD_SELECTOR).forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = isWalkable(el, vp);
    if (r) push(rectToTopEdge(r, 'card', vp, SPRITE_SIZE, EDGE_INSET));
  });

  const cleaned = dedupeSegments(pruneSegments(segs, MIN_SEGMENT_LENGTH));
  if (cleaned.length > 0) return cleaned;

  // Zero-path fallback: full-width ledge under a typical top bar.
  const header = document.querySelector('header');
  const preferredY = header ? header.getBoundingClientRect().bottom || 48 : 48;
  return [defaultTopBarSegment(vp, SPRITE_SIZE, EDGE_INSET, preferredY)];
}

function randBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

function clampToViewport(left: number, top: number): { left: number; top: number } {
  const maxLeft = Math.max(0, window.innerWidth - SPRITE_SIZE);
  const maxTop = Math.max(0, window.innerHeight - SPRITE_SIZE);
  return {
    left: Math.min(Math.max(left, 0), maxLeft),
    top: Math.min(Math.max(top, 0), maxTop),
  };
}

export function Companion() {
  const enabled = useStore((s) => s.data.settings.companionEnabled);
  const character = useStore((s) => s.data.settings.companionCharacter);
  const spriteRef = useRef<HTMLImageElement | null>(null);
  const posRef = useRef<HTMLDivElement | null>(null);
  const zzzRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let rafId = 0;
    let last = performance.now();
    let dirty = true;
    let segments: Segment[] = [];
    let current: Segment | null = null;
    let posT = 0; // parameter (0..1) along the current segment
    let dir: Direction = 1;
    let facing: Direction = 1; // horizontal flip (last horizontal travel dir)
    let hop: HopState | null = null;
    let point: Point = { x: EDGE_INSET + 24, y: SPRITE_SIZE };
    let idleUntil = 0;
    let idleStartedAt = 0;
    let annoyedUntil = 0;
    let clickBurst: ClickBurstState = emptyClickBurst();
    let stateStartedAt = performance.now();
    let prevState: string | null = null;
    let lastFrameUrl = '';
    const reduced = prefersReducedMotion();
    const speed = reduced ? BASE_SPEED * 0.55 : BASE_SPEED;

    const markDirty = () => {
      dirty = true;
    };

    const vp = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

    const ensureCurrent = () => {
      if (segments.length === 0) {
        segments = [defaultTopBarSegment(vp(), SPRITE_SIZE, EDGE_INSET, 48)];
      }
      if (!current || !segments.includes(current)) {
        // Re-snap to the nearest surviving segment after a layout change.
        const snap = nearestSegment(segments, point);
        current = snap;
        if (current) {
          posT = nearestParamOn(current, point);
          point = pointAt(current, posT);
        }
        hop = null;
      }
    };

    const timers = (now: number): CompanionTimers => ({
      now,
      idleUntil,
      idleStartedAt,
      annoyedUntil,
      sleepOnsetMs: SLEEP_ONSET_MS,
    });

    const beginHop = (now: number, next: NextChoice, from: Point) => {
      const to = segEnd(next.seg, next.enterT);
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const dur = Math.min(HOP_MAX_MS, Math.max(HOP_MIN_MS, distance * HOP_MS_PER_PX));
      const lift = Math.min(HOP_MAX_LIFT, Math.max(HOP_MIN_LIFT, distance * HOP_LIFT_RATIO));
      hop = { from, to, start: now, dur: reduced ? dur * 0.6 : dur, lift: reduced ? 0 : lift, next };
      if (Math.abs(to.x - from.x) > 0.1) facing = to.x >= from.x ? 1 : -1;
    };

    const landHop = () => {
      if (!hop) return;
      current = hop.next.seg;
      dir = hop.next.dir;
      posT = hop.next.enterT;
      point = pointAt(current, posT);
      hop = null;
    };

    const advanceWalk = (now: number, dt: number) => {
      if (!current) return;
      const prev = point;
      const res = stepAlong(posT, current, dir, speed * dt);
      posT = res.t;
      point = pointAt(current, posT);
      if (Math.abs(point.x - prev.x) > 0.1) facing = point.x >= prev.x ? 1 : -1;

      if (res.atEnd) {
        // Maybe pause (which may deepen into sleep) at this border end.
        if (Math.random() < IDLE_CHANCE) {
          idleStartedAt = now;
          const long = Math.random() < LONG_REST_CHANCE;
          idleUntil = now + randBetween(long ? LONG_REST_MS : SHORT_IDLE_MS);
        }
        const choice = chooseNextSegment(segments, current, point);
        if (choice) {
          const entry = segEnd(choice.seg, choice.enterT);
          const jump = Math.hypot(entry.x - point.x, entry.y - point.y);
          if (jump > HOP_MIN_DISTANCE) {
            beginHop(now, choice, point);
          } else {
            current = choice.seg;
            dir = choice.dir;
            posT = choice.enterT;
            point = pointAt(current, posT);
          }
        } else {
          dir = (dir === 1 ? -1 : 1) as Direction;
        }
      }
    };

    const render = (now: number) => {
      const el = spriteRef.current;
      const pos = posRef.current;
      const zzz = zzzRef.current;
      const state = resolveCompanionState(timers(now));

      if (state !== prevState) {
        prevState = state;
        stateStartedAt = now;
      }

      if (el) {
        // While hopping, keep the walk cycle running for a lively jump.
        const frameState = hop ? 'walk' : state;
        const frames = framesFor(character, frameState, reduced);
        const idx = frameIndexFor(
          now - stateStartedAt,
          frames.length,
          frameDurationMs(frameState, reduced),
        );
        const url = frames[idx];
        if (url && url !== lastFrameUrl) {
          el.src = url;
          lastFrameUrl = url;
        }
        el.style.transform = `scaleX(${facing === 1 ? 1 : -1})`;
      }

      if (pos) {
        let left = point.x - SPRITE_SIZE / 2;
        let top = point.y - SPRITE_SIZE;
        if (state === 'annoyed' && !hop && !reduced) left += Math.sin(now / 28) * 1.6;
        const clamped = clampToViewport(left, top);
        pos.style.transform = `translate3d(${clamped.left}px, ${clamped.top}px, 0)`;
        pos.style.opacity = '1';
      }

      if (zzz) {
        zzz.style.opacity = state === 'sleep' && !hop ? '1' : '0';
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (dirty) {
        segments = measureSegments();
        dirty = false;
        ensureCurrent();
      }

      if (hop) {
        const t = (now - hop.start) / hop.dur;
        if (t >= 1) {
          landHop();
        } else {
          point = hopArc(hop.from, hop.to, t, hop.lift);
        }
      } else {
        const moving = resolveCompanionState(timers(now)) === 'walk';
        if (current && moving) advanceWalk(now, dt);
      }

      render(now);
      rafId = requestAnimationFrame(frame);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const now = performance.now();
      idleUntil = 0;
      idleStartedAt = now;
      const res = registerClick(clickBurst, now, CLICK_BURST);
      clickBurst = res.state;
      if (res.triggered) {
        annoyedUntil = now + ANNOYED_MS;
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      } else if (rafId === 0) {
        last = performance.now();
        markDirty();
        rafId = requestAnimationFrame(frame);
      }
    };

    const ro = new ResizeObserver(markDirty);
    ro.observe(document.body);
    // Remeasure on navigation / card churn: watch the main content subtree.
    const mo = new MutationObserver(markDirty);
    const mainEl = document.querySelector('main') ?? document.body;
    mo.observe(mainEl, { childList: true, subtree: true });
    window.addEventListener('resize', markDirty);
    window.addEventListener('scroll', markDirty, true);
    document.addEventListener('visibilitychange', onVisibility);
    const spriteEl = spriteRef.current;
    spriteEl?.addEventListener('click', onClick);

    // First measure synchronously so the sprite appears within a frame.
    segments = measureSegments();
    ensureCurrent();
    render(performance.now());
    rafId = requestAnimationFrame(frame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', markDirty);
      window.removeEventListener('scroll', markDirty, true);
      document.removeEventListener('visibilitychange', onVisibility);
      spriteEl?.removeEventListener('click', onClick);
    };
  }, [enabled, character]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden
      className="easter-companion-layer fixed inset-0 z-[48] pointer-events-none overflow-hidden"
      data-testid="walking-companion"
    >
      <div
        ref={posRef}
        className="easter-companion-pos absolute top-0 left-0"
        style={{ opacity: 1, willChange: 'transform' }}
      >
        {/* Floating snore "z z z" (only visible while sleeping). */}
        <div
          ref={zzzRef}
          className="easter-companion-zzz"
          aria-hidden
          style={{ opacity: 0 }}
        >
          <span style={{ animationDelay: '0s' }}>z</span>
          <span style={{ animationDelay: '0.6s' }}>z</span>
          <span style={{ animationDelay: '1.2s' }}>z</span>
        </div>
        <img
          ref={spriteRef}
          src={COMPANION_FRAME_URLS[character].walk[0]}
          alt=""
          width={SPRITE_SIZE}
          height={SPRITE_SIZE}
          className="easter-companion-sprite"
          style={{
            imageRendering: 'pixelated',
            filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.28))',
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
        />
      </div>
    </div>
  );
}
