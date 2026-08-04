import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useAiChatStore, makeMessageId, CHIP_DND_MIME, type AiChatMessage } from '../state/aiChatStore';
import { buildChatMessages, type ChatTurn, type ContextChip } from '../lib/aiChatContext';
import { generateLocalAiChatResponseStream } from '../lib/aiService';
import { parseThinkResponse } from '../lib/ai/thinkParser';
import { shouldAutoScroll } from '../lib/chatScroll';
import { IconChat, IconClose, IconMinimize, IconSend, IconStop, IconTrash } from './icons';

// ============================================================================
// Global, always-available AI chat panel — docked bottom-right, collapsed to
// a small bubble by default, expandable into a real chat window. Only
// rendered at all when Settings -> "Enable AI features" is on (same gate the
// existing AI duplicate-patient check uses), and only ever talks to the same
// local Ollama server (aiService.ts) — see docs/ai-features-setup.md and
// docs/research/ai-chat-assistant-2026-08.md for the full design writeup.
//
// Chips (context) come from elsewhere in the app (e.g. a Patients row) via
// the shared `useAiChatStore`, added either by native HTML5 drag-and-drop
// (dropped on this panel's chip zone) or a "click to attach" button — both
// call the same `addChip` action, so either path produces an identical chip.
// ============================================================================

