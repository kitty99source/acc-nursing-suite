// ============================================================================
// Global AI chat panel state: which record chips are attached, the ongoing
// conversation, and whether the panel is expanded. Deliberately a SEPARATE,
// tiny zustand store from the main `useStore` (state/store.ts) rather than a
// slice of it — chips are added from places that aren't descendants of the
// chat panel component (e.g. a row in Patients), so this needs to be a
// shared store independent of the main app's data-mutation actions.
//
// PERSISTENCE (2026-08-04): messages/chips are now persisted to their own
// IndexedDB key (see lib/idb.ts `loadAiChatHistory`/`saveAiChatHistory`) so a
// conversation survives a page reload — per owner request, conditional on
// verifying the local Ollama integration makes zero external network calls
// (confirmed clean; see docs/research/ai-chat-assistant-2026-08.md "Telemetry
// / data-leak verification"). This is still deliberately a SEPARATE key from
// the main IndexedDB-backed autosave blob, and is NEVER written into `AppData`
// — so it stays out of `.accdata` saves, the Excel export, and the full
// backup ZIP, exactly like the existing audit log / staging queue / import
// history keys. A history may contain PHI (patient chip context, free-text
// questions), so there is always an explicit, one-click `clearHistory` wipe
// (see AiChatPanel's "Clear chat history" button).
//
// Settings gate: `AiChatPanel` renders `null` when Settings → "Enable AI
// features" is off (same as today). Turning that toggle off only hides the
// panel's entry point — it deliberately does NOT auto-clear history, so a
// user who briefly disables AI features doesn't lose a real conversation by
// accident. Wiping history is always the owner's explicit "Clear chat
// history" action, never an implicit side effect of a Settings toggle.
// ============================================================================

import { create } from 'zustand';
import type { AiChatMessage, ContextChip } from '../lib/aiChatContext';
import { clearAiChatHistory, loadAiChatHistory, saveAiChatHistory } from '../lib/idb';
import { parseThinkResponse } from '../lib/ai/thinkParser';

// Re-exported for backwards compatibility with existing callers — the type
// itself now lives in lib/aiChatContext.ts (see that file for why: it avoids
// a real idb.ts <-> aiChatStore.ts circular import).
export type { AiChatMessage };

