import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextChip } from '../lib/aiChatContext';

// aiChatStore persists to IndexedDB, which jsdom lacks — mock the IDB module
// so the store's persist/hydrate/clearHistory calls resolve without a real
// IndexedDB implementation. This does NOT edit lib/idb.ts.
const idbMocks = vi.hoisted(() => ({
  loadAiChatHistory: vi.fn(async () => undefined as import('../lib/idb').AiChatHistoryRecord | undefined),
  saveAiChatHistory: vi.fn(async () => {}),
  clearAiChatHistory: vi.fn(async () => {}),
}));
vi.mock('../lib/idb', () => idbMocks);

import { useAiChatStore } from './aiChatStore';

function chip(id: string): ContextChip {
  return { id: `patient:${id}`, type: 'patient', recordId: id, label: `Patient ${id}` };
}

beforeEach(() => {
  idbMocks.loadAiChatHistory.mockClear().mockResolvedValue(undefined);
  idbMocks.saveAiChatHistory.mockClear();
  idbMocks.clearAiChatHistory.mockClear();
  useAiChatStore.setState({ open: false, chips: [], messages: [], sending: false, hydrated: false });
});

describe('useAiChatStore', () => {
  it('starts collapsed with no chips or messages', () => {
    const s = useAiChatStore.getState();
    expect(s.open).toBe(false);
    expect(s.chips).toEqual([]);
    expect(s.messages).toEqual([]);
  });

  it('toggleOpen flips the panel between collapsed and expanded', () => {
    useAiChatStore.getState().toggleOpen();
    expect(useAiChatStore.getState().open).toBe(true);
    useAiChatStore.getState().toggleOpen();
    expect(useAiChatStore.getState().open).toBe(false);
  });

  it('addChip adds a new chip, and adding the same record again is a no-op (no duplicate)', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addChip(chip('p1'));
    expect(useAiChatStore.getState().chips).toHaveLength(1);
  });

  it('addChip supports attaching multiple distinct records', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addChip(chip('p2'));
    expect(useAiChatStore.getState().chips.map((c) => c.recordId)).toEqual(['p1', 'p2']);
  });

  it('removeChip removes only the targeted chip', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addChip(chip('p2'));
    useAiChatStore.getState().removeChip('patient:p1');
    expect(useAiChatStore.getState().chips.map((c) => c.recordId)).toEqual(['p2']);
  });

  it('clearChips empties the chip list without touching messages', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'hi', createdAt: Date.now() });
    useAiChatStore.getState().clearChips();
    expect(useAiChatStore.getState().chips).toEqual([]);
    expect(useAiChatStore.getState().messages).toHaveLength(1);
  });

  it('newChat clears chips, messages, and sending state', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'hi', createdAt: Date.now() });
    useAiChatStore.getState().setSending(true);
    useAiChatStore.getState().newChat();
    const s = useAiChatStore.getState();
    expect(s.chips).toEqual([]);
    expect(s.messages).toEqual([]);
    expect(s.sending).toBe(false);
  });

  it('newChat also wipes the persisted IndexedDB history', () => {
    useAiChatStore.getState().newChat();
    expect(idbMocks.clearAiChatHistory).toHaveBeenCalledTimes(1);
  });
});

describe('useAiChatStore persistence (IndexedDB, mocked)', () => {
  it('persists to IndexedDB whenever a chip is added or removed', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    expect(idbMocks.saveAiChatHistory).toHaveBeenCalledWith(
      expect.objectContaining({ chips: [chip('p1')], messages: [] }),
    );
    useAiChatStore.getState().removeChip('patient:p1');
    expect(idbMocks.saveAiChatHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ chips: [], messages: [] }),
    );
  });

  it('persists to IndexedDB whenever a message is added', () => {
    const message = { id: 'm1', role: 'user' as const, content: 'hi', createdAt: Date.now() };
    useAiChatStore.getState().addMessage(message);
    expect(idbMocks.saveAiChatHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ messages: [message] }),
    );
  });

  it('hydrate loads a previously persisted conversation exactly once', async () => {
    const message = { id: 'm1', role: 'assistant' as const, content: 'saved reply', createdAt: 123 };
    idbMocks.loadAiChatHistory.mockResolvedValue({ messages: [message], chips: [chip('p1')], savedAt: 123 });

    await useAiChatStore.getState().hydrate();
    expect(useAiChatStore.getState().messages).toEqual([message]);
    expect(useAiChatStore.getState().chips).toEqual([chip('p1')]);
    expect(useAiChatStore.getState().hydrated).toBe(true);

    // A second call is a no-op — must not re-fetch or clobber in-memory edits made since.
    useAiChatStore.getState().addMessage({ id: 'm2', role: 'user', content: 'new', createdAt: 456 });
    await useAiChatStore.getState().hydrate();
    expect(idbMocks.loadAiChatHistory).toHaveBeenCalledTimes(1);
    expect(useAiChatStore.getState().messages).toHaveLength(2);
  });

  it('hydrate starts with an empty conversation when nothing was persisted', async () => {
    idbMocks.loadAiChatHistory.mockResolvedValue(undefined);
    await useAiChatStore.getState().hydrate();
    expect(useAiChatStore.getState().messages).toEqual([]);
    expect(useAiChatStore.getState().chips).toEqual([]);
    expect(useAiChatStore.getState().hydrated).toBe(true);
  });

  it('hydrate degrades gracefully (never throws) if the IndexedDB load fails', async () => {
    idbMocks.loadAiChatHistory.mockRejectedValue(new Error('IndexedDB unavailable'));
    await expect(useAiChatStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useAiChatStore.getState().hydrated).toBe(true);
  });

  it('clearHistory wipes messages, chips, and sending state, and deletes the IndexedDB record', () => {
    useAiChatStore.getState().addChip(chip('p1'));
    useAiChatStore.getState().addMessage({ id: 'm1', role: 'user', content: 'hi', createdAt: Date.now() });
    useAiChatStore.getState().setSending(true);

    useAiChatStore.getState().clearHistory();

    const s = useAiChatStore.getState();
    expect(s.messages).toEqual([]);
    expect(s.chips).toEqual([]);
    expect(s.sending).toBe(false);
    expect(idbMocks.clearAiChatHistory).toHaveBeenCalledTimes(1);
  });
});