export function AiChatPanel() {
  const settings = useStore((s) => s.data.settings);
  const data = useStore((s) => s.data);
  const open = useAiChatStore((s) => s.open);
  const chips = useAiChatStore((s) => s.chips);
  const messages = useAiChatStore((s) => s.messages);
  const sending = useAiChatStore((s) => s.sending);
  const streamingText = useAiChatStore((s) => s.streamingText);
  const setOpen = useAiChatStore((s) => s.setOpen);
  const addChip = useAiChatStore((s) => s.addChip);
  const removeChip = useAiChatStore((s) => s.removeChip);
  const addMessage = useAiChatStore((s) => s.addMessage);
  const setSending = useAiChatStore((s) => s.setSending);
  const setStreamingText = useAiChatStore((s) => s.setStreamingText);
  const newChat = useAiChatStore((s) => s.newChat);
  const clearHistory = useAiChatStore((s) => s.clearHistory);
  const hydrate = useAiChatStore((s) => s.hydrate);
  const beginGeneration = useAiChatStore((s) => s.beginGeneration);
  const isGenerationCurrent = useAiChatStore((s) => s.isGenerationCurrent);
  const stopGeneration = useAiChatStore((s) => s.stopGeneration);

  const [input, setInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  // "Sticky scroll": whether the view is (or was, at the last scroll event) at/near the bottom —
  // see lib/chatScroll.ts. Starts true so a freshly-opened panel still lands on the latest message.
  const [stickToBottom, setStickToBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // One-time load of any persisted conversation from IndexedDB. Runs even
  // while collapsed (the bubble's chip-count badge should be correct without
  // the user having to open the panel first).
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Only auto-scroll to the bottom on new content (a new message, or a streamed chunk) when the
  // user was already at/near the bottom — otherwise a reader who has scrolled up to an earlier
  // message would get yanked back down on every token (2026-08-04 owner-reported bug). `stickToBottom`
  // is kept up to date by the message list's own onScroll handler below.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, sending, streamingText, stickToBottom]);

  function handleTranscriptScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setStickToBottom(shouldAutoScroll(el.scrollTop, el.scrollHeight, el.clientHeight));
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ top: el.scrollHeight });
    setStickToBottom(true);
  }

  if (!settings.aiFeaturesEnabled) return null;

  function handleClearHistory() {
    if (messages.length === 0 && chips.length === 0) return;
    const confirmed = window.confirm(
      'Clear this AI chat conversation? This deletes it from this laptop and cannot be undone.',
    );
    if (confirmed) clearHistory();
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(CHIP_DND_MIME);
    if (!raw) return;
    try {
      const chip = JSON.parse(raw) as ContextChip;
      if (chip?.id && chip?.type && chip?.recordId) addChip(chip);
    } catch {
      // Not one of our chip payloads — ignore silently.
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');

    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));
    const attachedChips = [...chips];
    const userMessage: AiChatMessage = {
      id: makeMessageId(),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      chips: attachedChips,
    };
    addMessage(userMessage);
    setSending(true);
    setStreamingText('');

    const { messages: chatMessages, contextBlock, retrievedSources } = await buildChatMessages({
      history,
      chips: attachedChips,
      data,
      userMessage: text,
    });
    // Tag this send with a fresh generation id + AbortController (see aiChatStore.ts
    // `beginGeneration`/`isGenerationCurrent`) — clicking "Clear chat history" or "New chat" while
    // this request is in flight aborts the controller AND bumps the id, so a late-arriving chunk or
    // final message below can tell it's stale and must discard itself instead of writing into a
    // conversation the user has since cleared/moved on from (2026-08-04 owner-reported race fix).
    const { id: generationId, signal } = beginGeneration();
    // Streamed (Ollama `/api/chat` with `stream: true`) so the panel can render tokens as they
    // arrive instead of a blank spinner for the whole reply — see aiService.ts for both the
    // inactivity-reset timeout that makes this faster-feeling/safer against premature timeouts,
    // and why this uses the structured-messages `/api/chat` endpoint rather than a flattened
    // prompt string (2026-08-04 "hallucinated fake conversation" bug fix).
    const result = await generateLocalAiChatResponseStream(settings.aiServiceBaseUrl, chatMessages, {
      signal,
      onChunk: (accumulated) => {
        if (isGenerationCurrent(generationId)) setStreamingText(accumulated);
      },
    });

    // The chat may have been cleared/restarted while this request was still running — discard a
    // superseded result silently rather than reappending it into (or overwriting) whatever the
    // user has since started. No error toast: this is the deliberate, expected outcome of a
    // user-initiated cancellation, not a failure.
    if (!isGenerationCurrent(generationId)) return;

    if (result.ok) {
      // Phi-4-mini-reasoning always emits a `<think>...</think>` chain-of-thought before its
      // real answer (see lib/ai/thinkParser.ts) — split that out here so `content` (the primary
      // bubble) is just the short final answer, with the reasoning trace kept for the "Show
      // reasoning" disclosure below rather than either being shown inline or thrown away.
      const { answer, reasoning } = parseThinkResponse(result.text);
      addMessage({
        id: makeMessageId(),
        role: 'assistant',
        content: answer || result.text.trim(),
        createdAt: Date.now(),
        reasoning: reasoning || undefined,
        contextUsed: contextBlock || undefined,
        retrievedSources: retrievedSources.length ? retrievedSources : undefined,
      });
    } else {
      addMessage({
        id: makeMessageId(),
        role: 'assistant',
        content: "Couldn't reach the local AI model.",
        createdAt: Date.now(),
        error: result.error,
        contextUsed: contextBlock || undefined,
        retrievedSources: retrievedSources.length ? retrievedSources : undefined,
      });
    }
    setStreamingText('');
    setSending(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="fixed bottom-5 right-5 z-40 rounded-full shadow-xl flex items-center justify-center"
        style={{ width: 52, height: 52, background: 'var(--accent)', color: 'var(--accent-fg)' }}
        onClick={() => setOpen(true)}
        aria-label="Open AI assistant"
        title="AI assistant"
      >
        <IconChat width={22} height={22} />
        {chips.length > 0 && (
          <span
            className="absolute -top-1 -right-1 rounded-full text-[10px] font-bold flex items-center justify-center"
            style={{ width: 18, height: 18, background: 'var(--danger)', color: 'var(--danger-fg)' }}
            aria-label={`${chips.length} context chip(s) attached`}
          >
            {chips.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      className="card fixed bottom-5 right-5 z-40 flex flex-col shadow-xl"
      style={{ width: 380, maxWidth: 'calc(100vw - 2rem)', height: 520, maxHeight: 'calc(100dvh - 2.5rem)' }}
      role="dialog"
      aria-label="AI assistant"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <IconChat width={16} height={16} />
          <h2 className="text-sm font-bold truncate">AI assistant (beta)</h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" className="btn btn-icon btn-ghost" onClick={newChat} aria-label="New chat" title="New chat">
            <span className="text-xs font-semibold px-1">New</span>
          </button>
          <button
            type="button"
            className="btn btn-icon btn-ghost"
            onClick={handleClearHistory}
            aria-label="Clear chat history"
            title="Clear chat history — permanently deletes this conversation from this laptop"
            disabled={messages.length === 0 && chips.length === 0}
          >
            <IconTrash width={14} height={14} />
          </button>
          <button type="button" className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Minimize" title="Minimize">
            <IconMinimize width={14} height={14} />
          </button>
        </div>
      </div>

      <p
        className="px-3 py-1.5 text-[11px] shrink-0 border-b"
        style={{ color: 'var(--muted)', borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      >
        Runs 100% locally — no patient data leaves this laptop. Conversation is saved on this device only; use the
        trash icon above to clear it.
      </p>

      <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleTranscriptScroll} className="h-full overflow-y-auto px-3 py-2 space-y-3">
        {messages.length === 0 && (
          <p className="text-xs text-center py-6" style={{ color: 'var(--muted)' }}>
            Ask a question, or drag a patient in as context below first.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <div
              className="rounded-lg px-2.5 py-1.5 whitespace-pre-wrap"
              style={
                m.role === 'user'
                  ? { background: 'var(--accent-soft)', color: 'var(--text)', marginLeft: '2rem' }
                  : { background: 'var(--surface-2)', color: 'var(--text)', marginRight: '2rem' }
              }
            >
              {m.role === 'user' && m.chips && m.chips.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {m.chips.map((c) => (
                    <span key={c.id} className="badge" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                      {c.label}
                    </span>
                  ))}
                </div>
              )}
              {m.content}
              {m.stopped && (
                <span
                  className="ml-1 text-[10px] font-semibold uppercase align-middle"
                  style={{ color: 'var(--muted)' }}
                  title="Generation was stopped before it finished — this is the partial reply streamed so far."
                >
                  [stopped]
                </span>
              )}
              {m.error && (
                <p className="text-xs mt-1" style={{ color: 'var(--danger-fg)' }}>
                  {m.error}
                </p>
              )}
            </div>
            {m.role === 'assistant' && m.reasoning && (
              <details className="mt-1" style={{ marginRight: '2rem' }}>
                <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--accent)' }}>
                  Show reasoning
                </summary>
                <pre
                  className="text-[10px] mt-1 p-2 rounded whitespace-pre-wrap"
                  style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
                >
                  {m.reasoning}
                </pre>
              </details>
            )}
            {m.role === 'assistant' && m.retrievedSources && m.retrievedSources.length > 0 && (
              <details className="mt-1" style={{ marginRight: '2rem' }}>
                <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--accent)' }}>
                  Sources ({m.retrievedSources.length})
                </summary>
                <div className="text-[10px] mt-1 p-2 rounded space-y-2" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
                  {m.retrievedSources.map((s, idx) => (
                    <div key={`${s.sourceDocId}-${idx}`}>
                      <div className="font-medium">
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                            {s.title}
                          </a>
                        ) : (
                          s.title
                        )}
                      </div>
                      <p className="whitespace-pre-wrap mt-0.5">{s.excerpt}</p>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {m.role === 'assistant' && m.contextUsed && (
              <details className="mt-1" style={{ marginRight: '2rem' }}>
                <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--accent)' }}>
                  Context used
                </summary>
                <pre
                  className="text-[10px] mt-1 p-2 rounded whitespace-pre-wrap"
                  style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
                >
                  {m.contextUsed}
                </pre>
              </details>
            )}
          </div>
        ))}
        {sending && (() => {
          // Parse the raw accumulated stream so the model's `<think>...</think>` chain-of-thought
          // is handled the same way Cursor's own chat shows its reasoning: VISIBLE and streaming
          // live while it's in progress (not hidden behind an opaque placeholder), then collapsed
          // down to the same "Show reasoning" toggle a finished message ends at once the real
          // answer starts arriving — see thinkParser.ts for the underlying open/closed-tag state
          // this is purely a UI decision on top of (2026-08-04 owner ask: "stream the reasoning
          // live... instead of hiding it until after").
          const parsed = parseThinkResponse(streamingText);
          const reasoningDone = !parsed.thinking && !!parsed.reasoning;
          return (
            <div className="text-sm" style={{ marginRight: '2rem' }}>
              {parsed.thinking && (
                <div
                  className="rounded-lg px-2.5 py-1.5 mb-1 text-xs whitespace-pre-wrap max-h-40 overflow-y-auto"
                  style={{ background: 'var(--surface-2)', color: 'var(--muted)', fontStyle: 'italic' }}
                  aria-label="Reasoning in progress"
                >
                  <div className="flex items-center gap-1.5 mb-1 not-italic font-semibold" style={{ color: 'var(--muted)' }}>
                    <span className="spinner" aria-hidden="true" style={{ width: 10, height: 10 }} />
                    Reasoning…
                  </div>
                  {parsed.reasoning || 'Starting to reason through your question…'}
                  <span className="inline-block ml-1 animate-pulse" aria-hidden="true">
                    ▍
                  </span>
                </div>
              )}
              {reasoningDone && (
                <details className="mb-1" open={false}>
                  <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--accent)' }}>
                    Show reasoning
                  </summary>
                  <pre
                    className="text-[10px] mt-1 p-2 rounded whitespace-pre-wrap"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
                  >
                    {parsed.reasoning}
                  </pre>
                </details>
              )}
              {parsed.answer ? (
                <div
                  className="rounded-lg px-2.5 py-1.5 whitespace-pre-wrap"
                  style={{ background: 'var(--surface-2)', color: 'var(--text)' }}
                >
                  {parsed.answer}
                  <span className="inline-block ml-1 animate-pulse" aria-hidden="true">
                    ▍
                  </span>
                </div>
              ) : (
                !parsed.thinking && (
                  <div className="rounded-lg px-2.5 py-1.5 inline-flex items-center gap-2" style={{ background: 'var(--surface-2)' }}>
                    <span className="spinner" aria-hidden="true" />
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      {reasoningDone
                        ? 'Reasoning finished — writing the answer now…'
                        : 'Thinking… small on-device models can take 30–90 seconds on this hardware, longer ' +
                          '(up to a few minutes) right after Ollama has just started.'}
                    </span>
                  </div>
                )
              )}
            </div>
          );
        })()}
      </div>
      {!stickToBottom && (
        <button
          type="button"
          className="btn btn-ghost absolute bottom-2 left-1/2 -translate-x-1/2 text-xs shadow"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          onClick={jumpToBottom}
        >
          New messages ↓
        </button>
      )}
      </div>

      <div
        className="shrink-0 border-t px-3 py-2"
        style={{ borderColor: 'var(--border)', background: dragOver ? 'var(--accent-soft)' : undefined }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(CHIP_DND_MIME)) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {chips.map((c) => (
              <span
                key={c.id}
                className="badge inline-flex items-center gap-1"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {c.label}
                <button
                  type="button"
                  onClick={() => removeChip(c.id)}
                  aria-label={`Remove ${c.label} from context`}
                  className="leading-none"
                  style={{ color: 'inherit' }}
                >
                  <IconClose width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {dragOver && chips.length === 0 && (
          <p className="text-xs mb-2 text-center" style={{ color: 'var(--accent)' }}>
            Drop to attach as context
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            className="textarea flex-1 resize-none"
            rows={2}
            placeholder="Ask about a patient, ACC rules, or how to do something…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {sending ? (
            <button
              type="button"
              className="btn btn-danger btn-icon"
              onClick={() => stopGeneration()}
              aria-label="Stop generating"
              title="Stop generating — keeps whatever has streamed back so far, marked as stopped"
            >
              <IconStop width={16} height={16} />
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-icon"
              onClick={() => void send()}
              disabled={!input.trim()}
              aria-label="Send"
            >
              <IconSend width={16} height={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
