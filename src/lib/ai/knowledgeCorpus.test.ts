import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetKnowledgeCorpusCacheForTests, getKnowledgeCorpus, retrieveKnowledgeForQuery } from './knowledgeCorpus';

const SAMPLE_FILE = {
  generatedAt: '2026-08-04T00:00:00.000Z',
  chunks: [
    { id: 'nurse-og#0', sourceDocId: 'nurse-og', chunkIndex: 0, text: 'Extended Nursing NS04 requires ACC prior approval after 25 consultations.' },
    { id: 'elective-surgery-og#0', sourceDocId: 'elective-surgery-og', chunkIndex: 0, text: 'The ARTP process is required before most contracted elective surgery procedures.' },
  ],
};

beforeEach(() => {
  _resetKnowledgeCorpusCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _resetKnowledgeCorpusCacheForTests();
});

describe('getKnowledgeCorpus', () => {
  it('fetches and caches the corpus, only calling fetch once across repeated calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_FILE });
    vi.stubGlobal('fetch', fetchMock);

    const a = await getKnowledgeCorpus();
    const b = await getKnowledgeCorpus();
    expect(a?.chunks).toHaveLength(2);
    expect(b).toBe(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/data/acc/knowledge-chunks.json');
  });

  it('degrades gracefully (returns null, never throws) when the asset fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const result = await getKnowledgeCorpus();
    expect(result).toBeNull();
  });

  it('degrades gracefully when the asset responds non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const result = await getKnowledgeCorpus();
    expect(result).toBeNull();
  });
});

describe('retrieveKnowledgeForQuery', () => {
  it('returns relevant chunks with real source doc ids for a matching query', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAMPLE_FILE }));
    const results = await retrieveKnowledgeForQuery('When does Extended Nursing NS04 need prior approval?');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].chunk.sourceDocId).toBe('nurse-og');
  });

  it('returns an empty array (never throws) if the corpus is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const results = await retrieveKnowledgeForQuery('anything');
    expect(results).toEqual([]);
  });
});
