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
  available: boolean;
  models: string[];
  error?: string;
}

const DEFAULT_STATUS_TIMEOUT_MS = 2500;
// Reasoning models run ~10-20 tok/s CPU-only per the research doc — a short
// duplicate-check answer can genuinely take 20-60s. Timeout generously rather
// than false-negative "unavailable" on a laptop that is just slow.
const DEFAULT_GENERATE_TIMEOUT_MS = 60_000;

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
 * Ping the local model server's model-list endpoint. Used to decide whether
 * to show AI features at all — never blocks the UI for more than a couple
 * of seconds even when nothing is listening on that port.
 */
export async function checkAiServiceStatus(
  baseUrl: string,
  opts?: { fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<AiServiceStatus> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const { signal, clear } = withTimeout(opts?.timeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}/api/tags`, { signal });
    if (!res.ok) return { available: false, models: [], error: `HTTP ${res.status}` };
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = Array.isArray(json.models)
      ? json.models.map((m) => String(m?.name ?? '')).filter(Boolean)
      : [];
    return { available: true, models };
  } catch (err) {
    return { available: false, models: [], error: errorMessage(err) };
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
