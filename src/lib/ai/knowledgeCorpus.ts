// ============================================================================
// Runtime loader for the real ACC narrative-document knowledge base (the
// chunked text of Operational Guidelines / Standard Terms and Conditions /
// provider handbooks — see docs/research/acc-public-contract-sources-2026-08.md
// for where these came from, knowledgeChunking.ts for how they were split,
// and scripts/ingest-acc-schedules.mjs for the build-time generator).
//
// ASSET-SIZE DECISION: the full chunked corpus is ~450KB of real text (5
// narrative documents). Per this app's existing precedent for "large local
// asset, not inlined into the main JS bundle" (see scripts/
// copy-tesseract-assets.mjs / copy-pdf-worker.mjs — Tesseract's ~2-10MB wasm
// data and the PDF.js worker are both copied into public/ and fetched at
// runtime, never `import`ed into a JS chunk), this corpus is shipped as a
// plain JSON file under public/data/acc/knowledge-chunks.json and fetched
// once at runtime — never `import`ed as a TS/JS module. That keeps the
// single-file `dist/index.html` build's main bundle free of ~450KB of static
// text that most sessions may never need to search. The much smaller
// structured price-table data (schedules.json, ~40KB) IS bundled directly
// (see nationalContracts.ts) since it's small enough that the "separate
// runtime asset" tradeoff isn't worth the extra fetch.
//
// Loaded once per app session (module-level cache) and never persisted to
// IndexedDB — it's static, versioned application content (ships with the
// build, identical for every user), not user data, so there's nothing to
// gain from a second storage copy the way there is for e.g. imported
// invoices.
// ============================================================================

import type { KnowledgeChunk } from './knowledgeChunking';
import {
  buildCorpusIndex,
  expandRetrievalQuery,
  isAccServiceScheduleSurveyQuery,
  retrieveTopChunks,
  type RetrievedChunk,
} from './knowledgeRetrieval';

export interface KnowledgeCorpusFile {
  generatedAt: string;
  chunks: KnowledgeChunk[];
}

type CachedCorpus = { chunks: KnowledgeChunk[]; index: ReturnType<typeof buildCorpusIndex> } | null;

let cached: CachedCorpus = null;
let inFlight: Promise<CachedCorpus> | null = null;

async function loadCorpus(): Promise<CachedCorpus> {
  try {
    const res = await fetch('/data/acc/knowledge-chunks.json');
    if (!res.ok) return null;
    const file = (await res.json()) as KnowledgeCorpusFile;
    const chunks = file.chunks ?? [];
    return { chunks, index: buildCorpusIndex(chunks) };
  } catch {
    // Offline-first app — a missing/failed fetch (e.g. this asset wasn't shipped in an older
    // build) must never break the chat; the assistant just runs without narrative RAG context.
    return null;
  }
}

/** Fetches (and caches) the knowledge corpus. Safe to call repeatedly — only fetches once. */
export async function getKnowledgeCorpus(): Promise<CachedCorpus> {
  if (cached) return cached;
  if (!inFlight) inFlight = loadCorpus().then((v) => (cached = v));
  return inFlight;
}

/** Test-only hook to reset the module-level cache between test files. */
export function _resetKnowledgeCorpusCacheForTests(): void {
  cached = null;
  inFlight = null;
}

export interface KnowledgeRetrievalResult {
  results: RetrievedChunk[];
}

/**
 * Retrieves the most relevant real-document chunks for `query`, or an empty array if the corpus
 * failed to load or nothing scored above the relevance threshold.
 *
 * 2026-08-04 speed-research note (default `k=3`, kept as-is): investigated dropping this to `k=2`
 * or shrinking `knowledgeChunking.ts`'s `DEFAULT_MAX_CHUNK_CHARS` (1200) as a speed lever, not just
 * a correctness one, per the owner's "any more ways to optimize" ask. Not applied: on a typical
 * turn the assembled prompt is already well under `numCtx`'s budget (see `contextBudget.ts` /
 * `aiChatContext.test.ts` measurements from the same-day context-overflow fix), so the ACTUAL
 * bottleneck for a slow reply is decode (token generation) throughput, not prefill (prompt
 * processing) — CPU prefill is typically many times faster per-token than decode, so trimming one
 * ~1200-char (~300-token) chunk off an already-comfortably-sized prompt saves a small fraction of a
 * second, not a meaningful chunk of the multi-minute replies the owner is seeing. Meanwhile losing a
 * third of the retrieved evidence on every question is a real, guaranteed quality cost paid on
 * every turn (not just the rare oversized one) for a speed win that doesn't move the needle where
 * the owner's actual pain is. The existing dynamic trim-on-overflow safety net (`trimToBudget` in
 * aiChatContext.ts) already handles the genuine correctness case (a prompt that would NOT fit) by
 * dropping lowest-score chunks reactively — this default is left untouched.
 */
export async function retrieveKnowledgeForQuery(query: string, k = 3): Promise<RetrievedChunk[]> {
  const corpus = await getKnowledgeCorpus();
  if (!corpus || corpus.chunks.length === 0) return [];
  // Expand ACC "schedule"/"other schedules like this" queries so TF-IDF can hit Nursing /
  // Elective Surgery / Allied Health Service Schedule docs (not empty → model inventing bus routes).
  const expanded = expandRetrievalQuery(query);
  const scheduleSurvey = isAccServiceScheduleSurveyQuery(query);
  return retrieveTopChunks(expanded, corpus.chunks, corpus.index, {
    k: scheduleSurvey ? Math.max(k, 5) : k,
    diversifyBySource: scheduleSurvey,
  });
}
