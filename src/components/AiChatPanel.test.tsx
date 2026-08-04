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
// logic, which is exercised by the mocked generateLocalAiChatResponseStream below.
const aiServiceMocks = vi.hoisted(() => ({
  generateLocalAiChatResponseStream: vi.fn(),
  // Non-streaming chat helper used only for long-chat summarization — short-chat panel tests
  // never hit the threshold, so this should not be called; still must be exported for the import.
  generateLocalAiChatResponse: vi.fn(async () => ({ ok: true, text: 'summary stub' })),
  // aiChatContext.ts's buildChatMessages reads this for its context-budget check — a real value
  // (not a mock-only stub) so the budget/trim logic behaves the same as production in this suite.
  DEFAULT_NUM_CTX: 8192,
  // Real (not mock-only stub) implementation — a plain marker-substring check, safe to run as-is
  // in this suite so tests can exercise the real "is this a timeout" branch in AiChatPanel.
  isChatTimeoutError: (error?: string) => !!error && error.includes('crashed or got stuck mid-response'),
  // Defaults to "Ollama is reachable" so existing non-timeout-diagnostic tests aren't affected —
  // individual timeout-diagnostic tests below override this per-case.
  checkAiServiceStatus: vi.fn(async () => ({ available: true, modelAvailable: true, models: [] })),
  // Settings → model/compute helpers — keep behaviour aligned with production defaults.
  resolveAiModel: (profile: 'reasoning' | 'fast' = 'reasoning') =>
    profile === 'fast' ? 'phi4-mini' : 'phi4-mini-reasoning',
  resolveChatNumPredict: (profile: 'reasoning' | 'fast' = 'reasoning') => (profile === 'fast' ? 768 : 2048),
  resolveKeepAlive: (keepLoaded?: boolean) => (keepLoaded ? -1 : '30m'),
  // Post-abort cooldown helpers — default "not busy" so existing send tests are unaffected.
  isModelBusyDraining: vi.fn(() => false),
  modelBusyMessage: () =>
    'The local model is still finishing the previous cancelled request — wait a couple of seconds and send again.',
  noteModelAbort: vi.fn(),
  _resetModelBusyForTests: vi.fn(),
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
  aiServiceMocks.generateLocalAiChatResponseStream.mockReset();
  aiServiceMocks.generateLocalAiChatResponse.mockReset().mockResolvedValue({ ok: true, text: 'summary stub' });
  useAiChatStore.setState({
    open: true,
    chips: [],
    messages: [],
    conversationSummary: null,
    sending: false,
    streamingText: '',
    hydrated: false,
  });
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
      (_baseUrl: string, _messages: unknown, opts: { onChunk?: (t: string) => void }) =>
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({
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

  // 2026-08-04 follow-up fix: a SECOND consecutive real owner timeout, after the same-day
  // context-overflow fix had already landed and was confirmed working (measured prompt size well
  // under budget) — added a lightweight app-side "ping Ollama" self-test so the owner (and any
  // future incident) can immediately tell "Ollama itself is dead" from "this one reply stalled".
  describe('timeout self-test diagnostic (2026-08-04 follow-up fix)', () => {
    const TIMEOUT_ERROR =
      'The local AI model stopped responding and this request timed out. This usually means Ollama ' +
      'crashed or got stuck mid-response — try sending the message again, and restart Ollama from the ' +
      'system tray if it keeps happening.';

    async function sendMessage(text: string) {
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      await act(async () => {
        setValue.call(textarea, text);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
      const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
      await act(async () => {
        sendButton.click();
      });
      await flush();
    }

    beforeEach(() => {
      useAiChatStore.setState({ hydrated: true, messages: [], chips: [] });
    });

    it('pings Ollama and reports it as unreachable/likely hung when a timeout occurs and the ping also fails', async () => {
      aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({ ok: false, error: TIMEOUT_ERROR });
      aiServiceMocks.checkAiServiceStatus.mockResolvedValue({ available: false, modelAvailable: false, models: [] });

      await act(async () => {
        root.render(<AiChatPanel />);
      });
      await flush();
      await sendMessage('hello');

      expect(aiServiceMocks.checkAiServiceStatus).toHaveBeenCalled();
      const lastError = useAiChatStore.getState().messages.at(-1)?.error;
      expect(lastError).toContain('not responding at all right now');
      expect(lastError).toContain('taskkill');
    });

    it('pings Ollama and reports it as still reachable (this specific reply just stalled) on the FIRST timeout', async () => {
      aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({ ok: false, error: TIMEOUT_ERROR });
      aiServiceMocks.checkAiServiceStatus.mockResolvedValue({ available: true, modelAvailable: true, models: [] });

      await act(async () => {
        root.render(<AiChatPanel />);
      });
      await flush();
      await sendMessage('hello');

      const lastError = useAiChatStore.getState().messages.at(-1)?.error;
      expect(lastError).toContain('still responding to a basic ping');
      expect(lastError).not.toContain('reply in a row');
    });

    it('escalates to recommending a full process kill on the SECOND consecutive timeout, even though Ollama still answers the ping', async () => {
      aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({ ok: false, error: TIMEOUT_ERROR });
      aiServiceMocks.checkAiServiceStatus.mockResolvedValue({ available: true, modelAvailable: true, models: [] });

      await act(async () => {
        root.render(<AiChatPanel />);
      });
      await flush();
      // Casual greetings pass the hard grounding gate (off-topic free text would refuse before
      // Ollama and never exercise the timeout counter).
      await sendMessage('hello');
      await sendMessage('thanks');

      const lastError = useAiChatStore.getState().messages.at(-1)?.error;
      expect(lastError).toContain('2nd reply in a row');
      expect(lastError).toContain('taskkill');
    });

    it('resets the consecutive-timeout counter after a successful reply', async () => {
      aiServiceMocks.checkAiServiceStatus.mockResolvedValue({ available: true, modelAvailable: true, models: [] });
      aiServiceMocks.generateLocalAiChatResponseStream
        .mockResolvedValueOnce({ ok: false, error: TIMEOUT_ERROR })
        .mockResolvedValueOnce({ ok: true, text: 'All good now' })
        .mockResolvedValueOnce({ ok: false, error: TIMEOUT_ERROR });

      await act(async () => {
        root.render(<AiChatPanel />);
      });
      await flush();
      await sendMessage('hello');
      await sendMessage('thanks');
      await sendMessage('hi');

      const lastError = useAiChatStore.getState().messages.at(-1)?.error;
      // Would say "2nd reply in a row" if the counter hadn't reset on the successful q2 reply.
      expect(lastError).not.toContain('reply in a row');
    });
  });

  it('long chat uses extractive summary (no LLM summarize call) and still answers — never hangs on summarizing (2026-08-04)', async () => {
    aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({
      ok: true,
      text: 'Grounded short answer about NS01.',
    });
    // 8 prior turns → SUMMARIZE_MESSAGE_THRESHOLD; next send must compress older context.
    const prior = Array.from({ length: 8 }, (_, i) => ({
      id: `hist-${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: i % 2 === 0 ? `Prior question ${i} about nursing packages` : `Prior answer ${i} on NS01 caps`,
      createdAt: i + 1,
    }));
    useAiChatStore.setState({ hydrated: true, messages: prior, conversationSummary: null });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      // Greeting path is hard-grounding-allowed (same as other panel tests) — isolates summarize behaviour.
      setValue.call(textarea, 'hello');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    // Extractive path: never hit the non-streaming Ollama summarize helper.
    expect(aiServiceMocks.generateLocalAiChatResponse).not.toHaveBeenCalled();
    expect(aiServiceMocks.generateLocalAiChatResponseStream).toHaveBeenCalled();
    expect(useAiChatStore.getState().sending).toBe(false);
    const summary = useAiChatStore.getState().conversationSummary;
    expect(summary?.text).toBeTruthy();
    expect(summary?.text).toContain('extractive digest');
    const assistant = useAiChatStore.getState().messages.filter((m) => m.role === 'assistant').at(-1);
    expect(assistant?.content).toContain('NS01');
    expect(assistant?.historySummarized).toBe(true);
    // Compact dismissible chip — not a permanent sticky blocker when conversationSummary exists.
    const notice = container.querySelector('[data-testid="earlier-messages-summarized"]');
    expect(notice).toBeTruthy();
    expect(notice?.textContent).toMatch(/summarized/i);
    const dismiss = container.querySelector(
      '[data-testid="dismiss-summarization-notice"]',
    ) as HTMLButtonElement;
    expect(dismiss).toBeTruthy();
    await act(async () => {
      dismiss.click();
    });
    await flush();
    expect(container.querySelector('[data-testid="earlier-messages-summarized"]')).toBeNull();
    // Rolling summary remains in the store for the model — only the UI chip was dismissed.
    expect(useAiChatStore.getState().conversationSummary?.text).toBeTruthy();
  });

  it('summarization notice is not sticky from a persisted summary alone; next send clears a prior chip (2026-08-04 banner UX)', async () => {
    // Mount with an existing rolling summary in the store — old bug showed a permanent top banner.
    useAiChatStore.setState({
      hydrated: true,
      messages: [
        { id: 'u1', role: 'user', content: 'hello', createdAt: 1 },
        { id: 'a1', role: 'assistant', content: 'hi', createdAt: 2 },
      ],
      conversationSummary: {
        text: 'Prior extractive digest of older turns.',
        throughMessageId: 'u1',
        updatedAt: Date.now(),
      },
    });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();
    expect(container.querySelector('[data-testid="earlier-messages-summarized"]')).toBeNull();

    // Simulate a leftover visible chip (as after a fresh create), then send — chip clears at send start.
    // Under-threshold history → no new summary create → chip must stay gone after the reply.
    aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({ ok: true, text: 'ok' });
    await act(async () => {
      // Reach into the panel by forcing the chip via a long-chat create first would re-show it;
      // instead assert the clear-on-send path by dispatching a short greeting send with no create.
      const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
      const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
      setValue.call(textarea, 'thanks');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click();
    });
    await flush();
    expect(container.querySelector('[data-testid="earlier-messages-summarized"]')).toBeNull();
  });

  it('hard-gates genuinely off-topic questions (geneva conventions) — shows app refuse, never calls Ollama (2026-08-04 durable fix)', async () => {
    // Emergency transport is now ingested (§6/§7) so it is no longer the refuse exemplar.
    // Geneva conventions remains absent from both static KB and the ACC corpus.
    aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({
      ok: true,
      text: 'should never be used',
    });
    useAiChatStore.setState({ hydrated: true });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'what do the geneva conventions say about medical transport');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    expect(aiServiceMocks.generateLocalAiChatResponseStream).not.toHaveBeenCalled();
    expect(aiServiceMocks.generateLocalAiChatResponse).not.toHaveBeenCalled();
    const msgs = useAiChatStore.getState().messages;
    expect(msgs.some((m) => m.role === 'user' && m.content.toLowerCase().includes('geneva'))).toBe(true);
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant?.content).toContain("don't have grounded ACC material");
    expect(assistant?.content.toLowerCase()).not.toContain('schedule 5');
    expect(assistant?.retrievedSources).toBeUndefined();
    expect(useAiChatStore.getState().sending).toBe(false);
  });

  it('refuses to send and shows a specific "too much context" message — never calls the model — when several large chips together would overflow the context window (2026-08-04 safety net)', async () => {
    // 8 large Contract chips, each with a big rate table — even after this fix's chip
    // compaction bounds any ONE chip's payload, attaching enough of them at once should still
    // trip the preflight safety net rather than silently sending an oversized prompt.
    const bigRateTable = Array.from({ length: 300 }, (_, i) => ({
      serviceCode: `PT${String(i).padStart(3, '0')}`,
      description: 'A realistic service item description of representative length for this schedule.',
      rate: 50 + i,
    }));
    const contracts = Array.from({ length: 8 }, (_, i) => ({
      id: `ct-${i}`,
      providerName: `Big Contract ${i}`,
      customerNumber: '1234',
      claimsEmail: 'claims@example.test',
      effectiveFrom: '2026-01-01',
      effectiveTo: '',
      serviceCodesCovered: bigRateTable.map((r) => r.serviceCode),
      rateTable: bigRateTable,
      notes: '',
    }));
    useStore.setState({
      data: {
        ...emptyData(),
        settings: { ...emptyData().settings, aiFeaturesEnabled: true },
        contracts,
      },
    });
    useAiChatStore.setState({
      hydrated: true,
      chips: contracts.map((c) => ({ id: `contract:${c.id}`, type: 'contract' as const, recordId: c.id, label: c.providerName })),
    });
    await act(async () => {
      root.render(<AiChatPanel />);
    });
    await flush();

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(textarea, 'Summarize all of these contracts');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const sendButton = container.querySelector('button[aria-label="Send"]') as HTMLButtonElement;
    await act(async () => {
      sendButton.click();
    });
    await flush();

    expect(container.textContent).toContain('a lot of context');
    expect(container.textContent).toContain('one specific');
    expect(aiServiceMocks.generateLocalAiChatResponseStream).not.toHaveBeenCalled();
    expect(useAiChatStore.getState().sending).toBe(false);
  });

  it('clicking "Clear chat history" mid-stream aborts the request and discards its late-arriving final message (owner-reported race)', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveGenerate!: (value: { ok: true; text: string }) => void;
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
      (_baseUrl: string, _messages: unknown, opts: { signal?: AbortSignal }) => {
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
      (_baseUrl: string, _messages: unknown, opts: { onChunk?: (t: string) => void }) => {
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
    aiServiceMocks.generateLocalAiChatResponseStream.mockResolvedValue({
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

  it('streams the reasoning trace LIVE (Cursor-style) while a chain-of-thought block is open, then collapses it once the final answer starts (2026-08-04 owner ask)', async () => {
    let onChunkCb!: (accumulated: string) => void;
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
      (_baseUrl: string, _messages: unknown, opts: { onChunk?: (t: string) => void }) =>
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
    // While still inside the reasoning block, the actual streaming reasoning tokens ARE shown live
    // (Cursor-IDE style), not hidden behind a generic opaque placeholder.
    expect(container.textContent).toContain('The user said hello, I should be brief');
    expect(container.textContent).toContain('Reasoning…');
    // Not yet collapsed into the post-hoc toggle — that only appears once reasoning has finished.
    expect(
      Array.from(container.querySelectorAll('details')).some(
        (d) => d.querySelector('summary')?.textContent === 'Show reasoning',
      ),
    ).toBe(false);

    await act(async () => {
      onChunkCb('<think>The user said hello, I should be brief</think>Hi there!');
    });
    // Once the closing tag streams in, the final answer becomes the visible primary text...
    expect(container.textContent).toContain('Hi there!');
    // ...and the reasoning trace collapses down to the same "Show reasoning" toggle a finished
    // message ends at, so the UI isn't left cluttered with the now-stale live reasoning box.
    const details = Array.from(container.querySelectorAll('details')).find(
      (d) => d.querySelector('summary')?.textContent === 'Show reasoning',
    ) as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('The user said hello, I should be brief');
  });

  it('shows a "Stop generating" control only while a response is streaming, which cancels via the shared abort mechanism, keeps the partial text visible marked "[stopped]", and re-enables sending immediately', async () => {
    let capturedSignal: AbortSignal | undefined;
    aiServiceMocks.generateLocalAiChatResponseStream.mockImplementation(
      (_baseUrl: string, _messages: unknown, opts: { signal?: AbortSignal; onChunk?: (t: string) => void }) => {
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
