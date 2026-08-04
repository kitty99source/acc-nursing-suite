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
import { isLikelyTableOfContents } from './tocDetection';

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

// ----------------------------------------------------------------------------
// Near-duplicate-chunk dedup (2026-08-04, follow-up to the same-day
// context-overflow fix). Real incident: a "summarize this contract" question
// retrieved the top 3 chunks by score, and 2-3 of them came from the SAME
// source document (health-contract-terms-conditions) — e.g. a short cover-
// page/signature-block chunk and a substantive "scope of these standard
// terms" chunk. In THAT specific incident the chunks turned out to be
// different (non-overlapping) sections of the document, not literal
// duplicates, and the combined prompt was measured (see contextBudget.ts/
// aiChatContext.test.ts) to fit comfortably under the num_ctx budget — so
// this was not the actual cause of that timeout. It is still a real, valid
// concern on its own terms: nothing here previously stopped two genuinely
// near-identical chunks (e.g. two adjacent, heavily-overlapping paragraphs
// from the same long clause) from both landing in the top-k and wasting a
// retrieval "slot" on redundant content instead of a second, complementary
// source. Fixed by skipping a candidate chunk once it is textually very
// similar (Jaccard token-overlap) to a chunk already selected, so the top-k
// results stay diverse rather than accidentally redundant.
// ----------------------------------------------------------------------------

/** Above this Jaccard token-overlap ratio, a candidate chunk is treated as a near-duplicate of an already-selected one and skipped. */
export const NEAR_DUPLICATE_SIMILARITY_THRESHOLD = 0.8;

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ----------------------------------------------------------------------------
// 2026-08-04 citation-integrity bug fix: `minScore` used to default to `0`,
// which only excludes chunks with literally ZERO overlapping non-stopword
// terms — a chunk that merely shares one or two incidental common words with
// the query (e.g. "criteria", "services") still scored (weakly) above zero
// and was retrieved, attached as a decorative "Sources (N)" citation, and
// handed to the model even when it had nothing to do with what was actually
// asked. Real incident: an owner question about ambulance/emergency
// transport criteria retrieved 3 chunks — none about emergency transport —
// from Elective Surgery ARTP and Nursing travel/eligibility content, purely
// on weak keyword overlap; the model then fabricated a confident answer and
// cited those unrelated chunks as if they supported it.
//
// Empirically probed against the real 415-chunk ingested corpus (see
// aiChatContext.test.ts "citation integrity" tests and the ingestion note in
// docs/research/acc-public-contract-sources-2026-08.md §7): genuinely
// on-topic queries score >=0.22 against real matching chunks (e.g. "When
// does Extended Nursing NS04 need prior approval?" -> 0.56+), while queries
// about topics genuinely absent from the corpus (e.g. the real emergency-
// transport-criteria question) top out around 0.13-0.21 even against their
// closest (still irrelevant) chunk. `MIN_RELEVANT_SCORE` sits in that gap —
// high enough to reject the weak, coincidental-overlap matches that drove
// this bug, without requiring a rewrite to real semantic/embedding search.
// This is a genuine coverage-gap problem, not fixable by retrieval tuning
// alone — see the system-prompt "groundedness"/"OK to say you don't know"
// instructions in aiChatContext.ts for the complementary behavioural fix.
// ----------------------------------------------------------------------------
export const MIN_RELEVANT_SCORE = 0.21;

/**
 * Returns up to `k` chunks most relevant to `query`, ranked by TF-IDF-lite score, excluding any
 * chunk that scores at or below `minScore` (default `MIN_RELEVANT_SCORE` — see above; not just
 * zero-overlap chunks, but weakly/coincidentally-overlapping ones too, so a question on a topic
 * genuinely absent from the corpus retrieves nothing at all rather than an arbitrary "closest of a
 * bad lot" that a model could be misled into citing as if it were real support).
 * Also skips any candidate that is a near-duplicate (see `NEAR_DUPLICATE_SIMILARITY_THRESHOLD`) of
 * a chunk already selected, so redundant/overlapping content from the same source document doesn't
 * crowd out a genuinely different, complementary chunk.
 */
export function retrieveTopChunks(
  query: string,
  chunks: KnowledgeChunk[],
  index: CorpusIndex,
  opts: { k?: number; minScore?: number } = {},
): RetrievedChunk[] {
  const k = opts.k ?? 3;
  const minScore = opts.minScore ?? MIN_RELEVANT_SCORE;
  const ranked = chunks
    // Defense-in-depth backstop, on top of knowledgeChunking.ts already excluding ToC-shaped
    // chunks at ingestion time — catches any corpus asset built before this fix, or a future chunk
    // source this detector wasn't run against. A bare table-of-contents chunk has zero
    // substantive value, so it is never worth injecting regardless of how it happens to score.
    .filter((chunk) => !isLikelyTableOfContents(chunk.text))
    .map((chunk) => ({ chunk, score: scoreChunk(query, chunk, index) }))
    .filter((r) => r.score > minScore)
    .sort((a, b) => b.score - a.score);

  const selected: RetrievedChunk[] = [];
  const selectedTokenSets: Set<string>[] = [];
  for (const candidate of ranked) {
    if (selected.length >= k) break;
    const candidateTokens = new Set(tokenize(candidate.chunk.text));
    const isNearDuplicate = selectedTokenSets.some(
      (existing) => jaccardSimilarity(candidateTokens, existing) > NEAR_DUPLICATE_SIMILARITY_THRESHOLD,
    );
    if (isNearDuplicate) continue;
    selected.push(candidate);
    selectedTokenSets.push(candidateTokens);
  }
  return selected;
}
