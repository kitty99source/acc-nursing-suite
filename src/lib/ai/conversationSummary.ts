// ============================================================================
// Smart conversation summarization for long AI chats (2026-08-04).
//
// Problem: once a chat runs long, raw history alone can overflow `num_ctx` /
// hang Ollama ("Couldn't reach the local AI model"), even after the hard
// timeout raise and oldest-turn trim. Cold-dropping oldest turns loses
// decisions/facts the owner still expects the model to remember.
//
// Approach (Cursor-style): when history past a threshold, compress OLDER
// turns into a short rolling summary kept as system context; keep the most
// recent K messages verbatim; persist the summary with the chat session in
// IndexedDB. Visible transcript is NOT rewritten — summarization is for the
// *model prompt* only. On summarize failure/timeout/abort, fall back to the
// existing aggressive oldest-turn trim and tell the user honestly.
//
// All summarization runs on the same local Ollama model — no PHI leaves the
// laptop. This module is mostly pure (threshold + prompt assembly); the one
// network call is injected via `summarizeFn` so unit tests never need a real
// model.
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

/** Cap on generated summary tokens (`num_predict`) — keeps CPU summarization cheap. */
export const SUMMARY_NUM_PREDICT = 600;

/** Hard ceiling for a summarization request (not the main chat's 15-minute ceiling). */
export const SUMMARY_TIMEOUT_MS = 180_000;

/** Client-side char ceiling after the model returns — belt-and-suspenders vs a runaway summary. */
export const SUMMARY_MAX_CHARS = 3200;

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

/** Compact prompt for the local model — structured bullets, no PHI off-device. */
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
        '(no preamble, no invented facts). Use these headings when relevant:\n' +
        '- Facts established\n' +
        '- Decisions / conclusions\n' +
        '- Open questions\n' +
        '- Attached record topics (patient/contract chips mentioned)\n' +
        'Keep it under ~400 words. Never claim to send data off-device.',
    },
    { role: 'user', content: userContent },
  ];
}

export function clampSummaryText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
}

export type EnsureSummaryStatus = 'none' | 'reused' | 'created' | 'failed' | 'skipped_empty';

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
    signal?: AbortSignal;
  },
) => Promise<AiGenerateResult>;

/**
 * Decide whether to reuse / create / skip a rolling summary for this send.
 * When creation is needed, calls `summarizeFn` (local Ollama) with AbortSignal
 * support — never hangs the main answer stream (caller should await this
 * BEFORE starting the streamed reply).
 */
export async function ensureConversationSummary(opts: {
  history: ChatTurn[];
  historyMessageIds: string[];
  existing: ConversationSummaryState | null | undefined;
  baseUrl: string;
  /** Ollama model tag — should match the Settings profile used for the main reply. */
  model?: string;
  numThread?: number | null;
  keepAlive?: string | number;
  signal?: AbortSignal;
  summarizeFn: SummarizeFn;
}): Promise<EnsureSummaryResult> {
  const { history, historyMessageIds, existing, baseUrl, model, numThread, keepAlive, signal, summarizeFn } =
    opts;
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
    const summary: ConversationSummaryState = {
      text: clampSummaryText(previousSummary),
      throughMessageId,
      updatedAt: Date.now(),
    };
    return {
      status: 'reused',
      summary,
      recentHistory: recent,
      historySummarized: true,
      summaryFailed: false,
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
    return {
      status: 'failed',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: true,
      summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
    };
  }

  const messages = buildSummarizeMessages(previousSummary, newTurns);
  const result = await summarizeFn(baseUrl, messages, {
    timeoutMs: SUMMARY_TIMEOUT_MS,
    numPredict: SUMMARY_NUM_PREDICT,
    // Summarization prompts are compact — a smaller ctx saves KV-cache work on CPU laptops.
    numCtx: 4096,
    model,
    numThread,
    keepAlive,
    signal,
  });

  if (!result.ok) {
    return {
      status: 'failed',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: true,
      summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
    };
  }

  const { answer } = parseThinkResponse(result.text);
  const text = clampSummaryText(answer || result.text);
  if (!text || estimateTokenCount(text) < 1) {
    return {
      status: 'failed',
      recentHistory: recent,
      historySummarized: false,
      summaryFailed: true,
      summaryFailedMessage: SUMMARY_FAILED_USER_MESSAGE,
    };
  }

  const summary: ConversationSummaryState = {
    text,
    throughMessageId,
    updatedAt: Date.now(),
  };
  return {
    status: 'created',
    summary,
    recentHistory: recent,
    historySummarized: true,
    summaryFailed: false,
  };
}
