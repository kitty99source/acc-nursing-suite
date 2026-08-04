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
//
// 2026-08-04 UPDATE (3rd real owner timeout, THIS one caused by the ceiling
// above, not by a stuck model): the owner reported the reply visibly
// reasoning and streaming a real, substantial answer — not frozen — right up
// until it was killed by the timeout. The app's own liveness self-test (see
// `diagnoseTimeout` in AiChatPanel.tsx, added in the prior fix) correctly
// showed Ollama was still responding to a basic ping throughout, which rules
// out a hung/dead process; a stuck stream would also not match "quite far
// through typing out its whole actual response". That leaves exactly one
// remaining explanation: the OLD 5-minute `DEFAULT_CHAT_TOTAL_TIMEOUT_MS` was
// firing on a healthy, still-progressing generation simply because the reply
// was genuinely long. The math supports this: `DEFAULT_CHAT_NUM_PREDICT`
// already caps a reply at 2048 tokens, but at the ~10-20 tok/s CPU-only rate
// this file's own earlier comments already document, JUST the token
// generation for a full 2048-token reply is 2048/10 = ~205s to 2048/20 =
// ~102s — before adding the model's own hidden chain-of-thought overhead
// (which counts against the same 2048-token budget, per Microsoft's Phi-4-
// reasoning technical report showing complex traces commonly running into
// the low thousands of tokens on their own), any cold-load time, and normal
// laptop-under-load slowdown (background AV scan, other apps, thermal
// throttling) that can easily push real-world CPU throughput below the
// "typical" 10-20 tok/s estimate. A genuinely bounded (num_predict-capped),
// actively-progressing generation can legitimately need close to or beyond 5
// minutes end-to-end on this hardware — the old ceiling was cutting off
// exactly the healthy case the inactivity timer is deliberately designed NOT
// to punish.
//
// Fix: keep the inactivity timer exactly as-is (2 minutes, reset per chunk —
// this is still the right, and only necessary, mechanism for detecting a
// TRUE stall/crash: a real freeze produces zero chunks for 2 full minutes,
// which is not a false positive on any known-legitimate slow-but-alive
// case). Raise the hard ceiling from 5 to 15 minutes rather than removing it
// outright — a bounded generation (num_predict=2048) that is still only
// two-thirds done after 15 minutes implies a sustained real-world throughput
// under ~2.3 tok/s, which is far outside even a heavily-loaded-laptop
// estimate and is a reasonable line to draw for "even though technically
// still receiving chunks, this has gone on absurdly long" — while a fully
// healthy worst-case reply (per the math above, well under 4 minutes of
// generation plus a one-off cold-load) now has generous headroom rather than
// being cut off mid-sentence. Removing the ceiling entirely was considered
// and rejected: it is real, cheap insurance against a genuinely pathological
// "one token every 100s forever" case (e.g. Ollama itself degrading under
// memory pressure into a near-stalled-but-technically-still-emitting state)
// that would otherwise never trip the inactivity timer at all.
export const DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS = 120_000;
export const DEFAULT_CHAT_TOTAL_TIMEOUT_MS = 900_000;

// ----------------------------------------------------------------------------
// Generation-length ceiling (2026-08-04 "rambling on 'hello'" bug fix).
//
// Before this fix, the chat panel sent NO `options.num_predict` at all, which
// Ollama treats as unbounded generation. Phi-4-mini-reasoning is trained to
// always emit a `<think>...</think>` chain-of-thought before its answer (see
// lib/ai/thinkParser.ts for the full citation/explanation) — combined with
// no ceiling, a model that starts over-deliberating on a trivial input has
// nothing to stop it from running for a very long time, which is exactly
// what looked like "looping" to the owner. Chosen ceiling: generous enough
// for a genuinely detailed reasoning trace + answer on a real compliance
// question (per Microsoft's own Phi-4-reasoning technical report, complex
// traces commonly run into the low thousands of tokens), but not literally
// unbounded. This is a ceiling, not a target — most replies (including any
// short "hello"-style greeting, per the new brevity system-prompt
// instruction in aiChatContext.ts) will finish well under it.
const DEFAULT_CHAT_NUM_PREDICT = 2048;

