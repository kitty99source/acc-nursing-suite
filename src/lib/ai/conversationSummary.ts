// ============================================================================
// Smart conversation summarization for long AI chats (2026-08-04).
//
// Problem: once a chat runs long, raw history alone can overflow `num_ctx` /
// hang Ollama ("Couldn't reach the local AI model"), even after the hard
// timeout raise and oldest-turn trim. Cold-dropping oldest turns loses
// decisions/facts the owner still expects the model to remember.
//
// Approach (Cursor-style + CPU-laptop reality): when history past a threshold,
// compress OLDER turns into a short rolling summary kept as system context;
// keep the most recent K messages verbatim; persist the summary with the chat
// session in IndexedDB. Visible transcript is NOT rewritten — summarization is
// for the *model prompt* only.
//
// 2026-08-04 owner report: LLM summarization on phi4-mini-reasoning blocked
// the next answer for 10+ minutes ("summarizing…" → "Still generating…" →
// "can't reach the model"). Root cause: the summarize path reused the same
// reasoning model + `/api/chat` as full answers. Reasoning models spend most
// of `num_predict` inside `<think>`; a 3-minute client timeout still leaves
// Ollama busy after AbortController closes the HTTP socket, so the follow-on
// answer request queues / times out. Fix: **extractive summary is the default
// pre-send path** (zero Ollama call, instant). Optional LLM summarize stays
// available with a hard ~75s ceiling, tiny `num_predict`, no-CoT instructions,
// and extractive fallback on timeout — never a 10-minute hang.
// ============================================================================

import type { ChatTurn } from '../aiChatContext';
import type { ChatApiMessage, AiGenerateResult } from '../aiService';
import { estimateMessagesTokenCount, estimateTokenCount } from './contextBudget';
import { parseThinkResponse } from './thinkParser';

/** Keep this many most-recent history messages verbatim when a summary is in play (2 user+assistant exchanges). */
export const RECENT_VERBATIM_MESSAGES = 4;

/**
 * Once prior history reaches this many messages, compress everything before the
 * recent window — triggers BEFORE a send that would otherwise send 8+ large
 * turns into `num_ctx`.
 */
export const SUMMARIZE_MESSAGE_THRESHOLD = 8;

/**
 * Also summarize when the older-than-recent portion alone exceeds this rough
 * token estimate (~4 chars/token) — catches a few very long replies before the
 * message-count threshold.
 */
export const OLDER_HISTORY_TOKEN_TRIGGER = 1200;

/**
 * Cap on generated summary tokens when LLM mode is used. Kept tiny on purpose:
 * reasoning models burn `num_predict` on `<think>` first — a 600-token budget
 * was enough to waste minutes without producing useful summary text.
 */
export const SUMMARY_NUM_PREDICT = 180;

/**
 * Hard ceiling for an LLM summarization request. Must stay far below the main
 * chat total timeout — summarize is a side-job, not a full answer. On timeout
 * we fall back to extractive (then cold trim) so the user question still runs.
 */
export const SUMMARY_TIMEOUT_MS = 75_000;

/** Client-side char ceiling after the model returns — belt-and-suspenders vs a runaway summary. */
export const SUMMARY_MAX_CHARS = 3200;

/** Max chars per turn snippet in the extractive digest. */
export const EXTRACTIVE_SNIPPET_CHARS = 160;

/**
 * How to build the rolling summary before a send.
 * - `extractive` (default): local first/last-sentence digest — no Ollama call.
 * - `llm`: optional local-model compress; hard-timeout then extractive fallback.
 */
export type SummarizeMode = 'extractive' | 'llm';

export interface ConversationSummaryState {
  text: string;
  /** Id of the last chat message included in this summary (for rolling reuse). */
  throughMessageId: string;
  updatedAt: number;
}

export function splitHistoryForSummary(
  history: ChatTurn[],
  recentCount: number = RECENT_VERBATIM_MESSAGES,
): { older: ChatTurn[]; recent: ChatTurn[] } {
  if (history.length <= recentCount) {
    return { older: [], recent: [...history] };
  }
  return {
    older: history.slice(0, -recentCount),
    recent: history.slice(-recentCount),
  };
}

/**
 * True when older turns should be (re)summarized before the next model call.
 * False when there is nothing older than the recent window, or an existing
 * summary already covers through the last older message.
 */
