import { describe, expect, it, vi } from 'vitest';
import {
  checkAiServiceStatus,
  extractJsonFromModelText,
  generateLocalAiResponse,
  generateLocalAiChatResponse,
  generateLocalAiChatResponseStream,
  modelListIncludes,
  DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS,
  DEFAULT_CHAT_TOTAL_TIMEOUT_MS,
  DEFAULT_CHAT_TEMPERATURE,
  type ChatApiMessage,
  type FetchLike,
} from './aiService';

/** Builds a fake streaming Response whose body is newline-delimited JSON chunks, split across `chunks` reads — mirrors Ollama's actual `/api/generate`/`/api/chat` `stream: true` wire format. */
function streamResponse(lines: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) controller.enqueue(encoder.encode(line + '\n'));
      controller.close();
    },
  });
  return { ok, status, body, json: async () => ({}) } as unknown as Response;
}

const sampleMessages: ChatApiMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'hello' },
];

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('modelListIncludes', () => {
  it('matches a tagged installed model against an untagged required name (the actual ollama pull shape)', () => {
    // `ollama pull phi4-mini-reasoning` registers as `phi4-mini-reasoning:latest` in `/api/tags` —
    // a bare string-equality check against the untagged required name would never match this.
    expect(modelListIncludes(['phi4-mini-reasoning:latest'], 'phi4-mini-reasoning')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(modelListIncludes(['Phi4-Mini-Reasoning:latest'], 'phi4-mini-reasoning')).toBe(true);
  });

  it('does not match an unrelated model', () => {
    expect(modelListIncludes(['llama3:latest'], 'phi4-mini-reasoning')).toBe(false);
  });

  it('matches regardless of which tag is installed', () => {
    expect(modelListIncludes(['phi4-mini-reasoning:q4_0'], 'phi4-mini-reasoning')).toBe(true);
  });
});

describe('checkAiServiceStatus', () => {
  it('reports available + modelAvailable when the required model (with its real :latest tag) is present', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [{ name: 'phi4-mini-reasoning:latest' }] }));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(true);
    expect(status.modelAvailable).toBe(true);
    expect(status.models).toEqual(['phi4-mini-reasoning:latest']);
    expect(status.error).toBeUndefined();
  });

  it('reports available but NOT modelAvailable when Ollama is up but the required model has not been pulled', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [{ name: 'llama3:latest' }] }));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(true);
    expect(status.modelAvailable).toBe(false);
    expect(status.error).toContain('phi4-mini-reasoning');
    expect(status.error).toContain('ollama pull phi4-mini-reasoning');
  });

  it('reports unavailable (never throws) when the connection is refused, with a specific reachability/CORS-diagnosis message', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(false);
    expect(status.modelAvailable).toBe(false);
    expect(status.error).toContain('http://127.0.0.1:11434/api/tags');
    expect(status.error).toContain('CORS');
    expect(status.error).toContain('OLLAMA_ORIGINS');
  });

  it('reports unavailable on a non-OK HTTP response with the status code in the message', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(false);
    expect(status.modelAvailable).toBe(false);
    expect(status.error).toContain('HTTP 500');
  });

  it('gives a distinct timeout message on abort, not the generic CORS/unreachable one', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });
    });
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(false);
    expect(status.error).toContain('Timed out');
  });

  it('strips a trailing slash on the base URL before calling', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [] }));
    await checkAiServiceStatus('http://127.0.0.1:11434/', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.anything());
  });

  it('accepts a custom requiredModel', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [{ name: 'qwen3-4b-instruct:latest' }] }));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', {
      fetchImpl: fetchImpl as unknown as FetchLike,
      requiredModel: 'qwen3-4b-instruct',
    });
    expect(status.modelAvailable).toBe(true);
  });
});

describe('generateLocalAiResponse', () => {
  it('returns the response text on success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: 'hello from the model' }));
    const result = await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: true, text: 'hello from the model' });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'phi4-mini-reasoning', prompt: 'a prompt', stream: false });
  });

  it('fails gracefully when the service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.ok).toBe(false);
  });

  it('fails gracefully on an empty response body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: '' }));
    const result = await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'Empty response from local AI model' });
  });

  it('surfaces a model-side error field instead of treating it as success', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'model "phi4-mini-reasoning" not found' }));
    const result = await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'model "phi4-mini-reasoning" not found' });
  });

  it('sets a keep_alive and right-sized num_ctx by default (speed tuning)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: 'ok' }));
    await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.keep_alive).toBe('30m');
    expect(body.options?.num_ctx).toBe(8192);
  });

  it('lets a caller override keep_alive and num_ctx', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: 'ok' }));
    await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
      keepAlive: '1h',
      numCtx: 2048,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.keep_alive).toBe('1h');
    expect(body.options.num_ctx).toBe(2048);
  });

  it('uses a custom model name when provided', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ response: 'ok' }));
    await generateLocalAiResponse('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
      model: 'qwen3-4b-instruct',
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).model).toBe('qwen3-4b-instruct');
  });
});

