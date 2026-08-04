import { describe, expect, it, vi } from 'vitest';
import type { ChatTurn } from '../aiChatContext';
import {
  RECENT_VERBATIM_MESSAGES,
  SUMMARIZE_MESSAGE_THRESHOLD,
  OLDER_HISTORY_TOKEN_TRIGGER,
  SUMMARY_FAILED_USER_MESSAGE,
  buildSummarizeMessages,
  canReuseSummary,
  clampSummaryText,
  ensureConversationSummary,
  needsSummarization,
  splitHistoryForSummary,
  turnsToFoldIntoSummary,
  SUMMARY_MAX_CHARS,
} from './conversationSummary';

function turns(n: number): { history: ChatTurn[]; ids: string[] } {
  const history: ChatTurn[] = [];
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    history.push({ role, content: `${role} turn ${i}` });
    ids.push(`m${i}`);
  }
  return { history, ids };
}

describe('splitHistoryForSummary', () => {
  it('keeps everything as recent when under the verbatim window', () => {
    const { history } = turns(3);
    const { older, recent } = splitHistoryForSummary(history);
    expect(older).toEqual([]);
    expect(recent).toHaveLength(3);
  });

  it('splits older vs recent at RECENT_VERBATIM_MESSAGES', () => {
    const { history } = turns(8);
    const { older, recent } = splitHistoryForSummary(history);
    expect(recent).toHaveLength(RECENT_VERBATIM_MESSAGES);
    expect(older).toHaveLength(8 - RECENT_VERBATIM_MESSAGES);
    expect(recent[0].content).toContain('turn 4');
  });
});

describe('needsSummarization / canReuseSummary', () => {
  it('does not trigger under the message-count threshold with short older turns', () => {
    const { history, ids } = turns(6);
    expect(needsSummarization(history, ids, null)).toBe(false);
  });

  it('triggers once history reaches SUMMARIZE_MESSAGE_THRESHOLD', () => {
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    expect(needsSummarization(history, ids, null)).toBe(true);
  });

  it('triggers when older turns alone exceed the token estimate threshold', () => {
    const long = 'x'.repeat(OLDER_HISTORY_TOKEN_TRIGGER * 4 + 100);
    const history: ChatTurn[] = [
      { role: 'user', content: long },
      { role: 'assistant', content: long },
      { role: 'user', content: 'recent q1' },
      { role: 'assistant', content: 'recent a1' },
      { role: 'user', content: 'recent q2' },
      { role: 'assistant', content: 'recent a2' },
    ];
    const ids = history.map((_, i) => `m${i}`);
    expect(needsSummarization(history, ids, null)).toBe(true);
  });

  it('does not re-summarize when an existing summary already covers the last older message', () => {
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const { older } = splitHistoryForSummary(history);
    const existing = {
      text: 'Prior facts: discussed nursing packages.',
      throughMessageId: ids[older.length - 1],
      updatedAt: 1,
    };
    expect(needsSummarization(history, ids, existing)).toBe(false);
    expect(canReuseSummary(history, ids, existing)).toBe(true);
  });

  it('re-summarizes when newly aged turns sit past the prior throughMessageId', () => {
    const { history, ids } = turns(10);
    // Summary only covered through the first older message — window has slid further.
    const existing = {
      text: 'Old summary',
      throughMessageId: ids[0],
      updatedAt: 1,
    };
    expect(needsSummarization(history, ids, existing)).toBe(true);
    expect(canReuseSummary(history, ids, existing)).toBe(false);
  });
});

describe('turnsToFoldIntoSummary / buildSummarizeMessages', () => {
  it('folds only newly aged turns when a prior summary exists', () => {
    const { history, ids } = turns(10);
    const existing = {
      text: 'Facts: first exchange done.',
      throughMessageId: ids[1],
      updatedAt: 1,
    };
    const folded = turnsToFoldIntoSummary(history, ids, existing);
    expect(folded.previousSummary).toContain('first exchange');
    // older = indices 0..5 for length 10 with recent=4 → newly aged after id m1 → indices 2..5
    expect(folded.newTurns.map((t) => t.content)).toEqual([
      'user turn 2',
      'assistant turn 3',
      'user turn 4',
      'assistant turn 5',
    ]);
    expect(folded.throughMessageId).toBe(ids[5]);
  });

  it('builds a compact structured summarize prompt without inventing PHI', () => {
    const messages = buildSummarizeMessages('', [
      { role: 'user', content: 'What is NS01?' },
      { role: 'assistant', content: 'NS01 is a nursing package.' },
    ]);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Facts established');
    expect(messages[1].content).toContain('What is NS01?');
    expect(messages[1].content).toContain('NS01 is a nursing package.');
  });

  it('includes the previous summary when rolling', () => {
    const messages = buildSummarizeMessages('Facts: NS01 discussed.', [
      { role: 'user', content: 'And NS02?' },
      { role: 'assistant', content: 'NS02 is another package.' },
    ]);
    expect(messages[1].content).toContain('Previous summary');
    expect(messages[1].content).toContain('Facts: NS01 discussed.');
    expect(messages[1].content).toContain('And NS02?');
  });
});

