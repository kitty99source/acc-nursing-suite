import { describe, expect, it, vi } from 'vitest';
import {
  checkAiServiceStatus,
  extractJsonFromModelText,
  generateLocalAiResponse,
  type FetchLike,
} from './aiService';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('checkAiServiceStatus', () => {
  it('reports available with the model list when the local service responds', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [{ name: 'phi4-mini-reasoning:latest' }] }));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(true);
    expect(status.models).toEqual(['phi4-mini-reasoning:latest']);
  });

  it('reports unavailable (never throws) when the connection is refused', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(false);
    expect(status.error).toBe('Failed to fetch');
  });

  it('reports unavailable on a non-OK HTTP response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, false, 500));
    const status = await checkAiServiceStatus('http://127.0.0.1:11434', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(status.available).toBe(false);
    expect(status.error).toBe('HTTP 500');
  });

  it('strips a trailing slash on the base URL before calling', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ models: [] }));
    await checkAiServiceStatus('http://127.0.0.1:11434/', { fetchImpl: fetchImpl as unknown as FetchLike });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:11434/api/tags', expect.anything());
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
