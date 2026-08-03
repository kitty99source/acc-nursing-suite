// ============================================================================
// Global AI chat panel state: which record chips are attached, the ongoing
// conversation, and whether the panel is expanded. Deliberately a SEPARATE,
// tiny zustand store from the main `useStore` (state/store.ts) — this is
// ephemeral, in-memory-only UI/session state (never written to the
// IndexedDB-backed autosave blob, never exported/backed up), so it has no
// business living next to the real patient/claim/settings data. Closing the
// tab clears it, same as closing a chat sidebar in any other app.
//
// Chips are added from two places that are NOT descendants of the chat panel
// component (e.g. a row in Patients) — that's the whole reason this needs to
// be a shared store rather than component state.
// ============================================================================

import { create } from 'zustand';
import type { ContextChip } from '../lib/aiChatContext';

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Chips attached when a user message was sent (kept for display on that bubble). */
  chips?: ContextChip[];
  /** The exact serialized context text sent to the model alongside this exchange, for the "Context used" disclosure. */
  contextUsed?: string;
  /** Set when the local model call failed/timed out — rendered as a distinct, non-fatal notice. */
  error?: string;
}

interface AiChatState {
  open: boolean;
  chips: ContextChip[];
  messages: AiChatMessage[];
  sending: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  addChip: (chip: ContextChip) => void;
  removeChip: (id: string) => void;
  clearChips: () => void;
  addMessage: (message: AiChatMessage) => void;
  setSending: (sending: boolean) => void;
  newChat: () => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

export const useAiChatStore = create<AiChatState>((set) => ({
  open: false,
  chips: [],
  messages: [],
  sending: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  addChip: (chip) =>
    set((s) => (s.chips.some((c) => c.id === chip.id) ? s : { chips: [...s.chips, chip] })),
  removeChip: (id) => set((s) => ({ chips: s.chips.filter((c) => c.id !== id) })),
  clearChips: () => set({ chips: [] }),
  addMessage: (message) => set((s) => ({ messages: [...s.messages, message] })),
  setSending: (sending) => set({ sending }),
  newChat: () => set({ messages: [], chips: [], sending: false }),
}));

export function makeMessageId(): string {
  return newId();
}

/** MIME type used for HTML5 drag-and-drop of a context chip payload. */
export const CHIP_DND_MIME = 'application/x-accadminsuite-context-chip';