export function needsSummarization(
  history: ChatTurn[],
  historyMessageIds: string[],
  existing: ConversationSummaryState | null | undefined,
): boolean {
  const { older } = splitHistoryForSummary(history);
  if (older.length === 0) return false;
  if (historyMessageIds.length !== history.length) {
    // Defensive: ids must align 1:1 with turns for rolling "through" tracking.
    return history.length >= SUMMARIZE_MESSAGE_THRESHOLD
      || estimateMessagesTokenCount(older) >= OLDER_HISTORY_TOKEN_TRIGGER;
  }
  const lastOlderId = historyMessageIds[older.length - 1];
  if (existing?.text.trim() && existing.throughMessageId === lastOlderId) {
    return false;
  }
  if (history.length >= SUMMARIZE_MESSAGE_THRESHOLD) return true;
  if (estimateMessagesTokenCount(older) >= OLDER_HISTORY_TOKEN_TRIGGER) return true;
  // Have older turns that aren't covered yet, but under both thresholds —
  // still prefer a summary when we already had one (rolling fold-in of newly
  // aged turns) so the prompt doesn't suddenly grow raw older text again.
  if (existing?.text.trim()) return true;
  return false;
}

/** Whether a stored summary can be reused as-is for this history snapshot. */
export function canReuseSummary(
  history: ChatTurn[],
  historyMessageIds: string[],
  existing: ConversationSummaryState | null | undefined,
): boolean {
  const { older } = splitHistoryForSummary(history);
  if (older.length === 0 || !existing?.text.trim()) return false;
  if (historyMessageIds.length !== history.length) return false;
  return existing.throughMessageId === historyMessageIds[older.length - 1];
}

/**
 * Turns that still need folding into the rolling summary (plus any prior
 * summary text to merge with). When there is no prior summary, `newTurns` is
 * the full older window.
 */
export function turnsToFoldIntoSummary(
  history: ChatTurn[],
  historyMessageIds: string[],
  existing: ConversationSummaryState | null | undefined,
): { previousSummary: string; newTurns: ChatTurn[]; throughMessageId: string } {
  const { older } = splitHistoryForSummary(history);
  const throughMessageId = historyMessageIds[older.length - 1] ?? '';
  if (!existing?.throughMessageId || !existing.text.trim()) {
    return { previousSummary: '', newTurns: older, throughMessageId };
  }
  const alreadyIdx = historyMessageIds.indexOf(existing.throughMessageId);
  if (alreadyIdx < 0) {
    return { previousSummary: existing.text, newTurns: older, throughMessageId };
  }
  // Newly aged turns: after the last summarized message, up to the end of `older`.
  return {
    previousSummary: existing.text,
    newTurns: history.slice(alreadyIdx + 1, older.length),
    throughMessageId,
  };
}

/** Strip reasoning traces and collapse whitespace for extractive snippets. */
export function snippetOfTurn(content: string, maxChars: number = EXTRACTIVE_SNIPPET_CHARS): string {
  const withoutThink = content.replace(/<think>[\s\S]*?<\/think>/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!withoutThink) return '';
  if (withoutThink.length <= maxChars) return withoutThink;
  // Prefer first sentence; if still long, hard-slice and append a short tail hint.
  const sentenceEnd = withoutThink.search(/[.!?](?:\s|$)/);
  const head =
    sentenceEnd > 40 && sentenceEnd < maxChars - 1
      ? withoutThink.slice(0, sentenceEnd + 1)
      : withoutThink.slice(0, Math.max(0, maxChars - 1)).trimEnd();
  return `${head}…`;
}

/**
 * Zero-Ollama rolling digest: prior summary (if any) + compact snippets of the
 * newly aged turns (first/last of a long window). Fast enough for CPU laptops
 * that a reasoning-model summarize call would stall for minutes.
 */
export function buildExtractiveSummary(previousSummary: string, newTurns: ChatTurn[]): string {
  const parts: string[] = [];
  if (previousSummary.trim()) {
    parts.push(`Prior summary:\n${previousSummary.trim()}`);
  }
  if (newTurns.length === 0) {
    return clampSummaryText(parts.join('\n\n'));
  }
  parts.push('Earlier turns (extractive digest):');
  const maxTurns = 8;
  const selected =
    newTurns.length <= maxTurns
      ? newTurns
      : [...newTurns.slice(0, 3), ...newTurns.slice(-3)];
  if (newTurns.length > maxTurns) {
    parts.push(`(${newTurns.length - 6} middle turns omitted from digest)`);
  }
  for (const t of selected) {
    const label = t.role === 'user' ? 'User' : 'Assistant';
    const snip = snippetOfTurn(t.content);
    if (snip) parts.push(`${label}: ${snip}`);
  }
  return clampSummaryText(parts.join('\n'));
}

/**
 * Compact prompt for optional LLM summarize — structured bullets, forbids
 * chain-of-thought / `<think>` so a reasoning tag does not burn the whole
 * `num_predict` budget before emitting the summary.
 */
