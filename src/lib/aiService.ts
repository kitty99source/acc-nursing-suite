// ============================================================================
// Local on-device AI service client — talks ONLY to a model server already
// running on this machine (Ollama by default, http://127.0.0.1:11434). No
// data ever leaves the laptop: every request in this file targets a
// loopback/127.0.0.1-style base URL that the user configured in Settings.
//
// This is a thin, dependency-free HTTP client so it stays trivially mockable
// in tests (inject `fetchImpl`) and never requires the real model to be
// running for the test suite to pass. See docs/ai-features-setup.md for the
// one-time setup flow and docs/research/on-device-reasoning-and-call-capture-2026-08.md
// for why Phi-4-mini-reasoning was picked.
//
// Fails gracefully everywhere: a slow/absent/misconfigured local service must
// never crash or block the app — every function here returns a plain result
// object instead of throwing.
// ============================================================================

export type FetchLike = typeof fetch;

export interface AiServiceStatus {
  /** The Ollama server itself responded (regardless of which models it has). */
  available: boolean;
  /** The specific model this app needs (see `DEFAULT_AI_MODEL`) is present, tag-suffix-tolerant. */
  modelAvailable: boolean;
  models: string[];
  /**
   * Human-readable, specific reason when `!available || !modelAvailable` — always one of three
   * distinguishable problems ("server unreachable", "server up but model not pulled", or a raw
   * non-OK HTTP status), never a single generic "not detected" catch-all. See `describeStatusError`.
   */
  error?: string;
}

const DEFAULT_STATUS_TIMEOUT_MS = 2500;
// Reasoning models run ~10-20 tok/s CPU-only per the research doc — a short
// duplicate-check answer can genuinely take 20-60s. Timeout generously rather
// than false-negative "unavailable" on a laptop that is just slow.
const DEFAULT_GENERATE_TIMEOUT_MS = 60_000;

// ----------------------------------------------------------------------------
// Chat-specific timeouts (2026-08-04 real-laptop bug fix). A live chat turn is
// NOT the same situation as the quick status probe or even the structured
// duplicate-check prompt above: Phi-4-mini-reasoning emits a hidden
// chain-of-thought before its visible answer, Ollama may need 10-60s+ to cold
// -load the model into RAM on the first request after a (re)start, and at
// ~10-20 tok/s CPU-only a full reasoning trace can genuinely run 1-3+
// minutes. A fixed 60s deadline for the WHOLE reply — as this file used for
// every generate call until this fix — reports "can't reach the model" on a
// model that is actually fine and simply still thinking, which is exactly
// what the owner hit on the first real chat message.
//
// The fix is two independent numbers, not one bigger number:
//   - DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS: reset on every streamed chunk. This
//     is what actually catches a genuinely stuck/crashed request (Ollama
//     process died mid-response, connection silently dropped) without ever
//     punishing a request that is slow but demonstrably still producing
//     tokens.
//   - DEFAULT_CHAT_TOTAL_TIMEOUT_MS: a hard ceiling regardless of progress,
//     purely as a backstop against a pathological "one token every 100s
//     forever" case that would otherwise never trip the inactivity timer.
const DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS = 120_000;
const DEFAULT_CHAT_TOTAL_TIMEOUT_MS = 300_000;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function withTimeout(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // AbortError from our own timeout — give a clearer message than "The user aborted a request."
    if (err.name === 'AbortError') return 'Timed out waiting for the local AI service';
    return err.message;
  }
  return 'Unknown error contacting the local AI service';
}

/**
 * Ollama tags are `<name>` or `<name>:<tag>` (untagged pulls default to `:latest` server-side).
 * A required model of `phi4-mini-reasoning` must match an installed `phi4-mini-reasoning:latest`
 * (or any other tag) — comparing the raw strings would wrongly report "not detected" forever,
 * since `ollama list` / `/api/tags` never returns a bare untagged name.
 */
function normalizeModelName(name: string): string {
  return name.trim().toLowerCase().split(':')[0];
}

export function modelListIncludes(models: string[], requiredModel: string): boolean {
  const target = normalizeModelName(requiredModel);
  return models.some((m) => normalizeModelName(m) === target);
}

/**
 * Turn a raw fetch failure into a specific, actionable reason instead of a generic "not
 * detected". Browsers deliberately report connection-refused, DNS failure, and CORS-blocked
 * requests with the exact same generic `TypeError: Failed to fetch` (or Safari's `Load failed`)
 * — there is no way for this code to tell those apart, so the message below explains the fast
 * manual way to tell them apart (visiting the URL directly bypasses CORS, since that's a plain
 * navigation, not a cross-origin fetch) rather than pretending we know which one it is.
 */
