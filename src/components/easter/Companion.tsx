import { useEffect, useRef } from 'react';
import { useStore } from '../../state/store';
import { SPRITE_SVGS, svgToDataUrl } from '../../assets/easter/sprites';
import type { CompanionCharacter } from '../../types';
import {
  nearestSegment,
  pickNextSegment,
  pruneSegments,
  rectToTopEdge,
  stepAlong,
  type Direction,
  type Segment,
} from '../../lib/easter/pathing';

/**
 * Easter egg #3 — a cute sprite that walks along the top edges of the app
 * chrome (top bar, sidebar, opted-in cards). See docs/EASTER-COMPANION.md for
 * the full A–Z design. Kept to a single rAF loop that pauses when the tab is
 * hidden; all geometry math is delegated to the pure helpers in pathing.ts.
 */

const SPRITE_SIZE = 28;
const MIN_SEGMENT_WIDTH = 48;
const EDGE_INSET = 8;
const BASE_SPEED = 42; // px/sec
const IDLE_CHANCE = 0.35; // chance to pause on reaching a segment end
const IDLE_MS: [number, number] = [700, 1800];

function charUrl(c: CompanionCharacter): string {
  return svgToDataUrl(SPRITE_SVGS[c]);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function measureSegments(): Segment[] {
  if (typeof document === 'undefined') return [];
  const els = document.querySelectorAll<HTMLElement>('[data-companion-edge], header, aside');
  const segs: Segment[] = [];
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    // Ignore off-screen / collapsed chrome.
    if (r.top < -40 || r.top > window.innerHeight - 8) return;
    const seg = rectToTopEdge({ left: r.left, right: r.right, top: r.top }, EDGE_INSET);
    if (seg) segs.push(seg);
  });
  return pruneSegments(segs, MIN_SEGMENT_WIDTH);
}

export function Companion() {
  const enabled = useStore((s) => s.data.settings.companionEnabled);
  const character = useStore((s) => s.data.settings.companionCharacter);
  const spriteRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    let rafId = 0;
    let last = performance.now();
    let dirty = true;
    let segments: Segment[] = [];
    let current: Segment | null = null;
    let dir: Direction = 1;
    let x = 0;
    let y = 0;
    let idleUntil = 0;
    const reduced = prefersReducedMotion();
    const speed = reduced ? BASE_SPEED * 0.55 : BASE_SPEED;

    const markDirty = () => {
      dirty = true;
    };

    const ensureCurrent = () => {
      if (segments.length === 0) {
        current = null;
        return;
      }
      if (!current || !segments.some((s) => s === current)) {
        // Re-snap to the nearest valid segment after a layout change.
        const snap = nearestSegment(segments, { x, y });
        current = snap;
        if (current) {
          x = Math.min(Math.max(x, current.x1), current.x2);
          y = current.y;
        }
      }
    };

    const positionSprite = () => {
      const el = spriteRef.current;
      if (!el) return;
      const left = x - SPRITE_SIZE / 2;
      const top = y - SPRITE_SIZE;
      el.style.transform = `translate3d(${left}px, ${top}px, 0) scaleX(${dir === 1 ? 1 : -1})`;
      el.style.opacity = current ? '1' : '0';
    };

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      if (dirty) {
        segments = measureSegments();
        dirty = false;
        ensureCurrent();
      }

      if (current && now >= idleUntil) {
        const res = stepAlong(x, current, dir, speed * dt);
        x = res.x;
        y = current.y;
        if (res.atEnd) {
          const endPoint = { x, y };
          // Occasionally pause and look around before moving on.
          if (Math.random() < IDLE_CHANCE) {
            idleUntil = now + (IDLE_MS[0] + Math.random() * (IDLE_MS[1] - IDLE_MS[0]));
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

      positionSprite();
      rafId = requestAnimationFrame(frame);
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

    rafId = requestAnimationFrame(frame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', markDirty);
      window.removeEventListener('scroll', markDirty, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div
      aria-hidden
      className="easter-companion-layer fixed inset-0 z-[45] pointer-events-none overflow-hidden"
    >
      <img
        ref={spriteRef}
        src={charUrl(character)}
        alt=""
        width={SPRITE_SIZE}
        height={SPRITE_SIZE}
        className="easter-companion-sprite absolute top-0 left-0"
        style={{
          imageRendering: 'pixelated',
          opacity: 0,
          filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.28))',
          willChange: 'transform',
        }}
      />
    </div>
  );
}
