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
  nearestSegment,
  pickNextSegment,
  pruneSegments,
  rectToBottomEdge,
  rectToTopEdge,
  clampWalkY,
  defaultTopBarSegment,
  stepAlong,
  type Direction,
  type Segment,
} from '../../lib/easter/pathing';

/**
 * Easter egg #3 — a cute sprite that walks along the top edges of the app
 * chrome (top bar, sidebar, opted-in cards). See docs/EASTER-COMPANION.md for
 * the full A–Z design.
 *
 * v2 adds real multi-frame pixel animation (a 4-frame walk cycle, not just a
 * CSS bob), a sleep state with floating "z z z", and a click interaction: the
 * sprite is clickable (only the sprite has pointer-events), wakes when poked,
 * and gets briefly annoyed after a few pokes in a short window. Still a single
 * rAF loop that pauses when the tab is hidden.
 *
 * Visibility note: chrome at the top of the viewport (header / aside) uses the
 * *bottom* edge as the walk ledge so the sprite sits on-screen. A synthetic
 * top-bar fallback is always available if measurement finds nothing.
 */

const SPRITE_SIZE = 30;
const MIN_SEGMENT_WIDTH = 48;
const EDGE_INSET = 8;
const BASE_SPEED = 42; // px/sec
const IDLE_CHANCE = 0.4; // chance to pause on reaching a segment end
const LONG_REST_CHANCE = 0.35; // of those pauses, chance it's a long (sleepy) rest
const SHORT_IDLE_MS: [number, number] = [700, 1800];
const LONG_REST_MS: [number, number] = [5000, 11000];
const SLEEP_ONSET_MS = 2600; // continuous rest before dozing off
const ANNOYED_MS = 1300;
const CLICK_BURST = { threshold: 3, windowMs: 1300 };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function measureSegments(): Segment[] {
  if (typeof document === 'undefined' || typeof window === 'undefined') return [];
  const segs: Segment[] = [];
  const seen = new Set<HTMLElement>();

  const addBottom = (el: HTMLElement) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    const seg = rectToBottomEdge(
      { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
      EDGE_INSET,
    );
    if (seg) {
      segs.push({ ...seg, y: clampWalkY(seg.y, SPRITE_SIZE, window.innerHeight) });
    }
  };

  const addTop = (el: HTMLElement) => {
    if (seen.has(el)) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    if (r.top < -40 || r.top > window.innerHeight - 8) return;
    const seg = rectToTopEdge({ left: r.left, right: r.right, top: r.top }, EDGE_INSET);
    if (seg) {
      segs.push({ ...seg, y: clampWalkY(seg.y, SPRITE_SIZE, window.innerHeight) });
    }
  };

  // Top bar: walk the *bottom* edge so the sprite sits on the chrome, not
  // above the viewport (top edge at y≈0 would clip under overflow-hidden).
  document.querySelectorAll<HTMLElement>('header, [data-companion-ledge="bottom"]').forEach(addBottom);

  // Sidebar + opted-in cards: prefer top edge, but clamp y so the sprite stays visible.
  document.querySelectorAll<HTMLElement>('[data-companion-edge], aside').forEach(addTop);

  const pruned = pruneSegments(segs, MIN_SEGMENT_WIDTH);
  if (pruned.length > 0) return pruned;

  // Zero-path fallback: full-width ledge under a typical top bar.
  const header = document.querySelector('header');
  const preferredY = header ? header.getBoundingClientRect().bottom || 48 : 48;
  return [
    defaultTopBarSegment(window.innerWidth, window.innerHeight, EDGE_INSET, preferredY),
  ];
}

function randBetween([lo, hi]: [number, number]): number {
  return lo + Math.random() * (hi - lo);
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
    let dir: Direction = 1;
    let x = EDGE_INSET + 24;
    let y = SPRITE_SIZE;
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

    const ensureCurrent = () => {
      if (segments.length === 0) {
        segments = [
          defaultTopBarSegment(window.innerWidth, window.innerHeight, EDGE_INSET, 48),
        ];
      }
      if (!current || !segments.some((s) => s === current)) {
        const snap = nearestSegment(segments, { x, y });
        current = snap;
        if (current) {
          x = Math.min(Math.max(x, current.x1), current.x2);
          y = current.y;
        }
      }
    };

    const timers = (now: number): CompanionTimers => ({
      now,
      idleUntil,
      idleStartedAt,
      annoyedUntil,
      sleepOnsetMs: SLEEP_ONSET_MS,
    });

    const render = (now: number, moving: boolean) => {
      const el = spriteRef.current;
      const pos = posRef.current;
      const zzz = zzzRef.current;
      const state = resolveCompanionState(timers(now));

      if (state !== prevState) {
        prevState = state;
        stateStartedAt = now;
      }

      // Advance the frame within the current state.
      if (el) {
        const frames = framesFor(character, state, reduced);
        const idx = frameIndexFor(now - stateStartedAt, frames.length, frameDurationMs(state, reduced));
        const url = frames[idx];
        if (url && url !== lastFrameUrl) {
          el.src = url;
          lastFrameUrl = url;
        }
        el.style.transform = `scaleX(${dir === 1 ? 1 : -1})`;
      }

      if (pos) {
        let left = x - SPRITE_SIZE / 2;
        const top = y - SPRITE_SIZE;
        // A little shake while annoyed (never under reduced motion).
        if (state === 'annoyed' && !reduced) left += Math.sin(now / 28) * 1.6;
        pos.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        // Always visible once mounted — fallback path guarantees a segment.
        pos.style.opacity = '1';
      }

      if (zzz) {
        zzz.style.opacity = state === 'sleep' ? '1' : '0';
      }

      void moving;
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (dirty) {
        segments = measureSegments();
        dirty = false;
        ensureCurrent();
      }

      const moving = resolveCompanionState(timers(now)) === 'walk';

      if (current && moving) {
        const res = stepAlong(x, current, dir, speed * dt);
        x = res.x;
        y = current.y;
        if (res.atEnd) {
          const endPoint = { x, y };
          if (Math.random() < IDLE_CHANCE) {
            idleStartedAt = now;
            const long = Math.random() < LONG_REST_CHANCE;
            idleUntil = now + randBetween(long ? LONG_REST_MS : SHORT_IDLE_MS);
          }
          const next = pickNextSegment(segments, current, endPoint);
          if (next) {
            current = next.seg;
            dir = next.dir;
            x = dir === 1 ? current.x1 : current.x2;
            y = current.y;
          } else {
            dir = (dir === 1 ? -1 : 1) as Direction;
          }
        }
      }

      render(now, moving);
      rafId = requestAnimationFrame(frame);
    };

    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      const now = performance.now();
      // Any poke wakes the companion up and cancels the current rest.
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
    window.addEventListener('resize', markDirty);
    window.addEventListener('scroll', markDirty, true);
    document.addEventListener('visibilitychange', onVisibility);
    const spriteEl = spriteRef.current;
    spriteEl?.addEventListener('click', onClick);

    // First measure synchronously so the sprite appears within a frame.
    segments = measureSegments();
    ensureCurrent();
    render(performance.now(), true);
    rafId = requestAnimationFrame(frame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
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
