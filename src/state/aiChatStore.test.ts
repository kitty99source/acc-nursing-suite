import { beforeEach, describe, expect, it } from 'vitest';
import { useAiChatStore } from './aiChatStore';
import type { ContextChip } from '../lib/aiChatContext';

function chip(id: string): ContextChip {
  return { id: `patient:${id}`, type: 'patient', recordId: id, label: `Patient ${id}` };
}

beforeEach(() => {
  useAiChatStore.setState({ open: false, chips: [], messages: [], sending: false });
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
});