// ----------------------------------------------------------------------------
// CPU-only speed tuning (2026-08-04, owner ask: "make it faster" on a
// <16GB-RAM CPU-only Windows laptop running Phi-4-mini-reasoning via Ollama).
// Two concrete, low-risk wins applied here — both are plain Ollama request
// options, not model changes, so quality is unaffected:
//
// 1. `keep_alive` — Ollama's own default is to unload a model from RAM after
//    5 minutes of inactivity (see https://github.com/ollama/ollama/blob/main/docs/faq.md
//    "How do I keep a model loaded in memory or make it unload immediately?").
//    Reloading Phi-4-mini-reasoning's ~2.5GB Q4_K_M weights from disk back
//    into RAM is a genuinely slow cold-start (the existing chat-timeout
//    comments above already document "10-60s+ to cold-load... on the first
//    request after a (re)start"). Since this whole feature's value
//    proposition is repeated local use within one working session, keeping
//    the model warm between messages (not just within one HTTP request) is a
//    real, meaningful win with no downside other than the model continuing to
//    occupy ~3.2GB RAM while idle — well within the 12+GB of headroom the
//    research doc (`docs/research/on-device-reasoning-and-call-capture-2026-08.md`
//    Section 4) already calculated for this hardware class. `"30m"` was
//    chosen over `-1` (indefinite) as a middle ground: long enough that a
//    normal back-and-forth chat session (or returning to the tab after a
//    coffee break) never re-pays the cold-load cost, but not so long that the
//    model stays pinned in RAM for an entire unattended workday if the owner
//    forgets the tab is open. Applied to every `/api/generate` call in this
//    file (`options.keep_alive`... — no: `keep_alive` is a top-level Ollama
//    API field per `docs.ollama.com/api` §Generate, sibling to `model`/
//    `prompt`/`options`, not nested inside `options`), not just chat, so the
//    duplicate-check feature (`patientDuplicateAi.ts`) also benefits from a
//    warm model on repeated use.
// 2. `num_ctx` (context window) — the owner's own `ollama list` output showed
//    this model's max context as 131072 tokens; Ollama silently defaults to
//    that model-card maximum when a request doesn't specify `num_ctx`, which
//    allocates a KV-cache sized for a 128K-token conversation even for a
//    two-line "hello" — a real, avoidable CPU/memory cost on every single
//    request. `4096` was chosen THEN as a safe, generous default — before
//    this app had a Contract chip or real narrative RAG content to inject.
//
//    2026-08-04 UPDATE: 4096 turned out to be genuinely too small for this
//    app's own real feature set once it existed. A live incident: the owner
//    attached a real Contract chip (a 39-row Allied Health rate table) and
//    asked to "summarize it" — the chat combined that chip (~1.7K estimated
//    tokens even before this fix's chip-compaction), a table-of-contents
//    knowledge-retrieval chunk (~1.1K tokens of pure noise — see
//    tocDetection.ts, now filtered out), a substantive terms-and-conditions
//    chunk (~1K tokens), the system/compliance-rules prompt (~1.4K tokens),
//    and conversation history into one request that plausibly EXCEEDED the
//    4096-token budget on the prompt alone, before the model had generated a
//    single token of its own reply — `num_ctx` is the TOTAL window shared
//    between prompt and generation, so there was no room left for Ollama to
//    do anything but choke, which surfaced as "the local AI model stopped
//    responding" (aiService.ts `chatErrorMessage`) rather than an honest
//    "too much context" message.
//
//    Raised to `8192` — not the model's own 131072 maximum, which would be a
//    real, unjustified extra CPU/memory cost on this CPU-only <16GB-RAM
//    hardware for no realistic benefit. Reasoning: with this fix's OTHER two
//    changes also in place (compact Contract-chip rate tables — see
//    aiChatContext.ts `serializeContractContext` — and ToC-chunk filtering —
//    see tocDetection.ts), a realistic worst case (one large Contract chip +
//    a full 8-turn history window + the system/compliance prompt + up to 3
//    retrieved knowledge chunks) estimates to roughly 3.5-4K tokens of
//    prompt — comfortably under half of 8192, leaving genuine headroom for
//    the reserved ~2048-token reply ceiling (`DEFAULT_CHAT_NUM_PREDICT`)
//    PLUS a safety margin, since the char-based token estimate used here and
//    in contextBudget.ts is a rough approximation, not the model's real
//    tokenizer. `16384`+ was considered and rejected for now — it would only
//    matter for a scenario (e.g. several large chips attached at once) that
//    the new preflight safety net (contextBudget.ts `checkContextBudget`,
//    wired into `buildChatMessages`) now catches and refuses cleanly instead
//    of silently sending, so there is no real content this app generates
//    today that 8192 can't already fit with room to spare. Overridable
//    per-call (`numCtx` option) if a future caller genuinely needs more.
// NOT applied, and why (per the owner's own "don't apply blindly" instruction):
//   - `num_thread`: Ollama's own runtime already defaults this to the
//     detected physical CPU core count (`runtime.NumCPU()` server-side) and
//     current (2026) Ollama guidance/community consensus is that manually
//     pinning `num_thread` on a single-user desktop workload rarely beats
//     that auto-detection and can make things WORSE if set too high (thread
//     oversubscription/context-switching overhead) or too low (leaving cores
//     idle) — there is no way to know the real core count of "the owner's
//     laptop" from this codebase, and guessing a fixed number here would be
//     exactly the kind of "apply something without confirming it's real and
//     safe" the ask explicitly warned against. Left unset (Ollama's own
//     default) deliberately; documented here as a real, known, tunable
//     option if the owner ever wants to hand-tune it for their specific CPU
//     (Settings could expose it later as an advanced/optional field).
//   - Quantization: already Q4_K_M (see docs/research doc's own table) — a
//     good speed/quality balance already. A Q4_0 or Q3 variant would trade
//     a further real but modest speed/memory win for a real, non-trivial
//     quality drop on reasoning-heavy tasks specifically (the whole point of
//     picking a "-reasoning" model) — documented here as an existing,
//     available option (`ollama pull phi4-mini-reasoning:<tag>` once such a
//     tag exists) but NOT recommended or applied, per the research doc's own
//     "probably not worth it" framing.
//   - `num_predict`: already tuned to 2048 in the prior fix (see
//     DEFAULT_CHAT_NUM_PREDICT above) — left as-is; already overridable via
//     `numPredict`.
//
// 2026-08-04 FURTHER SPEED RESEARCH (owner ask: "any more ways to optimize
// speed?"). Investigated four more Ollama-level levers; NONE were applied as
// code/request-option changes — all four are either inapplicable to this
// specific CPU-only deployment or a real quality/stability tradeoff not
// backed by evidence it's worth it here. Documented in full (not just "no")
// per the owner's own "don't apply blindly" instruction:
//   - Flash Attention (`OLLAMA_FLASH_ATTENTION=1`): confirmed via Ollama's
//     own source (`envconfig`/`server.go` gating logic, checked against
//     current GitHub issues/PRs as of 2026-08) that Ollama only enables flash
//     attention when `discover.GpuInfoList.FlashAttentionSupported()` is
//     true — i.e. it is a GPU-kernel optimization (NVIDIA Ampere+ or AMD
//     RDNA3+ only) with no CPU code path at all. Setting the env var on a
//     CPU-only machine like the owner's laptop is a silent no-op (confirmed:
//     several open Ollama issues show the exact "flash attention enabled but
//     not supported" warning on GPU hardware that's merely the wrong
//     generation — a machine with NO GPU never even gets that far). Not
//     applied: there is no CPU benefit to capture, and this is a
//     server-process env var anyway (set where `ollama serve` runs), not
//     something this app's request options can control.
//   - KV cache quantization (`OLLAMA_KV_CACHE_TYPE=q8_0`/`q4_0`): confirmed
//     this is REAL and worthwhile in general (roughly halves/quarters KV
//     cache memory with q8_0's quality loss reported as negligible in
//     published benchmarks), but Ollama's own server code requires flash
//     attention to be active for the quantized cache type to take effect at
//     all — with FA unavailable on this CPU-only hardware (see above), this
//     setting would silently fall back to the f16 default, achieving
//     nothing. Not applied for the same underlying reason as flash
//     attention: no working code path on CPU-only Ollama.
//   - `OLLAMA_NUM_PARALLEL` / `num_batch`: these tune how many requests/
//     sequences Ollama processes concurrently — a lever for a shared,
//     multi-user server fielding simultaneous requests. This app is a
//     single laptop with a single local chat panel issuing one request at a
//     time; there is nothing to parallelize, and increasing parallelism
//     settings on an already CPU-core-constrained machine risks WORSE
//     latency for the one real request (competing for the same limited
//     cores) rather than better. Not applied — confirmed not a fit for a
//     single-user workload, per the ask's own caution.
//   - Smaller/different model (e.g. Q4_0 instead of Q4_K_M, or a different
//     CPU-optimized architecture entirely): checked current (2026) GGUF
//     quantization tables for this exact model
//     (huggingface.co/bartowski and tensorblock Phi-4-mini-reasoning-GGUF
//     listings) — Q4_0 is explicitly documented upstream as a "legacy
//     format... very high quality loss - prefer using Q4_K_M" for THIS
//     model specifically (not a generic quantization-ladder assumption);
//     it is very slightly smaller (2.33GB vs 2.49GB) but is not presented
//     anywhere as a speed win on CPU for this architecture, only a
//     memory/quality tradeoff, and a bad one at that. No credible current
//     (2026) CPU-optimized alternative architecture at a comparable
//     reasoning-quality bar was found to be a clear, evidenced upgrade
//     worth the disruption of a model swap. Not applied/recommended — the
//     existing Q4_K_M choice already documented in the research doc as the
//     right speed/quality balance stands; a downgrade here would trade real
//     answer quality for an unproven, likely marginal speed gain.
// See docs/ai-features-setup.md for the Windows-specific, non-code
// owner-actionable tips (process priority, power plan, antivirus exclusion)
// investigated alongside these.
// ----------------------------------------------------------------------------
export const DEFAULT_KEEP_ALIVE = '30m';
export const DEFAULT_NUM_CTX = 8192;

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
  /** Ollama top-level `keep_alive` field — how long to keep the model warm in RAM after this request. Default DEFAULT_KEEP_ALIVE ("30m"). */
  keepAlive?: string | number;
  /** Ollama `options.num_ctx` — context window size in tokens. Default DEFAULT_NUM_CTX (8192); see comment above. */
  numCtx?: number;
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
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        keep_alive: opts?.keepAlive ?? DEFAULT_KEEP_ALIVE,
        options: { num_ctx: opts?.numCtx ?? DEFAULT_NUM_CTX },
      }),
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
/**
 * Marker substring unique to `chatErrorMessage`'s AbortError case — used by `isChatTimeoutError`
 * so a caller (AiChatPanel) can distinguish "this reply specifically timed out" from any other
 * failure (HTTP error, empty response, etc.) without re-parsing prose or comparing whole strings.
 */
