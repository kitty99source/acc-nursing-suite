import { describe, expect, it, vi } from 'vitest';
import {
  checkAiServiceStatus,
  extractJsonFromModelText,
  generateLocalAiResponse,
  generateLocalAiResponseStream,
  modelListIncludes,
  type FetchLike,
} from './aiService';

/** Builds a fake streaming Response whose body is newline-delimited JSON chunks, split across `chunks` reads — mirrors Ollama's actual `/api/generate` `stream: true` wire format. */
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

describe('generateLocalAiResponseStream', () => {
  it('accumulates newline-delimited streamed chunks into the final text, calling onChunk incrementally', async () => {
    const fetchImpl = vi.fn(async () =>
      streamResponse([
        JSON.stringify({ response: 'Hel', done: false }),
        JSON.stringify({ response: 'lo ', done: false }),
        JSON.stringify({ response: 'world', done: false }),
        JSON.stringify({ response: '', done: true }),
      ]),
    );
    const onChunk = vi.fn();
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'hi', {
      fetchImpl: fetchImpl as unknown as FetchLike,
      onChunk,
    });
    expect(result).toEqual({ ok: true, text: 'Hello world' });
    expect(onChunk).toHaveBeenCalledWith('Hel');
    expect(onChunk).toHaveBeenLastCalledWith('Hello world');
  });

  it('sends stream: true against /api/generate (not stream: false)', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ response: 'ok', done: true })]));
    await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    expect(JSON.parse(init.body)).toMatchObject({ model: 'phi4-mini-reasoning', prompt: 'a prompt', stream: true });
  });

  it('caps generation with a sane default num_predict so a rambling/looping reply cannot run unbounded', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ response: 'ok', done: true })]));
    await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.options?.num_predict).toBeGreaterThan(0);
    expect(body.options?.num_predict).toBeLessThanOrEqual(4096);
  });

  it('lets a caller override the default num_predict ceiling', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ response: 'ok', done: true })]));
    await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
      numPredict: 256,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(JSON.parse(init.body).options.num_predict).toBe(256);
  });

  it('correctly reassembles a JSON line split across two stream reads', async () => {
    const encoder = new TextEncoder();
    const full = JSON.stringify({ response: 'split across reads', done: false }) + '\n';
    const splitAt = 10;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(full.slice(0, splitAt)));
        controller.enqueue(encoder.encode(full.slice(splitAt)));
        controller.close();
      },
    });
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as unknown as Response);
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: true, text: 'split across reads' });
  });

  it('surfaces a model-side error field found within a streamed chunk', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ error: 'model "phi4-mini-reasoning" not found' })]));
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'model "phi4-mini-reasoning" not found' });
  });

  it('fails gracefully on an empty streamed response', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([JSON.stringify({ response: '', done: true })]));
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result).toEqual({ ok: false, error: 'Empty response from local AI model' });
  });

  it('fails gracefully (never throws) when the service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
      fetchImpl: fetchImpl as unknown as FetchLike,
    });
    expect(result.ok).toBe(false);
  });

  it('gives a distinct "crashed or stuck" message on timeout/abort, not the status-check wording', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    });
    const result = await generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
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
            return { value: encoder.encode(JSON.stringify({ response: 'a', done: false }) + '\n'), done: false };
          }
          if (readCount === 2) {
            // Hold here until the test manually advances past the (short, test-only) inactivity
            // window, proving progress so far did NOT get killed by the earlier total-timeout style deadline.
            await new Promise<void>((resolve) => {
              resolveSecondChunk = resolve;
            });
            return { value: encoder.encode(JSON.stringify({ response: 'b', done: false }) + '\n'), done: false };
          }
          return { value: undefined, done: true };
        }),
      };
      const body = { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
      const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, body, json: async () => ({}) }) as unknown as Response);

      const promise = generateLocalAiResponseStream('http://127.0.0.1:11434', 'a prompt', {
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
