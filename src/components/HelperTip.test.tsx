import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

import { HelperTip } from './HelperTip';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';

// ============================================================================
// 2026-08-04 owner-reported bug: a sidebar HelperTip popover ("4 declines
// awaiting docs or ACC response" / "Learn more") was visually clipped by the
// sidebar's own `overflow-y-auto` nav container. Fix: the popover now renders
// via a React portal into `document.body`, escaping any overflow-hidden/
// overflow-auto ancestor instead of being a plain absolutely-positioned DOM
// child of the trigger. These tests assert the popover is a `document.body`
// child living OUTSIDE a clipping ancestor, not merely that it "renders".
// ============================================================================

let outerContainer: HTMLDivElement;
let clippingAncestor: HTMLDivElement;
let mountPoint: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.setState({
    data: { ...emptyData(), settings: { ...emptyData().settings, helperModeEnabled: true } },
  });

  // Simulates the Sidebar's own `<nav className="... overflow-y-auto ...">` clipping container.
  outerContainer = document.createElement('div');
  clippingAncestor = document.createElement('div');
  clippingAncestor.style.overflow = 'hidden';
  clippingAncestor.style.position = 'relative';
  mountPoint = document.createElement('div');
  clippingAncestor.appendChild(mountPoint);
  outerContainer.appendChild(clippingAncestor);
  document.body.appendChild(outerContainer);

  root = createRoot(mountPoint);
});

afterEach(() => {
  act(() => root.unmount());
  outerContainer.remove();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('<HelperTip />', () => {
  it('renders the popover as a document.body child (via portal), not nested inside the overflow-hidden ancestor', async () => {
    act(() => {
      root.render(
        <HelperTip tipId="tip-sidebar-badges">
          <button type="button" data-testid="trigger">
            4
          </button>
        </HelperTip>,
      );
    });
    await flush();

    // Use a real focus event (not a hover simulation) to trigger the wrapper's
    // `onFocusCapture={show}` — jsdom's native focus() call is a reliable way to exercise React's
    // focus-capture handling without needing a userEvent-style hover library in this codebase.
    const trigger = mountPoint.querySelector('[data-testid="trigger"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    act(() => {
      trigger.focus();
    });
    await flush();

    const popover = document.body.querySelector('[role="tooltip"].helper-tip-popover');
    expect(popover).toBeTruthy();

    // The clipping ancestor (simulating the sidebar's overflow-y-auto <nav>) must NOT contain
    // the popover — that's exactly the bug: previously it was a descendant and got visually cut.
    expect(clippingAncestor.contains(popover)).toBe(false);
    // It must be a document.body descendant (the portal target).
    expect(document.body.contains(popover)).toBe(true);
    // And it renders the real tip content, not a placeholder.
    expect(popover?.textContent).toContain('Sidebar badge numbers');
  });

  it('positions the popover with `position: fixed` viewport coordinates, not relative to the (possibly clipping) trigger ancestor', async () => {
    act(() => {
      root.render(
        <HelperTip tipId="tip-sidebar-badges">
          <button type="button" data-testid="trigger2">
            4
          </button>
        </HelperTip>,
      );
    });
    await flush();

    const trigger = mountPoint.querySelector('[data-testid="trigger2"]') as HTMLButtonElement;
    act(() => {
      trigger.focus();
    });
    await flush();

    const popover = document.body.querySelector('[role="tooltip"].helper-tip-popover') as HTMLElement;
    expect(popover.style.position).toBe('fixed');
  });

  it('renders nothing (no popover, transparent wrapper) when Helper Mode is off', async () => {
    useStore.setState({
      data: { ...emptyData(), settings: { ...emptyData().settings, helperModeEnabled: false } },
    });
    act(() => {
      root.render(
        <HelperTip tipId="tip-sidebar-badges">
          <button type="button" data-testid="trigger3">
            4
          </button>
        </HelperTip>,
      );
    });
    await flush();

    const trigger = mountPoint.querySelector('[data-testid="trigger3"]') as HTMLButtonElement;
    act(() => {
      trigger.focus();
    });
    await flush();

    expect(document.body.querySelector('[role="tooltip"].helper-tip-popover')).toBeNull();
  });
});