const CHAT_TIMEOUT_MARKER = 'crashed or got stuck mid-response';

function chatErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === 'AbortError') {
    return (
      `The local AI model stopped responding and this request timed out. This usually means Ollama ${CHAT_TIMEOUT_MARKER} ` +
      '— try sending the message again, and restart Ollama from the system tray if it keeps happening.'
    );
  }
  return errorMessage(err);
}

/** True when `error` is the specific "this chat reply timed out" message from `chatErrorMessage` above (as opposed to any other chat failure). */
export function isChatTimeoutError(error: string | undefined): boolean {
  return !!error && error.includes(CHAT_TIMEOUT_MARKER);
}

/** One message in Ollama's `/api/chat` structured `messages` array. */
export interface ChatApiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiGenerateStreamOptions {
  fetchImpl?: FetchLike;
  model?: string;
  /**
   * Hard ceiling for the whole request regardless of progress — a loose backstop against a
   * pathological "technically still emitting chunks, but absurdly slow" case, NOT the mechanism
   * for detecting a genuinely stuck/frozen stream (that's `inactivityTimeoutMs`). Default 15
   * minutes — see DEFAULT_CHAT_TOTAL_TIMEOUT_MS for why 15 minutes specifically (2026-08-04 fix:
   * the previous 5-minute value was killing healthy, still-progressing long replies).
   */
  timeoutMs?: number;
  /** Reset on every chunk received. Default 2 minutes — see DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS. */
  inactivityTimeoutMs?: number;
  /** Called with the ACCUMULATED text so far every time a new streamed chunk arrives (not just the delta). */
  onChunk?: (accumulatedText: string) => void;
  /** Hard ceiling on generated tokens (Ollama's `options.num_predict`). Default 2048 — see DEFAULT_CHAT_NUM_PREDICT. */
  numPredict?: number;
  /** Ollama top-level `keep_alive` field — how long to keep the model warm in RAM after this request. Default DEFAULT_KEEP_ALIVE ("30m"). */
  keepAlive?: string | number;
  /** Ollama `options.num_ctx` — context window size in tokens. Default DEFAULT_NUM_CTX (8192); see comment above `DEFAULT_KEEP_ALIVE`. */
  numCtx?: number;
  /**
   * Caller-supplied cancellation signal — e.g. AiChatPanel wires this to the chat store's
   * `beginGeneration()` controller so clicking "Clear chat history"/"New chat" mid-stream actually
   * aborts this request instead of leaving it to keep running (and eventually resolve into a
   * conversation that has already moved on). Independent of, and in addition to, the internal
   * inactivity/total timeouts below — either one aborts the same underlying fetch.
   */
  signal?: AbortSignal;
}

