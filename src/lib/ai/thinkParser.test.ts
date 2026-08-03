import { describe, expect, it } from 'vitest';
import { parseThinkResponse } from './thinkParser';

describe('parseThinkResponse', () => {
  it('returns the whole text as the answer when there is no <think> block at all', () => {
    const result = parseThinkResponse('Hi, how can I help you?');
    expect(result).toEqual({ answer: 'Hi, how can I help you?', reasoning: null, thinking: false });
  });

  it('separates a realistic complete <think>...</think> block from the final answer', () => {
    const text =
      '<think>\n' +
      "The user said hello. This is a simple greeting, I should respond briefly and warmly rather " +
      'than over-analyzing it.\n' +
      '</think>\n' +
      'Hi! How can I help you today?';
    const result = parseThinkResponse(text);
    expect(result.thinking).toBe(false);
    expect(result.answer).toBe('Hi! How can I help you today?');
    expect(result.reasoning).toContain('simple greeting');
  });

  it('handles text before the <think> tag and after the closing tag together as the answer', () => {
    const text = 'Sure. <think>reasoning here</think> Final answer.';
    const result = parseThinkResponse(text);
    expect(result.answer).toBe('Sure.  Final answer.');
    expect(result.reasoning).toBe('reasoning here');
  });

  it('reports thinking=true and partial reasoning while the closing tag has not arrived yet', () => {
    const result = parseThinkResponse('<think>still working through this');
    expect(result.thinking).toBe(true);
    expect(result.reasoning).toBe('still working through this');
    expect(result.answer).toBe('');
  });

  it('withholds a trailing fragment that could still become the opening tag', () => {
    const result = parseThinkResponse('Hello there <thi');
    expect(result.answer).toBe('Hello there');
    expect(result.thinking).toBe(false);
    expect(result.reasoning).toBeNull();
  });

  it('withholds a trailing fragment that could still become the closing tag, while still thinking', () => {
    const result = parseThinkResponse('<think>some reasoning </thi');
    expect(result.thinking).toBe(true);
    expect(result.reasoning).toBe('some reasoning');
  });

  it('never regresses when replayed over a realistic growing sequence of streamed chunks', () => {
    const full = '<think>Step one. Step two.</think>The final short answer.';
    const seenAnswers: string[] = [];
    // Simulate Ollama's `onChunk` firing with the accumulated text so far, one character at a time —
    // the worst case for a tag boundary landing mid-token.
    for (let i = 1; i <= full.length; i += 1) {
      const chunk = full.slice(0, i);
      const parsed = parseThinkResponse(chunk);
      seenAnswers.push(parsed.answer);
      // The visible answer must never contain a literal tag fragment.
      expect(parsed.answer).not.toMatch(/<\/?think/);
    }
    const finalParsed = parseThinkResponse(full);
    expect(finalParsed.answer).toBe('The final short answer.');
    expect(finalParsed.reasoning).toBe('Step one. Step two.');
    expect(finalParsed.thinking).toBe(false);
    // The answer should only ever appear once the closing tag has actually streamed in.
    expect(seenAnswers[seenAnswers.length - 1]).toBe('The final short answer.');
  });

  it('treats an empty reasoning block as null (nothing meaningful to show behind "Show reasoning")', () => {
    const result = parseThinkResponse('<think>   </think>Answer.');
    expect(result.reasoning).toBeNull();
    expect(result.answer).toBe('Answer.');
  });
});