describe('generateLocalAiChatResponse (non-streaming — summarization side-jobs)', () => {
  it('POSTs stream:false to /api/chat and returns message.content', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: { role: 'assistant', content: 'Facts: NS01 discussed.' } }),
    );
    const result = await generateLocalAiChatResponse('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      numPredict: 600,
    });
    expect(result).toEqual({ ok: true, text: 'Facts: NS01 discussed.' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual(sampleMessages);
    expect(body.options.num_predict).toBe(600);
  });

  it('aborts when the caller signal is already aborted', async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const result = await generateLocalAiChatResponse('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      signal: controller.signal,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('generateLocalAiChatResponseStream', () => {
  it('sends the structured messages array against /api/chat (not /api/generate, not a flattened prompt string)', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/chat');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'phi4-mini-reasoning', stream: true });
    expect(body.messages).toEqual(sampleMessages);
    // No manually-flattened prompt string field anywhere in the request body — this is the
    // actual fix for the "hallucinated fake conversation" bug (2026-08-04): the old
    // /api/generate call sent a single `prompt` string with literal "User:"/"Assistant:" text
    // labels, which is exactly the pattern the model kept extending with invented turns.
    expect(body.prompt).toBeUndefined();
  });

  it('accumulates newline-delimited /api/chat streamed chunks (message.content, not response) into the final text, calling onChunk incrementally', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        JSON.stringify({ message: { role: 'assistant', content: 'Hel' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: 'lo ' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: 'world' }, done: false }),
        JSON.stringify({ message: { role: 'assistant', content: '' }, done: true }),
      ]),
    );
    const onChunk = vi.fn();
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      onChunk,
    });
    expect(result).toEqual({ ok: true, text: 'Hello world' });
    expect(onChunk).toHaveBeenCalledWith('Hel');
    expect(onChunk).toHaveBeenLastCalledWith('Hello world');
  });

  it('never bleeds fake extra turns into the parsed output even if a bad model reply keeps emitting content after answering (regression guard for the reported bug)', async () => {
    // Mimics what the owner actually saw: a model that answers, then (absent this fix) would
    // have kept going. Even in that bad-model case, this function's job is just to faithfully
    // accumulate whatever text content Ollama streams back — it must not itself inject, split,
    // or otherwise fabricate turn structure. The REAL fix is upstream (this function's caller
    // now sends `/api/chat`'s structured messages so the model has a real stop signal it didn't
    // have before) — this test documents that the streaming layer was never the place doing the
    // fabricating, and stays a faithful passthrough either way.
    const badModelReply =
      'Hello! How can I assist you today?\n\nUser: Docs have been officially received.\nAssistant: [fake advice]';
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: badModelReply }, done: true })]),
    );
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: true, text: badModelReply });
  });

  it('caps generation with a sane default num_predict so a rambling/looping reply cannot run unbounded', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.options?.num_predict).toBeGreaterThan(0);
    expect(body.options?.num_predict).toBeLessThanOrEqual(4096);
  });

  it('lets a caller override the default num_predict ceiling', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      numPredict: 256,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).options.num_predict).toBe(256);
  });

  it('uses a cooler default temperature so unknown-topic replies are less inventively waffle-y', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).options.temperature).toBe(DEFAULT_CHAT_TEMPERATURE);
    expect(DEFAULT_CHAT_TEMPERATURE).toBeLessThan(0.8);
  });

  it('lets a caller override the default chat temperature', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      temperature: 0.7,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).options.temperature).toBe(0.7);
  });

  it('sets a keep_alive so the model stays warm between chat turns instead of unloading after Ollama\'s 5-minute default', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).keep_alive).toBe('30m');
  });

  it('lets a caller override the default keep_alive', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      keepAlive: -1,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).keep_alive).toBe(-1);
  });

  it('right-sizes num_ctx down from the model\'s 128K default for short chat prompts', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.options?.num_ctx).toBe(8192);
    expect(body.options?.num_ctx).toBeLessThan(131072);
  });

  it('lets a caller override the default num_ctx', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: 'ok' }, done: true })]),
    );
    await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
      numCtx: 16384,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).options.num_ctx).toBe(16384);
  });

  it('correctly reassembles a JSON line split across two stream reads', async () => {
    const encoder = new TextEncoder();
    const full = JSON.stringify({ message: { role: 'assistant', content: 'split across reads' }, done: false }) + '\n';
    const splitAt = 10;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(full.slice(0, splitAt)));
        controller.enqueue(encoder.encode(full.slice(splitAt)));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as unknown as Response);
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: true, text: 'split across reads' });
  });

  it('surfaces a model-side error field found within a streamed chunk', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ error: 'model "phi4-mini-reasoning" not found' })]));
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'model "phi4-mini-reasoning" not found' });
  });

  it('fails gracefully on an empty streamed response', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([JSON.stringify({ message: { role: 'assistant', content: '' }, done: true })]),
    );
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'Empty response from local AI model' });
  });

  it('fails gracefully (never throws) when the service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.ok).toBe(false);
  });

  it('gives a distinct "crashed or stuck" message on timeout/abort, not the status-check wording', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    });
    const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('crashed or got stuck');
      expect(result.error).not.toContain('may still be starting up');
    }
  });

  it('resets the inactivity timeout on each received chunk rather than using one fixed deadline for the whole response', async () => {
    vi.useFakeTimers();
    try {
      let resolveSecondChunk!: () => void;
      const encoder = new TextEncoder();
      let readCount = 0;
      const reader = {
        read: vi.fn(async () => {
          readCount += 1;
          if (readCount === 1) {
            return {
              value: encoder.encode(JSON.stringify({ message: { role: 'assistant', content: 'a' }, done: false }) + '\n'),
              done: false,
            };
          }
          if (readCount === 2) {
            // Hold here until the test manually advances past the (short, test-only) inactivity
            // window, proving progress so far did NOT get killed by the earlier total-timeout style deadline.
            await new Promise<void>((resolve) => {
              resolveSecondChunk = resolve;
            });
            return {
              value: encoder.encode(JSON.stringify({ message: { role: 'assistant', content: 'b' }, done: false }) + '\n'),
              done: false,
            };
          }
          return { value: undefined, done: true };
        }),
      };
      const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as unknown as Response);

      const promise = generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
        fetchImpl: fetchImpl as unknown as FetchLike,
        inactivityTimeoutMs: 1000,
        timeoutMs: 5000,
      });

      // First chunk arrives almost immediately; advance most of the way toward the inactivity
      // deadline WITHOUT tripping it (this alone would have killed the old fixed-deadline design).
      await vi.advanceTimersByTimeAsync(900);
      resolveSecondChunk();
      await vi.advanceTimersByTimeAsync(900);

      const result = await promise;
      expect(result).toEqual({ ok: true, text: 'ab' });
    } finally {
      vi.useRealTimers();
    }
  });

  // 2026-08-04 3rd real owner timeout fix: a genuinely long, actively-progressing CPU-only
  // reasoning reply was being killed by the old 5-minute hard ceiling even though it was never
  // stuck (chunks kept arriving well within the inactivity window throughout) — see the full
  // incident writeup in aiService.ts's DEFAULT_CHAT_TOTAL_TIMEOUT_MS comment.
  it('raised the hard total-timeout ceiling to 15 minutes (was 5) so a healthy long reply is not cut off, while keeping the 2-minute inactivity timer unchanged', () => {
    expect(DEFAULT_CHAT_TOTAL_TIMEOUT_MS).toBe(900_000);
    expect(DEFAULT_CHAT_INACTIVITY_TIMEOUT_MS).toBe(120_000);
  });

  it('does not abort a stream still receiving regular chunks well past the OLD 5-minute ceiling, as long as it finishes before the new 15-minute one', async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      let readCount = 0;
      const TOTAL_CHUNKS = 8;
      // Each chunk arrives 60s apart (well under the 120s inactivity deadline every time), for a
      // total of 8 minutes — comfortably past the old 5-minute ceiling that used to kill this
      // exact healthy pattern, but under the new 15-minute one.
      const reader = {
        read: vi.fn(async () => {
          readCount += 1;
          if (readCount > TOTAL_CHUNKS) return { value: undefined, done: true };
          if (readCount > 1) {
            await vi.advanceTimersByTimeAsync(60_000);
          }
          return {
            value: encoder.encode(
              JSON.stringify({ message: { role: 'assistant', content: `chunk${readCount} ` }, done: false }) + '\n',
            ),
            done: false,
          };
        }),
      };
      const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as unknown as Response);

      const result = await generateLocalAiChatResponseStream('http://127.0.0.1:11434', sampleMessages, {
        fetchImpl: fetchImpl as unknown as FetchLike,
      });

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.text).toContain('chunk8');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('extractJsonFromModelText', () => {
  it('parses a clean JSON array', () => {
    expect(extractJsonFromModelText('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('parses JSON wrapped in a markdown fence', () => {
    const text = 'Sure, here you go:\n```json\n[{"a":1}]\n```\nHope that helps!';
    expect(extractJsonFromModelText(text)).toEqual([{ a: 1 }]);
  });

  it('parses JSON embedded in surrounding prose without a fence', () => {
    const text = 'The answer is [{"a": 1}, {"b": 2}] as requested.';
    expect(extractJsonFromModelText(text)).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('returns null (never throws) on genuinely unparseable text', () => {
    expect(extractJsonFromModelText('I am not sure how to answer that.')).toBeNull();
  });

  it('parses a JSON object literal, not just arrays', () => {
    expect(extractJsonFromModelText('{"ok": true}')).toEqual({ ok: true });
  });
});