/**
 * Send a structured conversation to the local model server's CHAT endpoint
 * with streaming enabled (Ollama's `/api/chat` with `"stream": true`) and
 * return the final accumulated assistant text once the stream ends.
 *
 * WHY `/api/chat` AND NOT `/api/generate` (2026-08-04 "hallucinated fake
 * conversation" bug fix): this used to be `generateLocalAiResponseStream`,
 * which sent a single manually-flattened prompt STRING (built by
 * `buildChatPrompt` in aiChatContext.ts, with literal "User:"/"Assistant:"
 * text labels) to `/api/generate`. That endpoint applies no chat template
 * and takes no `messages` structure — the model sees one big continuable
 * document that already looks like a multi-turn transcript, and with no
 * `stop` sequences configured, a reasoning model (this app's
 * Phi-4-mini-reasoning) has no hard signal to stop generating after its own
 * turn. On a real laptop this produced exactly what the owner reported: the
 * model answered "hello" and then kept going, inventing further "User:"/
 * "Assistant:" turns of a conversation that never happened. `/api/chat`
 * takes a real `messages: [{role, content}, ...]` array and has Ollama apply
 * the model's own trained chat template server-side (real turn-boundary
 * tokens, not text this code invented) — the model was actually trained to
 * stop at those boundaries, which is what `/api/generate` could never
 * reliably reproduce no matter what stop-strings were guessed.
 *
 * Reads the response body as newline-delimited JSON objects — Ollama's
 * `/api/chat` streaming wire format is one `{"message": {"role":
 * "assistant", "content": "<token(s)>"}, "done": false}` object per line,
 * ending with a final `{"done": true, ...}` (note: unlike `/api/generate`'s
 * `response` field, the text lives at `message.content`) — calling `onChunk`
 * with the running total after each parsed line so a caller can render
 * partial text live instead of staring at a blank "thinking" spinner for the
 * whole reply.
 *
 * This is the chat panel's entry point (see AiChatPanel.tsx) — kept as a
 * separate function from `generateLocalAiResponse` above rather than adding
 * a `stream`/`messages` flag to it, since the two have genuinely different
 * timeout shapes (one fixed deadline for a short structured answer vs. an
 * inactivity-reset deadline for a long free-form chat reply) and different
 * callers (duplicate-check vs. the chat panel) — `generateLocalAiResponse`
 * is a single-shot structured-answer prompt with no multi-turn transcript
 * risk, so it is deliberately left on `/api/generate`.
 */
