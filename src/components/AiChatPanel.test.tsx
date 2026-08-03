import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';

// aiChatStore persists to IndexedDB, which jsdom lacks — mock it so the panel
// mounts and its hydrate/persist/clearHistory calls resolve. This does NOT
// edit lib/idb.ts.
const idbMocks = vi.hoisted(() => ({
  loadAiChatHistory: vi.fn(async () => undefined as import('../lib/idb').AiChatHistoryRecord | undefined),
  saveAiChatHistory: vi.fn(async () => {}),
  clearAiChatHistory: vi.fn(async () => {}),
}));
vi.mock('../lib/idb', () => idbMocks);

import { AiChatPanel } from './AiChatPanel';
import { useStore } from '../state/store';
import { useAiChatStore } from '../state/aiChatStore';
import { emptyData } from '../lib/sampleData';

let container: HTMLDivElement;
let root: Root;

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  idbMocks.loadAiChatHistory.mockClear().mockResolvedValue(undefined);
  idbMocks.saveAiChatHistory.mockClear();
  idbMocks.clearAiChatHistory.mockClear();
  useAiChatStore.setState({ open: true, chips: [], messages: [], sending: false, hydrated: false });
  useStore.setState({ data: { ...emptyData(), settings: { ...emptyData().settings, aiFeaturesEnabled: true } } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe('<AiChatPanel />', () => {
  it('renders nothing when Settings -> "Enable AI features" is off', async () => {
    useStore.setState({ data: { ...emptyData(), settings: { ...emptyData().settings, aiFeaturesEnabled: false } } });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    expect(container.innerHTML).toBe('');
  });

  it('hydrates any persisted conversation from IndexedDB on mount', async () => {
    idbMocks.loadAiChatHistory.mockResolvedValue({
      messages: [{ id: 'm1', role: 'assistant', content: 'previously saved reply', createdAt: 1 }],
      chips: [],
      savedAt: 1,
    });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();
    expect(container.textContent).toContain('previously saved reply');
  });

  it('shows a "Clear chat history" control that wipes messages/chips and the IndexedDB record', async () => {
    // Mark already-hydrated so the mount-time hydrate() call is a no-op and
    // doesn't clobber this seeded state with the (empty) mocked IDB load.
    useAiChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'hello', createdAt: 1 }],
      chips: [],
      hydrated: true,
    });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();
    expect(container.textContent).toContain('hello');

    const clearButton = container.querySelector('button[aria-label="Clear chat history"]') as HTMLButtonElement;
    expect(clearButton).toBeTruthy();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      clearButton.click();
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(useAiChatStore.getState().messages).toEqual([]);
    expect(idbMocks.clearAiChatHistory).toHaveBeenCalled();
    expect(container.textContent).not.toContain('hello');
    confirmSpy.mockRestore();
  });

  it('does not wipe history if the user cancels the confirmation', async () => {
    useAiChatStore.setState({
      messages: [{ id: 'm1', role: 'user', content: 'keep me', createdAt: 1 }],
      chips: [],
      hydrated: true,
    });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const clearButton = container.querySelector('button[aria-label="Clear chat history"]') as HTMLButtonElement;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      clearButton.click();
    });

    expect(useAiChatStore.getState().messages).toHaveLength(1);
    expect(idbMocks.clearAiChatHistory).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('the "Clear chat history" control is disabled when there is nothing to clear', async () => {
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();
    const clearButton = container.querySelector('button[aria-label="Clear chat history"]') as HTMLButtonElement;
    expect(clearButton.disabled).toBe(true);
  });
});
