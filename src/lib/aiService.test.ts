import { describe, expect, it, vi } from 'vitest';
import {
  checkAiServiceStatus,
  extractJsonFromModelText,
  generateLocalAiResponse,
  modelListIncludes,
  type FetchLike,
} from './aiService';

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