/**
 * Non-streaming `/api/chat` helper — used for short, bounded side-jobs like
 * conversation summarization (see lib/ai/conversationSummary.ts), NOT for the
 * main chat reply (that stays on the streaming path below). Same structured
 * `messages` array / chat-template behaviour as the stream variant; fixed
 * total timeout (default 60s, overridable) instead of inactivity-reset, since
 * a summarize call is intentionally short (`num_predict` capped by the caller).
 */
export async function generateLocalAiChatResponse(
  baseUrl: string,
  messages: ChatApiMessage[],
  opts?: {
    fetchImpl?: FetchLike;
    model?: string;
    timeoutMs?: number;
    numPredict?: number;
    keepAlive?: string | number;
    numCtx?: number;
    signal?: AbortSignal;
  },
): Promise<AiGenerateResult> {
  if (opts?.signal?.aborted) {
    return { ok: false, error: chatErrorMessage(Object.assign(new Error('Aborted'), { name: 'AbortError' })) };
  }
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const model = opts?.model ?? DEFAULT_AI_MODEL;
  const controller = new AbortController();
  if (opts?.signal) {
    opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: opts?.keepAlive ?? DEFAULT_KEEP_ALIVE,
        options: {
          num_predict: opts?.numPredict ?? DEFAULT_CHAT_NUM_PREDICT,
          num_ctx: opts?.numCtx ?? DEFAULT_NUM_CTX,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = (await res.json()) as { message?: { content?: unknown }; error?: unknown };
    if (typeof json.error === 'string' && json.error.trim()) {
      return { ok: false, error: json.error };
    }
    const text = typeof json.message?.content === 'string' ? json.message.content : '';
    if (!text.trim()) return { ok: false, error: 'Empty response from local AI model' };
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: chatErrorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateLocalAiChatResponseStream(
  baseUrl: string,
  messages: ChatApiMessage[],
  opts?: AiGenerateStreamOptions,
): Promise<AiGenerateResult> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const model = opts?.model ?? DEFAULT_AI_MODEL;
  const inactivityMs = opts?.inactivityTimeoutMs ?? DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS;
  const totalMs = opts?.timeoutMs ?? DEFAULT_CHAT_TOTAL_TIMEOUT_MS;

  const controller = new AbortController();
  if (opts?.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
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
    let parsed: { message?: { content?: unknown }; error?: unknown };
    try {
      parsed = JSON.parse(trimmed) as { message?: { content?: unknown }; error?: unknown };
    } catch {
      // A chunk boundary can split one JSON line across two reads — an unparseable
      // fragment here is expected, never a reason to fail the whole stream.
      return;
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      state.error = parsed.error;
      return;
    }
    const content = parsed.message?.content;
    if (typeof content === 'string' && content) {
      state.accumulated += content;
      opts?.onChunk?.(state.accumulated);
    }
  }

  try {
    const res = await fetchImpl(`${stripTrailingSlash(baseUrl)}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: opts?.keepAlive ?? DEFAULT_KEEP_ALIVE,
        options: {
          num_predict: opts?.numPredict ?? DEFAULT_CHAT_NUM_PREDICT,
          num_ctx: opts?.numCtx ?? DEFAULT_NUM_CTX,
        },
      }),
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
      // single parsed JSON object, same shape as a single `/api/chat` chunk.
      const json = (await res.json()) as { message?: { content?: unknown }; error?: unknown };
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
