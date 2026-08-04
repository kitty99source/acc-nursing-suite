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
import { buildCorpusIndex, retrieveTopChunks, type RetrievedChunk } from './knowledgeRetrieval';

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

/** Retrieves the most relevant real-document chunks for `query`, or an empty array if the corpus failed to load or nothing scored above the relevance threshold. */
export async function retrieveKnowledgeForQuery(query: string, k = 3): Promise<RetrievedChunk[]> {
  const corpus = await getKnowledgeCorpus();
  if (!corpus || corpus.chunks.length === 0) return [];
  return retrieveTopChunks(query, corpus.chunks, corpus.index, { k });
}