function describeStatusError(err: unknown, tagsUrl: string): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError') {
      return `Timed out waiting for a response from ${tagsUrl} — Ollama may still be starting up, or nothing is listening on that address.`;
    }
    if (/failed to fetch|networkerror|load failed/i.test(err.message)) {
      return (
        `Could not reach ${tagsUrl} (browser said "${err.message}"). This means either Ollama isn't ` +
        `actually listening there, or the request was blocked by the browser's CORS policy — the two ` +
        `look identical to this app. To tell them apart: open a new browser tab and go directly to ` +
        `${tagsUrl} — if that shows JSON, it's a CORS block (fix: run ` +
        `setx OLLAMA_ORIGINS "http://127.0.0.1:*,http://localhost:*" in a Command Prompt, then quit ` +
        `Ollama from the system tray and reopen it); if that tab also fails to load, Ollama itself ` +
        `isn't running or isn't listening at this address.`
      );
    }
    return err.message;
  }
  return 'Unknown error contacting the local AI service';
}

/**
 * Ping the local model server's model-list endpoint and check whether the specific model this
 * app needs is actually pulled. Used to decide whether to show AI features at all — never blocks
 * the UI for more than a couple of seconds even when nothing is listening on that port.
 *
 * Distinguishes three states rather than collapsing them into one "not detected": the server
 * being unreachable, the server responding but the required model not being pulled yet, and
 * everything being ready — each gets its own specific, self-diagnosable message.
 */
export async function checkAiServiceStatus(
  baseUrl: string,
  opts?: { fetchImpl?: FetchLike; timeoutMs?: number; requiredModel?: string },
): Promise<AiServiceStatus> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const requiredModel = opts?.requiredModel ?? DEFAULT_AI_MODEL;
  const tagsUrl = `${stripTrailingSlash(baseUrl)}/api/tags`;
  const { signal, clear } = withTimeout(opts?.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(tagsUrl, { signal });
    if (!res.ok) {
      return {
        available: false,
        modelAvailable: false,
        models: [],
        error: `Ollama responded with HTTP ${res.status} at ${tagsUrl} — the server is reachable but rejected the request.`,
      };
    }
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = Array.isArray(json.models)
      ? json.models.map((m) => String(m?.name ?? '')).filter(Boolean)
      : [];
    const modelAvailable = modelListIncludes(models, requiredModel);
    return {
      available: true,
      modelAvailable,
      models,
      error: modelAvailable
        ? undefined
        : `Ollama is running, but the model "${requiredModel}" isn't pulled yet — run: ollama pull ${requiredModel}`,
    };
  } catch (err) {
    return { available: false, modelAvailable: false, models: [], error: describeStatusError(err, tagsUrl) };
  } finally {
    clear();
  }
}

export type AiGenerateResult = { ok: true; text: string } | { ok: false; error: string };

export interface AiGenerateOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  model?: string;
}

export const DEFAULT_AI_MODEL = 'phi4-mini-reasoning';

/**
 * Send one prompt to the local model server's generate endpoint (Ollama's
 * `/api/generate`, non-streaming) and return the raw text response. Callers
 * own parsing/validating that text — this function only handles the HTTP
 * round trip and graceful failure.
 */
export async function generateLocalAiResponse(
  baseUrl: string,
  prompt: string,
  opts?: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const model = opts?.model ?? DEFAULT_AI_MODEL;
  const { signal, clear } = withTimeout(opts?.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { response?: unknown; error?: unknown };
    if (typeof json.error === 'string' && json.error.trim()) {
      return { ok: false, error: json.error };
    }
    const text = typeof json.response === 'string' ? json.response : '';
    if (!text.trim()) return { ok: false, error: 'Empty response from local AI model' };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    clear();
  }
}

/**
 * AbortError message for a chat-turn timeout is deliberately distinct from
 * both the quick-status-check message and the generic `errorMessage()` used
 * by the structured (non-chat) `generateLocalAiResponse` above — by the time
 * a chat request's much longer inactivity deadline actually trips, the far
 * more likely explanation is a genuinely stuck/crashed Ollama process, not
 * "still starting up", so the message should say that instead.
 */
function chatErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return (
      'The local AI model stopped responding and this request timed out. This usually means Ollama ' +
      'crashed or got stuck mid-response — try sending the message again, and restart Ollama from the ' +
      'system tray if it keeps happening.'
    );
  }
  return errorMessage(err);
}

export interface AiGenerateStreamOptions {
  fetchImpl?: FetchLike;
  model?: string;
  /** Hard ceiling for the whole request regardless of progress. Default 5 minutes — see DEFAULT_CHAT_TOTAL_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Reset on every chunk received. Default 2 minutes — see DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS. */
  inactivityTimeoutMs?: number;
  /** Called with the ACCUMULATED text so far every time a new streamed chunk arrives (not just the delta). */
  onChunk?: (accumulatedText: string) => void;
}

