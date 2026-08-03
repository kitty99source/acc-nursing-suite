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

// Never hits a real network/model — this suite covers the panel's send/streaming/"thinking" UI
// logic, which is exercised by the mocked generateLocalAiResponseStream below.
const aiServiceMocks = vi.hoisted(() => ({
  generateLocalAiResponseStream: vi.fn(),
}));
vi.mock('../lib/aiService', () => aiServiceMocks);

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
  aiServiceMocks.generateLocalAiResponseStream.mockReset();
  useAiChatStore.setState({ open: true, chips: [], messages: [], sending: false, streamingText: '', hydrated: false });
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

  it('shows a specific latency-expectation message (not a bare spinner) before any tokens have streamed back', async () => {
    let resolveGenerate!: (value: { ok: true; text: string }) => void;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      () => new Promise((resolve) => { resolveGenerate = resolve; }),
    );
    useAiChatStore.setState({ hydrated: true });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // React tracks input values via its own property descriptor — plain `.value =` assignment
    // doesn't notify React's change detection, so set through the native setter instead.
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    expect(container.textContent).toContain('small on-device models can take 30');
    expect(container.textContent).toContain('right after Ollama has just started');

    await act(async () => {
      resolveGenerate({ ok: true, text: 'hi there' });
    });
    await flush();
    expect(container.textContent).toContain('hi there');
    expect(useAiChatStore.getState().sending).toBe(false);
    expect(useAiChatStore.getState().streamingText).toBe('');
  });

  it('renders streamed partial text live as onChunk fires, before the final message is added', async () => {
    let onChunkCb!: (accumulated: string) => void;
    let resolveGenerate!: (value: { ok: true; text: string }) => void;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      (_baseUrl: string, _prompt: string, opts: { onChunk?: (t: string) => void }) =>
        new Promise((resolve) => {
          onChunkCb = opts.onChunk!;
          resolveGenerate = resolve;
        }),
    );
    useAiChatStore.setState({ hydrated: true });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    await act(async () => {
      onChunkCb('Hel');
    });
    expect(container.textContent).toContain('Hel');

    await act(async () => {
      onChunkCb('Hello world');
    });
    expect(container.textContent).toContain('Hello world');

    await act(async () => {
      resolveGenerate({ ok: true, text: 'Hello world' });
    });
    await flush();
    expect(useAiChatStore.getState().streamingText).toBe('');
    expect(useAiChatStore.getState().messages.at(-1)?.content).toBe('Hello world');
  });

  it('shows the specific error and does not crash when the model call fails/times out', async () => {
    aiServiceMocks.generateLocalAiResponseStream.mockResolvedValue({
      ok: false,
      error: 'The local AI model stopped responding and this request timed out.',
    });
    useAiChatStore.setState({ hydrated: true });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    expect(container.textContent).toContain("Couldn't reach the local AI model.");
    expect(container.textContent).toContain('timed out');
    expect(useAiChatStore.getState().sending).toBe(false);
  });
});
