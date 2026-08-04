// ============================================================================
// "RAG-lite" relevance scoring for the narrative knowledge base (see
// knowledgeChunking.ts for how chunks are built, knowledgeCorpus.ts for how
// they're loaded at runtime). This is a deliberately simple TF-IDF-style
// keyword-overlap scorer, NOT true semantic/embedding-based search — see the
// module-level doc comment in knowledgeCorpus.ts and the owner-facing
// ingestion report for the honest tradeoff writeup (short version: a
// differently-worded question about the same real topic may not retrieve the
// right chunk; a future upgrade to real vector embeddings would fix that, but
// was judged unnecessary complexity for this app's current local-Ollama-only,
// offline-first setup and modest corpus size).
//
// Why TF-IDF-lite over nothing: pure substring/keyword match (e.g. "does the
// question contain any word also in the chunk") over-retrieves — almost every
// chunk mentions "ACC" and "Supplier". Weighting by how RARE a term is across
// the whole corpus (inverse document frequency) is what makes "elective
// surgery" or "telehealth" pull the actually-relevant chunk instead of
// whichever chunk happens to be first/longest.
// ============================================================================

import type { KnowledgeChunk } from './knowledgeChunking';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'as', 'at', 'by', 'with', 'from',
  'will', 'would', 'can', 'could', 'may', 'might', 'must', 'shall', 'should', 'do', 'does', 'did',
  'have', 'has', 'had', 'not', 'but', 'if', 'so', 'than', 'then', 'there', 'their', 'they', 'them',
  'i', 'you', 'we', 'he', 'she', 'my', 'your', 'our', 'what', 'when', 'where', 'why', 'how', 'who',
  'which', 'about', 'into', 'up', 'out', 'over', 'under', 'again', 'all', 'any', 'each', 'more',
  'most', 'no', 'nor', 'only', 'own', 'same', 'some', 'such', 'too', 'very', 'just', 'also',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

interface CorpusIndex {
  /** Document frequency per term: how many chunks contain it at least once. */
  docFreq: Map<string, number>;
  chunkCount: number;
  /** Cached term-frequency maps per chunk id, so scoring many queries against the same corpus is cheap. */
  termFreq: Map<string, Map<string, number>>;
}

/** Builds a reusable index over a chunk set — call once per corpus, reuse across many `retrieveTopChunks` calls. */
export function buildCorpusIndex(chunks: KnowledgeChunk[]): CorpusIndex {
  const docFreq = new Map<string, number>();
  const termFreq = new Map<string, Map<string, number>>();

  for (const chunk of chunks) {
    const tokens = tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    termFreq.set(chunk.id, tf);
    for (const term of tf.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }

  return { docFreq, chunkCount: chunks.length, termFreq };
}

function idf(index: CorpusIndex, term: string): number {
  const df = index.docFreq.get(term) ?? 0;
  if (df === 0) return 0;
  // Smoothed IDF — never negative, and a term appearing in every chunk still contributes a
  // small non-zero weight rather than exactly zero.
  return Math.log((index.chunkCount + 1) / (df + 0.5)) + 1;
}

/** TF-IDF-style relevance score of `query` against one chunk (via its cached term-frequency map). Higher is more relevant; 0 means no overlapping non-stopword terms at all. */
export function scoreChunk(query: string, chunk: KnowledgeChunk, index: CorpusIndex): number {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return 0;
  const tf = index.termFreq.get(chunk.id);
  if (!tf) return 0;

  const chunkLength = Math.max(1, [...tf.values()].reduce((a, b) => a + b, 0));
  let score = 0;
  for (const term of queryTerms) {
    const termCount = tf.get(term);
    if (!termCount) continue;
    score += (termCount / chunkLength) * idf(index, term);
  }
  return score;
}

export interface RetrievedChunk {
  chunk: KnowledgeChunk;
  score: number;
}

/**
 * Returns up to `k` chunks most relevant to `query`, ranked by TF-IDF-lite score, excluding any
 * chunk that scores at or below `minScore` (default: excludes zero-overlap chunks entirely, so an
 * unrelated question genuinely retrieves nothing rather than an arbitrary "closest of a bad lot").
 */
export function retrieveTopChunks(
  query: string,
  chunks: KnowledgeChunk[],
  index: CorpusIndex,
  opts: { k?: number; minScore?: number } = {},
): RetrievedChunk[] {
  const k = opts.k ?? 3;
  const minScore = opts.minScore ?? 0;
  return chunks
    .map((chunk) => ({ chunk, score: scoreChunk(query, chunk, index) }))
    .filter((r) => r.score > minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