describe('clampSummaryText', () => {
  it('truncates runaway summary text', () => {
    const long = 'a'.repeat(SUMMARY_MAX_CHARS + 50);
    const clamped = clampSummaryText(long);
    expect(clamped.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
    expect(clamped.endsWith('…')).toBe(true);
  });
});

describe('ensureConversationSummary', () => {
  it('returns none for a short conversation (no model call)', async () => {
    const summarizeFn = vi.fn();
    const { history, ids } = turns(4);
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing: null,
      baseUrl: 'http://127.0.0.1:11434',
      summarizeFn,
    });
    expect(result.status).toBe('none');
    expect(result.historySummarized).toBe(false);
    expect(summarizeFn).not.toHaveBeenCalled();
  });

  it('reuses an existing summary without calling the model', async () => {
    const summarizeFn = vi.fn();
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const { older, recent } = splitHistoryForSummary(history);
    const existing = {
      text: 'Facts: packages discussed.',
      throughMessageId: ids[older.length - 1],
      updatedAt: 1,
    };
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing,
      baseUrl: 'http://127.0.0.1:11434',
      summarizeFn,
    });
    expect(result.status).toBe('reused');
    expect(result.historySummarized).toBe(true);
    expect(result.recentHistory).toEqual(recent);
    expect(result.summary?.text).toBe('Facts: packages discussed.');
    expect(summarizeFn).not.toHaveBeenCalled();
  });

  it('creates a rolling summary via summarizeFn when past the threshold', async () => {
    const summarizeFn = vi.fn().mockResolvedValue({
      ok: true,
      text: '<think>compressing</think>\n- Facts established: NS01 rates\n- Open questions: none',
    });
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing: null,
      baseUrl: 'http://127.0.0.1:11434',
      summarizeFn,
    });
    expect(result.status).toBe('created');
    expect(result.historySummarized).toBe(true);
    expect(result.summary?.text).toContain('NS01 rates');
    expect(result.summary?.text).not.toContain('<think>');
    expect(result.recentHistory).toHaveLength(RECENT_VERBATIM_MESSAGES);
    expect(summarizeFn).toHaveBeenCalledTimes(1);
    const [, messages, opts] = summarizeFn.mock.calls[0];
    expect(messages[0].role).toBe('system');
    expect(opts.signal).toBeUndefined();
  });

  it('falls back with summaryFailed when summarizeFn errors', async () => {
    const summarizeFn = vi.fn().mockResolvedValue({ ok: false, error: 'Timed out' });
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing: null,
      baseUrl: 'http://127.0.0.1:11434',
      summarizeFn,
    });
    expect(result.status).toBe('failed');
    expect(result.summaryFailed).toBe(true);
    expect(result.historySummarized).toBe(false);
    expect(result.summaryFailedMessage).toBe(SUMMARY_FAILED_USER_MESSAGE);
    expect(result.recentHistory).toHaveLength(RECENT_VERBATIM_MESSAGES);
  });

  it('respects AbortController — fails closed without hanging when already aborted', async () => {
    const summarizeFn = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing: null,
      baseUrl: 'http://127.0.0.1:11434',
      signal: controller.signal,
      summarizeFn,
    });
    expect(result.status).toBe('failed');
    expect(result.summaryFailed).toBe(true);
    expect(summarizeFn).not.toHaveBeenCalled();
  });

  it('passes the AbortSignal into summarizeFn for mid-summarize cancel', async () => {
    const controller = new AbortController();
    const summarizeFn = vi.fn().mockImplementation(async (_url, _msgs, opts) => {
      expect(opts?.signal?.aborted).toBe(false);
      controller.abort();
      return { ok: false, error: 'aborted' };
    });
    const { history, ids } = turns(SUMMARIZE_MESSAGE_THRESHOLD);
    const result = await ensureConversationSummary({
      history,
      historyMessageIds: ids,
      existing: null,
      baseUrl: 'http://127.0.0.1:11434',
      signal: controller.signal,
      summarizeFn,
    });
    expect(summarizeFn).toHaveBeenCalled();
    expect(result.status).toBe('failed');
  });
});
