import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useStore } from '../state/store';
import { getHelperTip } from '../lib/helperTips';
import { useHelperUi } from './HelperUiContext';

/**
 * When Helper Mode is on, hovering/focusing the wrapped control shows a
 * non-blocking popover. The bubble uses pointer-events:none except for
 * "Learn more", so ordinary clicks are not trapped.
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
  const wrapRef = useRef<HTMLSpanElement>(null);
  const leaveTimer = useRef<number | null>(null);
  const liveTimer = useRef<number | null>(null);
  const panelId = useId();

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
      style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle', ...style }}
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
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className="helper-tip-popover"
          style={{
            position: 'absolute',
            zIndex: 80,
            left: 0,
            top: '100%',
            marginTop: 6,
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
        </span>
      )}
    </span>
  );
}