export function buildSummarizeMessages(
  previousSummary: string,
  newTurns: ChatTurn[],
): ChatApiMessage[] {
  const transcript = newTurns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  const userContent = previousSummary.trim()
    ? `Previous summary:\n${previousSummary.trim()}\n\nNew turns to fold in:\n${transcript}\n\n` +
      'Write an updated compact summary covering both. Output ONLY the summary.'
    : `Conversation turns to summarize:\n${transcript}\n\n` +
      'Write a compact summary. Output ONLY the summary.';

  return [
    {
      role: 'system',
      content:
        'You compress prior conversation turns into a short rolling summary for an offline ACC ' +
        'admin assistant that runs entirely on the user\'s laptop. Output ONLY the summary ' +
        '(no preamble, no invented facts). Do NOT use chain-of-thought, step-by-step reasoning, ' +
        'or <think> tags — reply with the summary text alone, immediately.\n' +
        'Use these headings when relevant:\n' +
        '- Facts established\n' +
        '- Decisions / conclusions\n' +
        '- Open questions\n' +
        '- Attached record topics (patient/contract chips mentioned)\n' +
        'Keep it under ~200 words. Never claim to send data off-device.',
    },
    { role: 'user', content: userContent },
  ];
}

export function clampSummaryText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

export type EnsureSummaryStatus =
  | 'none'
  | 'reused'
  | 'created'
  | 'failed'
  | 'skipped_empty';

export interface EnsureSummaryResult {
  status: EnsureSummaryStatus;
  /** Summary to inject into the model prompt (undefined when none / failed). */
  summary?: ConversationSummaryState;
  /** History window to send verbatim (recent-only when summary is active or fallback trim). */
  recentHistory: ChatTurn[];
  /** True when the prompt should include a summary block (created or reused). */
  historySummarized: boolean;
  /** True when summarization was required but failed — caller should fall back to cold trim. */
  summaryFailed: boolean;
  /** User-facing note when summaryFailed. */
  summaryFailedMessage?: string;
  /** How the summary was produced (for UI / tests). */
  summarySource?: 'extractive' | 'llm' | 'reused';
}

export const SUMMARY_FAILED_USER_MESSAGE =
  'Could not compress earlier messages (local model busy or timed out) — older turns were left out of context for this reply so it could still run. Your full chat above is unchanged; try again, or start a new chat for a fresh topic.';

export type SummarizeFn = (
  baseUrl: string,
  messages: ChatApiMessage[],
  opts?: {
    timeoutMs?: number;
    numPredict?: number;
    numCtx?: number;
    model?: string;
    numThread?: number | null;
    keepAlive?: string | number;
    temperature?: number;
    signal?: AbortSignal;
  },
) => Promise<AiGenerateResult>;

function makeSummaryState(text: string, throughMessageId: string): ConversationSummaryState {
  return {
    text: clampSummaryText(text),
    throughMessageId,
    updatedAt: Date.now(),
  };
}

function extractiveResult(
  previousSummary: string,
  newTurns: ChatTurn[],
  throughMessageId: string,
  recent: ChatTurn[],
): EnsureSummaryResult {
  const text = buildExtractiveSummary(previousSummary, newTurns);
  if (!text || estimateTokenCount(text) < 1) {
    return {
      status: 'failed',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: true,
      summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
    };
  }
  return {
    status: 'created',
    summary: makeSummaryState(text, throughMessageId),
    recentHistory: recent,
    historySummarized: true,
    summaryFailed: false,
    summarySource: 'extractive',
  };
}

/**
 * Race an LLM summarize call against a hard wall-clock ceiling. Even if
 * `summarizeFn` ignores `timeoutMs` / AbortSignal (hung mock, stuck fetch),
 * this resolves failed within ~SUMMARY_TIMEOUT_MS so the send path continues.
 */
