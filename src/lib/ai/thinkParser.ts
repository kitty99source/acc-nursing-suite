// ============================================================================
// Strips a reasoning-model's `<think>...</think>` chain-of-thought block out
// of its raw output so the chat panel can show a short, direct answer as the
// primary bubble while keeping the reasoning trace available behind a
// "Show reasoning" toggle (see AiChatPanel.tsx).
//
// WHY THIS EXISTS (2026-08-04 owner bug report): Phi-4-mini-reasoning (this
// app's DEFAULT_AI_MODEL, see aiService.ts) is a "reasoning" model family —
// like DeepSeek-R1-distill/QwQ/Phi-4-reasoning — trained to emit an explicit
// chain-of-thought wrapped in `<think>...</think>` before its final answer.
// Confirmed from real sample outputs (Microsoft's own Phi-4-reasoning
// technical report describes two placeholder tokens repurposed to mark the
// start/end of a "thinking" block; real inference transcripts show literal
// `<think>...</think>` text). Unlike Qwen3/DeepSeek-R1/GPT-OSS, Phi-4 models
// are NOT on Ollama's native "thinking-capable" model list (see
// https://github.com/ollama/ollama/blob/main/docs/capabilities/thinking.mdx)
// — so Ollama does NOT split this into a separate `thinking` JSON field the
// way it does for those models; the `<think>` tags come through as literal
// text inside the ordinary `response` stream. Before this file existed,
// AiChatPanel rendered that raw text verbatim as the "answer", which is
// exactly why the owner saw a wall of visible reasoning instead of a short
// reply to "hello".
//
// STREAMING: `generateLocalAiResponseStream`'s `onChunk` callback always
// hands back the FULL accumulated text so far (not just the new delta — see
// aiService.ts), so `parseThinkResponse` is deliberately a pure, stateless
// function re-run on the whole growing string on every chunk rather than a
// stateful incremental parser. That sidesteps the hard version of "a tag
// split across chunks" entirely: there is no partial-tag state to carry
// between calls, because each call sees the tag from the very start once
// enough of the string has arrived. The one remaining edge case — a chunk
// boundary landing INSIDE the literal tag text itself (e.g. one call sees
// "...<thi" with the rest not arrived yet) — is handled below by never
// treating a string that merely *could* be the start of a tag as plain
// answer text; see `stripTrailingPartialTag`.
// ============================================================================

const THINK_OPEN = '<think>';
const THINK_CLOSE = '</think>';

export interface ParsedThinkResponse {
  /** Final answer text only, with any `<think>...</think>` block removed. */
  answer: string;
  /** Reasoning trace content, or `null` if no `<think>` block was found at all. */
  reasoning: string | null;
  /** True while a `<think>` block has been opened but not yet closed (still mid-reasoning). */
  thinking: boolean;
}

/**
 * If `s` ends with a prefix of `tag` that isn't the whole tag (e.g. `s` ends
 * in `"<thi"` and `tag` is `"<think>"`), returns the length of that trailing
 * partial match so the caller can withhold it from what's shown as plain
 * text — it might complete into the real tag on the next stream chunk.
 * Returns 0 when there's no such ambiguous trailing fragment.
 */
function trailingPartialTagLength(s: string, tag: string): number {
  const maxLen = Math.min(s.length, tag.length - 1);
  for (let len = maxLen; len > 0; len -= 1) {
    if (s.slice(s.length - len) === tag.slice(0, len)) return len;
  }
  return 0;
}

/**
 * Parses one accumulated model-output string into `{ answer, reasoning,
 * thinking }`. Safe to call repeatedly with a growing prefix of the same
 * final string (i.e. once per streamed chunk) — always recomputed from
 * scratch, never mutates/depends on prior calls.
 */
export function parseThinkResponse(text: string): ParsedThinkResponse {
  const openIdx = text.indexOf(THINK_OPEN);

  if (openIdx === -1) {
    // No opening tag yet. Hold back a trailing fragment that could still
    // turn into "<think>" once more text streams in, so it never flashes
    // on screen as literal "<th" for a frame.
    const partial = trailingPartialTagLength(text, THINK_OPEN);
    const visible = partial > 0 ? text.slice(0, text.length - partial) : text;
    return { answer: visible.trim(), reasoning: null, thinking: false };
  }

  const before = text.slice(0, openIdx);
  const afterOpen = text.slice(openIdx + THINK_OPEN.length);
  const closeIdx = afterOpen.indexOf(THINK_CLOSE);

  if (closeIdx === -1) {
    // Inside the reasoning block, closing tag not seen yet — same trailing-fragment guard applies to it.
    const partial = trailingPartialTagLength(afterOpen, THINK_CLOSE);
    const reasoningSoFar = partial > 0 ? afterOpen.slice(0, afterOpen.length - partial) : afterOpen;
    return { answer: before.trim(), reasoning: reasoningSoFar.trim(), thinking: true };
  }

  const reasoning = afterOpen.slice(0, closeIdx).trim();
  const after = afterOpen.slice(closeIdx + THINK_CLOSE.length);
  const answer = (before + after).trim();
  return { answer, reasoning: reasoning || null, thinking: false };
}
