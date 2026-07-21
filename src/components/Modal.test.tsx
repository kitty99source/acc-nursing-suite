import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, useState } from 'react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { Modal } from './Modal';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function flushTimers() {
  await act(async () => {
    vi.advanceTimersByTime(100);
  });
}

describe('<Modal /> initial focus (regression: Notes modal Close-steals-focus)', () => {
  it('focuses the first input, not the header Close button, when opened', async () => {
    await act(async () => {
      root.render(
        <Modal open title="Edit patient" onClose={() => {}}>
          <input data-testid="notes" placeholder="Notes" />
        </Modal>,
      );
    });
    await flushTimers();

    const input = container.querySelector<HTMLInputElement>('[data-testid="notes"]');
    expect(input).toBeTruthy();
    expect(document.activeElement).toBe(input);
    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[data-modal-chrome="close"]',
    );
    expect(closeBtn).toBeTruthy();
    expect(document.activeElement).not.toBe(closeBtn);
  });

  it('does not re-run initial focus when the parent re-renders with a new onClose', async () => {
    function Harness() {
      const [value, setValue] = useState('');
      return (
        <Modal open title="Edit patient" onClose={() => setValue((v) => v)}>
          <input
            data-testid="notes"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Modal>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await flushTimers();

    const input = container.querySelector<HTMLInputElement>('[data-testid="notes"]');
    expect(input).toBeTruthy();
    input!.focus();
    expect(document.activeElement).toBe(input);

    // Simulate the exact regression: user types a single letter, which changes
    // state in the parent, recreates the inline onClose, and re-renders the
    // Modal. Previously the focus-trap effect would re-run because `onClose`
    // was in its dep list, snatching focus back to the header Close button.
    await act(async () => {
      input!.focus();
      input!.value = 'a';
      input!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushTimers();

    expect(document.activeElement).toBe(input);
    const closeBtn = container.querySelector<HTMLButtonElement>(
      'button[data-modal-chrome="close"]',
    );
    expect(document.activeElement).not.toBe(closeBtn);
  });

  it('falls back to a non-chrome button when the modal has no form fields', async () => {
    await act(async () => {
      root.render(
        <Modal open title="Confirm" onClose={() => {}}>
          <button data-testid="ok">OK</button>
        </Modal>,
      );
    });
    await flushTimers();

    const ok = container.querySelector<HTMLButtonElement>('[data-testid="ok"]');
    expect(ok).toBeTruthy();
    expect(document.activeElement).toBe(ok);
  });

  it('closes on Escape via the latest onClose (ref)', async () => {
    let count = 0;
    function Harness() {
      const [, setV] = useState(0);
      const handleClose = () => {
        count += 1;
        setV((n) => n + 1);
      };
      return (
        <Modal open title="Edit" onClose={handleClose}>
          <input data-testid="notes" />
        </Modal>
      );
    }

    await act(async () => {
      root.render(<Harness />);
    });
    await flushTimers();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(count).toBe(1);
  });
});
