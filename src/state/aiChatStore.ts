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
   * `generateLocalAiResponseStream`). '' while nothing has streamed back yet (still cold-starting
   * / thinking); reset to '' once the final message is appended via `addMessage`.
   */
  streamingText: string;
  /** True once the one-time load from IndexedDB has completed (or found nothing). */
  hydrated: boolean;
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
    set({ messages: [], chips: [], sending: false, streamingText: '' });
    void clearAiChatHistory().catch(() => {});
  },
}));

export function makeMessageId(): string {
  return newId();
}

/** MIME type used for HTML5 drag-and-drop of a context chip payload. */
export const CHIP_DND_MIME = 'application/x-accadminsuite-context-chip';
