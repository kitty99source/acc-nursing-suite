import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useAiChatStore, makeMessageId, CHIP_DND_MIME, type AiChatMessage } from '../state/aiChatStore';
import { buildChatPrompt, type ChatTurn, type ContextChip } from '../lib/aiChatContext';
import { generateLocalAiResponse } from '../lib/aiService';
import { IconChat, IconClose, IconMinimize, IconSend } from './icons';

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
  const setOpen = useAiChatStore((s) => s.setOpen);
  const addChip = useAiChatStore((s) => s.addChip);
  const removeChip = useAiChatStore((s) => s.removeChip);
  const addMessage = useAiChatStore((s) => s.addMessage);
  const setSending = useAiChatStore((s) => s.setSending);
  const newChat = useAiChatStore((s) => s.newChat);

  const [input, setInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, sending]);

  if (!settings.aiFeaturesEnabled) return null;

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

    const { prompt, contextBlock } = buildChatPrompt({ history, chips: attachedChips, data, userMessage: text });
    const result = await generateLocalAiResponse(settings.aiServiceBaseUrl, prompt);

    if (result.ok) {
      addMessage({
        id: makeMessageId(),
        role: 'assistant',
        content: result.text.trim(),
        createdAt: Date.now(),
        contextUsed: contextBlock || undefined,
      });
    } else {
      addMessage({
        id: makeMessageId(),
        role: 'assistant',
        content: "Couldn't reach the local AI model.",
        createdAt: Date.now(),
        error: result.error,
        contextUsed: contextBlock || undefined,
      });
    }
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
          <button type="button" className="btn btn-icon" onClick={() => setOpen(false)} aria-label="Minimize" title="Minimize">
            <IconMinimize width={14} height={14} />
          </button>
        </div>
      </div>

      <p
        className="px-3 py-1.5 text-[11px] shrink-0 border-b"
        style={{ color: 'var(--muted)', borderColor: 'var(--border)', background: 'var(--surface-2)' }}
      >
        Runs 100% locally — no patient data leaves this laptop.
      </p>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
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
              {m.error && (
                <p className="text-xs mt-1" style={{ color: 'var(--danger-fg)' }}>
                  {m.error}
                </p>
              )}
            </div>
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
        {sending && (
          <div className="text-sm" style={{ marginRight: '2rem' }}>
            <div className="rounded-lg px-2.5 py-1.5 inline-flex items-center gap-2" style={{ background: 'var(--surface-2)' }}>
              <span className="spinner" aria-hidden="true" />
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Thinking… (a local reasoning model can take up to a minute)
              </span>
            </div>
          </div>
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
          <button
            type="button"
            className="btn btn-primary btn-icon"
            onClick={() => void send()}
            disabled={sending || !input.trim()}
            aria-label="Send"
          >
            <IconSend width={16} height={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
