import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../state/store';
import { getHelperTip } from '../lib/helperTips';
import { useHelperUi } from './HelperUiContext';

/**
 * When Helper Mode is on, hovering/focusing the wrapped control shows a
 * non-blocking popover. The bubble uses pointer-events:none except for
 * "Learn more", so ordinary clicks are not trapped.
 *
 * PORTAL (2026-08-04 owner-reported bug fix): the popover renders via
 * `createPortal` into `document.body` — positioned with `position: fixed`
 * and coordinates computed from the trigger's own `getBoundingClientRect()`
 * — rather than as a normal absolutely-positioned DOM child of the trigger.
 * A `HelperTip` wraps things like a sidebar nav-item badge, and the
 * Sidebar's own `<nav>` is `overflow-y-auto` (needed so a long nav list can
 * scroll) — a plain in-flow absolute child of that badge would get clipped
 * to the scrollable nav's bounds the moment the popover extends past it,
 * which is exactly what the owner saw ("4 declines awaiting docs or ACC
 * response" cut off near the Decline Tracker item). Escaping to `body` via
 * a portal is the standard fix for "tooltip clipped by a scrollable/
 * overflow-hidden ancestor" and this is now the one portal-based tooltip
 * pattern in the codebase — any future popover with the same clipping risk
 * should reuse this component rather than a plain absolute child.
 */
export function HelperTip({
  tipId,
  children,
  className,
  style,
}: {
  tipId: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const enabled = useStore((s) => s.data.settings.helperModeEnabled);
  const tip = getHelperTip(tipId);
  const { openFaq } = useHelperUi();
  const [open, setOpen] = useState(false);
  const [learnMoreLive, setLearnMoreLive] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const liveTimer = useRef<number | null>(null);
  const panelId = useId();

  // Recomputes the portal popover's fixed-position coordinates from the trigger's own current
  // bounding box — `position: fixed` viewport coordinates, not anything relative to whatever
  // (possibly scrollable/clipping) ancestor the trigger sits in. Re-run on open AND on any
  // scroll/resize while open, since a `position: fixed` portal element does not move with its
  // (now-unrelated in the DOM tree) trigger the way an in-flow absolute child used to.
  const updatePosition = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxWidth = 320;
    // Clamp so the popover never renders off the right edge of the viewport (the trigger can be
    // near the edge of a narrow sidebar) — same left-aligned-under-trigger placement otherwise.
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - maxWidth - 8));
    setPosition({ top: rect.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  const clearTimers = useCallback(() => {
    if (leaveTimer.current != null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    if (liveTimer.current != null) {
      window.clearTimeout(liveTimer.current);
      liveTimer.current = null;
    }
  }, []);

  const show = useCallback(() => {
    if (!enabled || !tip) return;
    clearTimers();
    setOpen(true);
    setLearnMoreLive(false);
    // Brief delay before Learn more accepts clicks — avoids accidental digression mid-click.
    liveTimer.current = window.setTimeout(() => setLearnMoreLive(true), 280);
  }, [enabled, tip, clearTimers]);

  const hideSoon = useCallback(() => {
    clearTimers();
    leaveTimer.current = window.setTimeout(() => {
      setOpen(false);
      setLearnMoreLive(false);
    }, 120);
  }, [clearTimers]);

  const hideNow = useCallback(() => {
    clearTimers();
    setOpen(false);
    setLearnMoreLive(false);
  }, [clearTimers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hideNow();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hideNow]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Helper Mode off or unknown tip → transparent wrapper only.
  if (!enabled || !tip) {
    return (
      <span className={className} style={style} data-helper-tip={tipId}>
        {children}
      </span>
    );
  }

  return (
    <span
      ref={wrapRef}
      className={className}
      style={{ display: 'inline-flex', verticalAlign: 'middle', ...style }}
      data-helper-tip={tipId}
      data-helper-active={open ? 'true' : undefined}
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onFocusCapture={show}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && wrapRef.current?.contains(next)) return;
        hideSoon();
      }}
    >
      {children}
      {open &&
        position &&
        createPortal(
          <span
            id={panelId}
            role="tooltip"
            className="helper-tip-popover"
            style={{
              position: 'fixed',
              zIndex: 1000,
              top: position.top,
              left: position.left,
              minWidth: 220,
              maxWidth: 320,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              pointerEvents: 'none',
              textAlign: 'left',
            }}
          >
            <span className="block text-xs font-bold mb-1">{tip.title}</span>
            <span className="block text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
              {tip.body}
            </span>
            <button
              type="button"
              className="btn btn-sm mt-2"
              style={{
                pointerEvents: learnMoreLive ? 'auto' : 'none',
                opacity: learnMoreLive ? 1 : 0.55,
                fontSize: '0.7rem',
                padding: '2px 8px',
              }}
              tabIndex={learnMoreLive ? 0 : -1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                openFaq(tip.faqId);
                hideNow();
              }}
            >
              Learn more
            </button>
          </span>,
          document.body,
        )}
    </span>
  );
}
