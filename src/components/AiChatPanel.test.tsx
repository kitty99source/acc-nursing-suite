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

  it('clicking "Clear chat history" mid-stream aborts the request and discards its late-arriving final message (owner-reported race)', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveGenerate!: (value: { ok: true; text: string }) => void;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      (_baseUrl: string, _prompt: string, opts: { signal?: AbortSignal }) => {
        capturedSignal = opts.signal;
        return new Promise((resolve) => {
          resolveGenerate = resolve;
        });
      },
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

    // The old ("supposed to be cancelled") request is genuinely still in flight at this point —
    // this mirrors the owner's live repro exactly: click send, then click the trash icon before
    // the model has finished generating.
    expect(useAiChatStore.getState().sending).toBe(true);
    expect(capturedSignal?.aborted).toBe(false);

    const clearButton = container.querySelector('button[aria-label="Clear chat history"]') as HTMLButtonElement;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      clearButton.click();
    });
    confirmSpy.mockRestore();

    // Clearing should be instant: no more "thinking"/streaming state, and the request's own
    // AbortController signal should already be aborted.
    expect(useAiChatStore.getState().sending).toBe(false);
    expect(useAiChatStore.getState().messages).toEqual([]);
    expect(capturedSignal?.aborted).toBe(true);

    // NOW let the stale request "finish" (simulates abort not being instant — e.g. it was already
    // past the fetch/read and about to resolve). The final message must NOT reappear in the store.
    await act(async () => {
      resolveGenerate({ ok: true, text: 'stale reply that should never reappear' });
    });
    await flush();

    expect(useAiChatStore.getState().messages).toEqual([]);
    expect(useAiChatStore.getState().sending).toBe(false);
    expect(container.textContent).not.toContain('stale reply that should never reappear');
  });

  it('clicking "New chat" mid-stream also cancels the in-flight request and discards its late-arriving final message', async () => {
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
    expect(useAiChatStore.getState().sending).toBe(true);

    const newChatButton = container.querySelector('button[aria-label="New chat"]') as HTMLButtonElement;
    await act(async () => {
      newChatButton.click();
    });

    expect(useAiChatStore.getState().sending).toBe(false);
    expect(useAiChatStore.getState().messages).toEqual([]);

    await act(async () => {
      resolveGenerate({ ok: true, text: 'stale reply from before New chat' });
    });
    await flush();

    expect(useAiChatStore.getState().messages).toEqual([]);
    expect(container.textContent).not.toContain('stale reply from before New chat');
  });

  it('a superseded streamed chunk (onChunk firing after Clear) does not repopulate streamingText', async () => {
    let onChunkCb!: (accumulated: string) => void;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      (_baseUrl: string, _prompt: string, opts: { onChunk?: (t: string) => void }) => {
        onChunkCb = opts.onChunk!;
        return new Promise(() => {
          // never resolves — this test only cares about the onChunk guard, not the final message.
        });
      },
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
      onChunkCb('partial stream text');
    });
    expect(container.textContent).toContain('partial stream text');

    const clearButton = container.querySelector('button[aria-label="Clear chat history"]') as HTMLButtonElement;
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await act(async () => {
      clearButton.click();
    });
    confirmSpy.mockRestore();

    // A chunk from the now-superseded generation arrives after the clear — must be discarded.
    await act(async () => {
      onChunkCb('partial stream text MORE STALE TEXT');
    });
    expect(useAiChatStore.getState().streamingText).toBe('');
    expect(container.textContent).not.toContain('MORE STALE TEXT');
  });

  it('strips a <think>...</think> chain-of-thought out of the final reply, showing only the short answer plus a "Show reasoning" toggle (owner-reported rambling-on-"hello" bug)', async () => {
    aiServiceMocks.generateLocalAiResponseStream.mockResolvedValue({
      ok: true,
      text:
        '<think>\nThe user said hello. This is a simple greeting — respond briefly.\n</think>\n' +
        'Hi! How can I help you today?',
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

    // The primary bubble is just the short final answer...
    const bubbles = Array.from(container.querySelectorAll('.rounded-lg')).map((el) => el.textContent);
    expect(bubbles.some((t) => t === 'Hi! How can I help you today?')).toBe(true);
    // ...never the raw chain-of-thought inside that primary answer bubble.
    expect(bubbles.some((t) => t?.includes('This is a simple greeting'))).toBe(false);
    // ...but the reasoning is still available, transparently, behind a COLLAPSED (not open) toggle.
    const details = Array.from(container.querySelectorAll('details')).find(
      (d) => d.querySelector('summary')?.textContent === 'Show reasoning',
    ) as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('This is a simple greeting');

    const stored = useAiChatStore.getState().messages;
    const assistantMessage = stored.find((m) => m.role === 'assistant');
    expect(assistantMessage?.content).toBe('Hi! How can I help you today?');
    expect(assistantMessage?.reasoning).toContain('This is a simple greeting');
  });

  it('shows a "still reasoning" indicator (not raw <think> text) while a chain-of-thought block is streaming in, then reveals the short answer once it arrives', async () => {
    let onChunkCb!: (accumulated: string) => void;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      (_baseUrl: string, _prompt: string, opts: { onChunk?: (t: string) => void }) =>
        new Promise(() => {
          onChunkCb = opts.onChunk!;
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
      onChunkCb('<think>The user said hello, I should be brief');
    });
    // Still inside the reasoning block — must never render the raw chain-of-thought as if it were the answer.
    expect(container.textContent).not.toContain('The user said hello, I should be brief');
    expect(container.textContent).toContain('Reasoning through your question');

    await act(async () => {
      onChunkCb('<think>The user said hello, I should be brief</think>Hi there!');
    });
    // Once the closing tag streams in, the short answer becomes the visible text.
    expect(container.textContent).toContain('Hi there!');
    expect(container.textContent).not.toContain('The user said hello, I should be brief');
  });

  it('shows a "Stop generating" control only while a response is streaming, which cancels via the shared abort mechanism, keeps the partial text visible marked "[stopped]", and re-enables sending immediately', async () => {
    let capturedSignal: AbortSignal | undefined;
    aiServiceMocks.generateLocalAiResponseStream.mockImplementation(
      (_baseUrl: string, _prompt: string, opts: { signal?: AbortSignal; onChunk?: (t: string) => void }) => {
        capturedSignal = opts.signal;
        return new Promise(() => {
          // never resolves in this test — the user cancels before it would.
        });
      },
    );
    useAiChatStore.setState({ hydrated: true });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    // No stop control before anything is sent.
    expect(container.querySelector('button[aria-label="Stop generating"]')).toBeNull();

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

    // The send icon morphs into a stop icon while streaming — not both/either shown at once.
    expect(container.querySelector('button[aria-label="Send"]')).toBeNull();
    const stopButton = container.querySelector('button[aria-label="Stop generating"]') as HTMLButtonElement;
    expect(stopButton).toBeTruthy();
    expect(capturedSignal?.aborted).toBe(false);

    // Some partial text has streamed in before the user decides to stop.
    // (streamingText is set via the store directly here, mirroring what onChunk would do.)
    await act(async () => {
      useAiChatStore.getState().setStreamingText('This is a partial rep');
    });

    await act(async () => {
      stopButton.click();
    });

    // Reuses the exact same cancellation primitives as clear/new-chat — the request's own signal
    // is genuinely aborted, not a second/parallel mechanism.
    expect(capturedSignal?.aborted).toBe(true);
    expect(useAiChatStore.getState().sending).toBe(false);

    // The partial text is KEPT (not discarded) and visibly marked as stopped.
    expect(container.textContent).toContain('This is a partial rep');
    expect(container.textContent).toContain('[stopped]');
    const stored = useAiChatStore.getState().messages;
    expect(stored.at(-1)).toMatchObject({ role: 'assistant', content: 'This is a partial rep', stopped: true });

    // The send button is back immediately, so the user can send a corrected message right away
    // without needing to clear the whole conversation first.
    expect(container.querySelector('button[aria-label="Send"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="Stop generating"]')).toBeNull();
    // Prior conversation (the stopped reply) is still there — stop is not a clear/new-chat.
    expect(container.textContent).toContain('hello');
  });
});