/**
 * Send one prompt to the local model server's generate endpoint with
 * streaming enabled (Ollama's `/api/generate` with `"stream": true`) and
 * return the final accumulated text once the stream ends. Reads the response
 * body as newline-delimited JSON objects (Ollama's actual streaming wire
 * format: one `{"response": "<token(s)>", "done": false}` object per line,
 * ending with a final `{"done": true, ...}`), calling `onChunk` with the
 * running total after each parsed line so a caller can render partial text
 * live instead of staring at a blank "thinking" spinner for the whole reply.
 *
 * This is the chat panel's entry point (see AiChatPanel.tsx) — kept as a
 * separate function from `generateLocalAiResponse` above rather than adding
 * a `stream` flag to it, since the two have genuinely different timeout
 * shapes (one fixed deadline for a short structured answer vs. an
 * inactivity-reset deadline for a long free-form chat reply) and different
 * callers (duplicate-check vs. the chat panel).
 *
 * Deliberately still targets `/api/generate` (not `/api/chat`) — the chat
 * panel already flattens the whole conversation into one prompt string via
 * `buildChatPrompt` (for the "Context used" transparency disclosure), and
 * Ollama's streaming wire format is identical either way, so switching
 * endpoints would only add prompt-assembly risk for no UX benefit.
 */
export async function generateLocalAiResponseStream(
  baseUrl: string,
  prompt: string,
  opts?: AiGenerateStreamOptions,
): Promise<AiGenerateResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const model = opts?.model ?? DEFAULT_AI_MODEL;
  const inactivityMs = opts?.inactivityTimeoutMs ?? DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS;
  const totalMs = opts?.timeoutMs ?? DEFAULT_CHAT_TOTAL_TIMEOUT_MS;

  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), totalMs);
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
  function resetInactivity() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => controller.abort(), inactivityMs);
  }
  resetInactivity();
  function clearAllTimers() {
    clearTimeout(totalTimer);
    if (inactivityTimer) clearTimeout(inactivityTimer);
  }

  function applyLine(line: string, state: { accumulated: string; error: string | null }): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: { response?: unknown; error?: unknown };
    try {
      parsed = JSON.parse(trimmed) as { response?: unknown; error?: unknown };
    } catch {
      // A chunk boundary can split one JSON line across two reads — an unparseable
      // fragment here is expected, never a reason to fail the whole stream.
      return;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      state.error = parsed.error;
      return;
    }
    if (typeof parsed.response === 'string' && parsed.response) {
      state.accumulated += parsed.response;
      opts?.onChunk?.(state.accumulated);
    }
  }

  try {
    const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: true }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

    const state = { accumulated: '', error: null as string | null };
    const body = res.body as ReadableStream<Uint8Array> | null | undefined;

    if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        resetInactivity();
        buffer += decoder.decode(value, { stream: true });
        let newlineIdx = buffer.indexOf('\n');
        while (newlineIdx >= 0) {
          applyLine(buffer.slice(0, newlineIdx), state);
          buffer = buffer.slice(newlineIdx + 1);
          newlineIdx = buffer.indexOf('\n');
        }
      }
      if (buffer.trim()) applyLine(buffer, state);
    } else {
      // No readable stream body available (some fetch polyfills/mocks) — fall back to a
      // single parsed JSON object, same shape as `generateLocalAiResponse`'s non-streaming path.
      const json = (await res.json()) as { response?: unknown; error?: unknown };
      applyLine(JSON.stringify(json), state);
    }

    if (state.error) return { ok: false, error: state.error };
    if (!state.accumulated.trim()) return { ok: false, error: 'Empty response from local AI model' };
    return { ok: true, text: state.accumulated };
  } catch (err) {
    return { ok: false, error: chatErrorMessage(err) };
  } finally {
    clearAllTimers();
  }
}

/**
 * Extract the first top-level JSON array or object literal from free-form
 * model output. Small reasoning models often wrap JSON in prose or a
 * "```json" fence even when told not to — this is deliberately lenient so a
 * chatty-but-correct answer isn't thrown away, while a genuinely unparseable
 * answer safely falls through to `null` (never throws).
 */
export function extractJsonFromModelText(text: string): unknown | null {
  const trimmed = text.trim();
  const attempts: string[] = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const firstBracket = trimmed.search(/[[{]/);
  if (firstBracket >= 0) {
    const openChar = trimmed[firstBracket];
    const closeChar = openChar === '[' ? ']' : '}';
    const lastClose = trimmed.lastIndexOf(closeChar);
    if (lastClose > firstBracket) {
      attempts.push(trimmed.slice(firstBracket, lastClose + 1));
    }
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next candidate
    }
  }
  return null;
}
