import { describe, expect, it } from 'vitest';
import {
  checkContextBudget,
  contextHistoryTooLargeMessage,
  contextTooLargeMessage,
  CONTEXT_TRIM_TRIGGER_RATIO,
  DEFAULT_RESERVED_FOR_RESPONSE_TOKENS,
  estimateMessagesTokenCount,
  estimateTokenCount,
} from './contextBudget';

describe('estimateTokenCount', () => {
  it('estimates roughly 1 token per 4 characters', () => {
    expect(estimateTokenCount('a'.repeat(400))).toBe(100);
  });

  it('returns 0 for empty text', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('rounds up rather than truncating (never under-estimates a partial-token remainder)', () => {
    expect(estimateTokenCount('abc')).toBe(1);
  });
});

describe('estimateMessagesTokenCount', () => {
  it('sums the estimated token count across all messages', () => {
    const total = estimateMessagesTokenCount([{ content: 'a'.repeat(400) }, { content: 'b'.repeat(800) }]);
    expect(total).toBe(100 + 200);
  });
});

describe('checkContextBudget', () => {
  it('reports ok when the estimated prompt comfortably fits under numCtx minus the reserved response budget', () => {
    const result = checkContextBudget([{ content: 'short prompt' }], { numCtx: 8192 });
    expect(result.ok).toBe(true);
    expect(result.numCtx).toBe(8192);
    expect(result.maxPromptTokens).toBe(8192 - DEFAULT_RESERVED_FOR_RESPONSE_TOKENS);
  });

  it('reports not-ok when the estimated prompt would leave no real room for a reply', () => {
    // ~4000 chars => ~1000 estimated tokens, against a tiny numCtx that reserves almost all of
    // its own budget for the reply — this is the crashing incident's own shape (prompt basically
    // fills the window with nothing left over for generation).
    const bigContent = 'x'.repeat(4000);
    const result = checkContextBudget([{ content: bigContent }], { numCtx: 1024, reservedForResponseTokens: 900 });
    expect(result.ok).toBe(false);
    expect(result.estimatedPromptTokens).toBeGreaterThan(result.maxPromptTokens);
  });

  it('uses a smaller numCtx correctly when explicitly provided (e.g. a caller testing the safety net)', () => {
    const result = checkContextBudget([{ content: 'x'.repeat(400) }], { numCtx: 200, reservedForResponseTokens: 50 });
    // 400 chars ~= 100 tokens estimated; budget is 200 - 50 = 150, so this should still fit.
    expect(result.ok).toBe(true);
    // But pushing the numCtx down further should flip it to not-ok.
    const tight = checkContextBudget([{ content: 'x'.repeat(400) }], { numCtx: 120, reservedForResponseTokens: 50 });
    expect(tight.ok).toBe(false);
  });
});

describe('contextTooLargeMessage', () => {
  it('mentions the item count and suggests asking about one specific thing', () => {
    const msg = contextTooLargeMessage(4);
    expect(msg).toContain('4 items');
    expect(msg.toLowerCase()).toContain('one specific');
  });

  it('uses singular "item" for a count of 1', () => {
    expect(contextTooLargeMessage(1)).toContain('1 item)');
  });
});

describe('CONTEXT_TRIM_TRIGGER_RATIO', () => {
  it('is a sensible fraction below 1 (trims before the window is completely full)', () => {
    expect(CONTEXT_TRIM_TRIGGER_RATIO).toBeGreaterThan(0);
    expect(CONTEXT_TRIM_TRIGGER_RATIO).toBeLessThan(1);
  });

  it('stays at or below 0.65 so char≈token under-estimates still leave headroom (2026-08-04 fortify)', () => {
    expect(CONTEXT_TRIM_TRIGGER_RATIO).toBeLessThanOrEqual(0.65);
  });
});

describe('contextHistoryTooLargeMessage', () => {
  it('tells the user to start a new chat rather than blaming attached chips', () => {
    const msg = contextHistoryTooLargeMessage();
    expect(msg.toLowerCase()).toContain('new chat');
    expect(msg.toLowerCase()).toContain('too large');
    expect(msg.toLowerCase()).not.toContain('items)');
  });
});