export async function raceSummarizeCall(
  summarizeFn: SummarizeFn,
  baseUrl: string,
  messages: ChatApiMessage[],
  opts: {
    timeoutMs: number;
    numPredict: number;
    numCtx: number;
    model?: string;
    numThread?: number | null;
    keepAlive?: string | number;
    temperature?: number;
    signal?: AbortSignal;
  },
): Promise<AiGenerateResult> {
  if (opts.signal?.aborted) {
    return { ok: false, error: 'Summarize aborted' };
  }
  const localAbort = new AbortController();
  const onParentAbort = () => localAbort.abort();
  opts.signal?.addEventListener('abort', onParentAbort, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<AiGenerateResult>((resolve) => {
    timeoutId = setTimeout(() => {
      localAbort.abort();
      resolve({ ok: false, error: 'Summarize timed out' });
    }, opts.timeoutMs);
  });

  try {
    return await Promise.race([
      summarizeFn(baseUrl, messages, {
        timeoutMs: opts.timeoutMs,
        numPredict: opts.numPredict,
        numCtx: opts.numCtx,
        model: opts.model,
        numThread: opts.numThread,
        keepAlive: opts.keepAlive,
        temperature: opts.temperature,
        signal: localAbort.signal,
      }),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    opts.signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Decide whether to reuse / create / skip a rolling summary for this send.
 * Default mode is extractive (no Ollama). Optional LLM mode uses a hard short
 * timeout and falls back to extractive — never blocks the answer for minutes.
 */
export async function ensureConversationSummary(opts: {
  history: ChatTurn[];
  historyMessageIds: string[];
  existing: ConversationSummaryState | null | undefined;
  baseUrl: string;
  /** Ollama model tag — only used when mode is `llm`. Prefer a fast/instruct tag. */
  model?: string;
  numThread?: number | null;
  keepAlive?: string | number;
  signal?: AbortSignal;
  /** Default `extractive` — see SummarizeMode. */
  mode?: SummarizeMode;
  summarizeFn: SummarizeFn;
}): Promise<EnsureSummaryResult> {
  const {
    history,
    historyMessageIds,
    existing,
    baseUrl,
    model,
    numThread,
    keepAlive,
    signal,
    summarizeFn,
  } = opts;
  const mode: SummarizeMode = opts.mode ?? 'extractive';
  const { older, recent } = splitHistoryForSummary(history);

  if (older.length === 0) {
    return { status: 'none', recentHistory: history, historySummarized: false, summaryFailed: false };
  }

  if (canReuseSummary(history, historyMessageIds, existing) && existing) {
    return {
      status: 'reused',
      summary: existing,
      recentHistory: recent,
      historySummarized: true,
      summaryFailed: false,
      summarySource: 'reused',
    };
  }

  if (!needsSummarization(history, historyMessageIds, existing)) {
    // Under threshold — send normal capped history (caller/buildChatMessages still applies MAX_HISTORY_TURNS).
    return { status: 'none', recentHistory: history, historySummarized: false, summaryFailed: false };
  }

  const { previousSummary, newTurns, throughMessageId } = turnsToFoldIntoSummary(
    history,
    historyMessageIds,
    existing,
  );

  if (!throughMessageId) {
    return { status: 'none', recentHistory: history, historySummarized: false, summaryFailed: false };
  }

  if (newTurns.length === 0 && previousSummary.trim()) {
    // Edge: nothing new to fold but needsSummarization was true — reuse prior text with updated through id.
    const summary = makeSummaryState(previousSummary, throughMessageId);
    return {
      status: 'reused',
      summary,
      recentHistory: recent,
      historySummarized: true,
      summaryFailed: false,
      summarySource: 'reused',
    };
  }

  if (newTurns.length === 0) {
    return {
      status: 'skipped_empty',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: false,
    };
  }

  if (signal?.aborted) {
    // Still try extractive so Stop/Clear mid-flight can leave a usable digest if caller retries;
    // when aborted we report failed so the current send does not pretend success.
    return {
      status: 'failed',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: true,
      summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
    };
  }

  // Default / CPU-safe path: no Ollama call.
  if (mode === 'extractive') {
    return extractiveResult(previousSummary, newTurns, throughMessageId, recent);
  }

  // Optional LLM path — hard-capped; on any failure fall back to extractive (not cold trim first).
  const messages = buildSummarizeMessages(previousSummary, newTurns);
  const result = await raceSummarizeCall(summarizeFn, baseUrl, messages, {
    timeoutMs: SUMMARY_TIMEOUT_MS,
    numPredict: SUMMARY_NUM_PREDICT,
    // Summarization prompts are compact — a smaller ctx saves KV-cache work on CPU laptops.
    numCtx: 2048,
    model,
    numThread,
    keepAlive,
    // Low temperature + no-CoT system prompt: discourage long `<think>` dumps.
    temperature: 0,
    signal,
  });

  if (result.ok) {
    const { answer } = parseThinkResponse(result.text);
    const text = clampSummaryText(answer || result.text);
    if (text && estimateTokenCount(text) >= 1) {
      return {
        status: 'created',
        summary: makeSummaryState(text, throughMessageId),
        recentHistory: recent,
        historySummarized: true,
        summaryFailed: false,
        summarySource: 'llm',
      };
    }
  }

  // LLM timed out / empty / error — extractive keeps the answer path moving.
  const fallback = extractiveResult(previousSummary, newTurns, throughMessageId, recent);
  if (fallback.status === 'created') {
    return fallback;
  }
  return {
    status: 'failed',
    recentHistory: recent,
    historySummarized: false,
    summaryFailed: true,
    summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
  };
}
