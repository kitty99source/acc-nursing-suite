// ============================================================================
// Rough token-budget estimation + a preflight "is this prompt too big"
// safety net for the AI chat assistant, added after a real 2026-08-04 owner
// incident: a Contract chip with a 39-row rate table, plus a table-of-
// contents knowledge chunk, plus a substantive terms-and-conditions chunk,
// were combined into one request that plausibly exceeded the model's
// context window (`num_ctx`, aiService.ts) — Ollama then hung/crashed
// instead of failing cleanly, which surfaced to the owner as a generic
// "Couldn't reach the local AI model" timeout with no explanation of why.
//
// This module does NOT talk to Ollama or know the model's real tokenizer —
// it is a cheap, local, good-enough estimate used purely to decide whether
// to trim context (aiChatContext.ts `buildChatMessages`) or refuse to send
// at all, BEFORE paying for a real (possibly very slow, possibly stuck) CPU
// inference call that would otherwise be the first and only signal that
// something was oversized.
// ============================================================================

/**
 * ~4 characters per token is a commonly-cited rough average for English text
 * across common BPE-style tokenizers (this is intentionally a conservative
 * estimate, not the model's real vocabulary — Phi-4-mini-reasoning's own
 * tokenizer isn't available client-side without shipping its vocab file).
 * Good enough for a preflight "roughly how much of the context window will
 * this use" check; not a substitute for the real token count Ollama itself
 * would compute.
 */
const CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

export function estimateMessagesTokenCount(messages: Array<{ content: string }>): number {
  return messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
}

/**
 * Start trimming (dropping the lowest-relevance retrieved knowledge chunks
 * first — see aiChatContext.ts `buildChatMessages`) once the estimated
 * prompt would use more than this fraction of `num_ctx`. Left with real
 * headroom below 100%: `num_ctx` is the TOTAL window shared between the
 * prompt AND the model's own reply (not just the prompt), and this is a
 * rough char-based estimate, not the model's real tokenizer — trimming
 * early, before the window is actually full, is deliberately conservative
 * rather than cutting it exactly to the wire.
 *
 * 2026-08-04 fortify: lowered from 0.75 → 0.65 after occasional "can't reach
 * the model" reports that were still context overload (char≈token estimate
 * under-counted real BPE tokens). More headroom = trim/refuse earlier,
 * prefer fail-fast honest UI over a hung Ollama call.
 */
export const CONTEXT_TRIM_TRIGGER_RATIO = 0.65;

/**
 * Reserve this many tokens of `num_ctx` for the model's own reply — matches
 * this app's own `DEFAULT_CHAT_NUM_PREDICT` ceiling (aiService.ts) as the
 * realistic upper bound on how much of the window a real answer could use,
 * so the safety net's "would this leave enough room to actually answer"
 * check is grounded in a real number already in use elsewhere in this
 * codebase, not an arbitrarily different one.
 */
export const DEFAULT_RESERVED_FOR_RESPONSE_TOKENS = 2048;

export interface ContextBudgetCheck {
  ok: boolean;
  estimatedPromptTokens: number;
  /** `numCtx - reservedForResponseTokens` — the real ceiling the prompt must fit under to leave room for a reply at all. */
  maxPromptTokens: number;
  numCtx: number;
}

/**
 * Final safety-net check: even after best-effort trimming (see
 * `buildChatMessages`), is the assembled prompt still too large to leave
 * meaningful room for the model's own reply inside `numCtx`? If so, the
 * caller (aiChatContext.ts) must refuse to send this request to Ollama at
 * all — this is the literal condition that caused the real incident: a
 * prompt so close to (or over) the context window that the model behaved
 * badly/stalled/crashed instead of just giving a short or truncated answer.
 */
export function checkContextBudget(
  messages: Array<{ content: string }>,
  opts: { numCtx: number; reservedForResponseTokens?: number },
): ContextBudgetCheck {
  const reserved = opts.reservedForResponseTokens ?? DEFAULT_RESERVED_FOR_RESPONSE_TOKENS;
  const maxPromptTokens = Math.max(0, opts.numCtx - reserved);
  const estimatedPromptTokens = estimateMessagesTokenCount(messages);
  return {
    ok: estimatedPromptTokens <= maxPromptTokens,
    estimatedPromptTokens,
    maxPromptTokens,
    numCtx: opts.numCtx,
  };
}

/**
 * User-facing message for the safety net — specific and honest about WHY the request was
 * refused (unlike the generic "Couldn't reach the local AI model" timeout this replaces for this
 * specific, preventable case), and tells the user exactly what to do differently.
 */
export function contextTooLargeMessage(itemCount: number): string {
  return (
    `This request includes a lot of context (${itemCount} item${itemCount === 1 ? '' : 's'}) — try ` +
    'asking about one specific code/topic instead of attaching everything at once.'
  );
}

/**
 * Refuse copy when the prompt is still over budget after extractive summary + dropping
 * retrieved chunks + oldest history + aggressive content truncation. Distinct from the
 * chip/item-count message so a long chat gets honest "start a new chat" guidance rather
 * than blaming attached records.
 */
export function contextHistoryTooLargeMessage(): string {
  return (
    'This chat has grown too large for the local model to handle safely in one request ' +
    '(even after summarizing and trimming earlier turns). Start a new chat for this topic, ' +
    'or ask a shorter follow-up about one specific code/rule — otherwise the request would ' +
    'likely hang or crash the model.'
  );
}

/**
 * Soft ceiling used by the aggressive content-truncation pass in `trimToBudget` once
 * chunks and whole history turns are already gone: each remaining history message's
 * body is clipped to this many characters (newest turns kept fuller via later pass).
 */
export const AGGRESSIVE_HISTORY_MSG_MAX_CHARS = 600;

/** Soft ceiling for the rolling conversation-summary block during aggressive trim. */
export const AGGRESSIVE_SUMMARY_MAX_CHARS = 800;

/** Soft ceiling for the attached chip context block during aggressive trim. */
export const AGGRESSIVE_CONTEXT_BLOCK_MAX_CHARS = 2400;