interface AiChatState {
  open: boolean;
  chips: ContextChip[];
  messages: AiChatMessage[];
  sending: boolean;
  /**
   * Live-accumulated text of the in-flight streamed reply, so the panel can render tokens as
   * they arrive instead of a blank spinner for the whole reply duration (see aiService.ts
   * `generateLocalAiChatResponseStream`). '' while nothing has streamed back yet (still cold-starting
   * / thinking); reset to '' once the final message is appended via `addMessage`.
   */
  streamingText: string;
  /** True once the one-time load from IndexedDB has completed (or found nothing). */
  hydrated: boolean;
  /**
   * Monotonic id identifying the current (or most recently started) generation/send. Bumped by
   * `beginGeneration` and again by `clearHistory`/`newChat` — a streamed chunk or final message
   * belonging to an OLDER id than whatever is currently active is stale (the user cleared the
   * chat or started a new one while that request was still in flight) and must be discarded
   * instead of written into the store. This is the defense-in-depth half of the clear/new-chat
   * cancellation fix (2026-08-04 owner-reported race: clicking the trash icon mid-stream did not
   * actually stop the old response, which then reappeared once it finished) — the `AbortController`
   * below is the other half, but abort isn't always instant (e.g. mid-chunk-processing inside the
   * `for await`-style read loop in aiService.ts), so this id check is what actually guarantees a
   * superseded response can never land in the store no matter when its abort takes effect.
   */
  activeGenerationId: number;
  /**
   * AbortController for the in-flight request started by the most recent `beginGeneration` call,
   * if any. `clearHistory`/`newChat` abort this before wiping the conversation, so the underlying
   * fetch is actually cancelled instead of merely orphaned (left running in the background with no
   * one caring about its result).
   */
  activeAbortController: AbortController | null;
  /**
   * Starts a new generation: bumps `activeGenerationId`, creates a fresh `AbortController`, and
   * returns both so the caller (AiChatPanel's `send()`) can pass the signal into the request and
   * later confirm — via `isGenerationCurrent` — whether its result is still wanted before writing
   * anything into the store.
   */
  beginGeneration: () => { id: number; signal: AbortSignal };
  /** True if `id` is still the active (not superseded by a later send/clear/new-chat) generation. */
  isGenerationCurrent: (id: number) => boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  addChip: (chip: ContextChip) => void;
  removeChip: (id: string) => void;
  clearChips: () => void;
  addMessage: (message: AiChatMessage) => void;
  setSending: (sending: boolean) => void;
  setStreamingText: (text: string) => void;
  newChat: () => void;
  /** One-time load of any persisted conversation from IndexedDB. Safe to call more than once — a no-op after the first. */
  hydrate: () => Promise<void>;
  /** Wipes the conversation from both memory and IndexedDB. Used by the panel's "Clear chat history" button. */
  clearHistory: () => void;
  /**
   * Cancels the in-flight generation WITHOUT wiping the conversation — the "Stop generating"
   * button's action, deliberately distinct from `clearHistory`/`newChat` (see owner request
   * 2026-08-04: they want to stop and correct a bad response mid-stream, not lose the whole
   * conversation to do it). Reuses the exact same cancellation primitives
   * (`activeAbortController.abort()` + bumping `activeGenerationId` so any late chunk/final result
   * is recognised as stale by `isGenerationCurrent`) — this is NOT a second, parallel cancellation
   * path. Whatever text had streamed back so far (`streamingText`) is appended as a real assistant
   * message marked `stopped: true` so it stays visible in the transcript instead of vanishing (the
   * `<think>` chain-of-thought, if any was still open, is stripped via the same `parseThinkResponse`
   * used for a normal completed reply — a stopped mid-reasoning block has no useful "answer" text,
   * so no message is appended for that case). A no-op (safe to call) if nothing is generating.
   */
  stopGeneration: () => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/** Fire-and-forget persist of the current conversation. Never throws into the caller — a failed local save should not break the chat UI. */
function persist(messages: AiChatMessage[], chips: ContextChip[]): void {
  void saveAiChatHistory({ messages, chips, savedAt: Date.now() }).catch(() => {
    // Best-effort only — same graceful-degradation contract as the rest of the AI integration.
  });
}

export const useAiChatStore = create<AiChatState>((set, get) => ({
  open: false,
  chips: [],
  messages: [],
  sending: false,
  streamingText: '',
  hydrated: false,
  activeGenerationId: 0,
  activeAbortController: null,
  beginGeneration: () => {
    const controller = new AbortController();
    const id = get().activeGenerationId + 1;
    set({ activeGenerationId: id, activeAbortController: controller });
    return { id, signal: controller.signal };
  },
  isGenerationCurrent: (id) => get().activeGenerationId === id,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  addChip: (chip) =>
    set((s) => {
      if (s.chips.some((c) => c.id === chip.id)) return s;
      const chips = [...s.chips, chip];
      persist(s.messages, chips);
      return { chips };
    }),
  removeChip: (id) =>
    set((s) => {
      const chips = s.chips.filter((c) => c.id !== id);
      persist(s.messages, chips);
      return { chips };
    }),
  clearChips: () =>
    set((s) => {
      persist(s.messages, []);
      return { chips: [] };
    }),
  addMessage: (message) =>
    set((s) => {
      const messages = [...s.messages, message];
      persist(messages, s.chips);
      return { messages };
    }),
  setSending: (sending) => set({ sending }),
  setStreamingText: (text) => set({ streamingText: text }),
  // "New chat" and "Clear chat history" are the same operation under the hood
  // now that the conversation is persisted (there is only ever one thread) —
  // kept as two separate store actions/UI buttons so the panel can offer both
  // a low-friction "start over" affordance and an explicit, clearly-labelled
  // PHI-wipe action (with its own confirmation) without one implying the other.
  newChat: () => get().clearHistory(),
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const record = await loadAiChatHistory();
      set({ messages: record?.messages ?? [], chips: record?.chips ?? [], hydrated: true });
    } catch {
      // No persisted history (or IndexedDB unavailable) — start with an empty conversation.
      set({ hydrated: true });
    }
  },
  clearHistory: () => {
    // Cancel any in-flight request FIRST (before wiping state) so a stale response's own eventual
    // `.then()`/stream-read continuation cannot land after `activeGenerationId` has already moved on
    // — belt-and-braces with the id bump below, since `abort()` isn't always instant.
    get().activeAbortController?.abort();
    set((s) => ({
      messages: [],
      chips: [],
      sending: false,
      streamingText: '',
      activeGenerationId: s.activeGenerationId + 1,
      activeAbortController: null,
    }));
    void clearAiChatHistory().catch(() => {});
  },
  stopGeneration: () => {
    const s = get();
    s.activeAbortController?.abort();
    const partial = parseThinkResponse(s.streamingText).answer;
    set((st) => {
      if (!partial) {
        return {
          sending: false,
          streamingText: '',
          activeGenerationId: st.activeGenerationId + 1,
          activeAbortController: null,
        };
      }
      const stoppedMessage: AiChatMessage = {
        id: newId(),
        role: 'assistant',
        content: partial,
        createdAt: Date.now(),
        stopped: true,
      };
      const messages = [...st.messages, stoppedMessage];
      persist(messages, st.chips);
      return {
        messages,
        sending: false,
        streamingText: '',
        activeGenerationId: st.activeGenerationId + 1,
        activeAbortController: null,
      };
    });
  },
}));

export function makeMessageId(): string {
  return newId();
}

/** MIME type used for HTML5 drag-and-drop of a context chip payload. */
export const CHIP_DND_MIME = 'application/x-accadminsuite-context-chip';
