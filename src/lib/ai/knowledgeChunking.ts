// ============================================================================
// Splits a real, long narrative ACC document (Operational Guidelines,
// Standard Terms and Conditions, provider handbook) into reasonably-sized,
// independently-retrievable chunks for the "RAG-lite" knowledge base (see
// knowledgeRetrieval.ts for the scorer that picks which chunks to inject into
// a given chat turn). Pure, deterministic, unit-testable text splitting — no
// network/IO here; scripts/ingest-acc-schedules.mjs is what actually reads
// the real files under docs/research/raw-text/ and calls this.
// ============================================================================

export interface KnowledgeChunk {
  /** Stable id: `${sourceDocId}#${chunkIndex}`. */
  id: string;
  sourceDocId: string;
  /** 0-based order of this chunk within its source document. */
  chunkIndex: number;
  text: string;
}

const DEFAULT_MAX_CHUNK_CHARS = 1200;
const DEFAULT_MIN_CHUNK_CHARS = 200;

/**
 * Splits `text` (already-cleaned extracted PDF text) into paragraph-aware
 * chunks of roughly `maxChars` characters. Paragraphs (blank-line-separated
 * blocks) are never split mid-sentence where avoidable — chunks are built by
 * accumulating whole paragraphs until adding the next one would exceed
 * `maxChars`, then starting a new chunk. A single paragraph longer than
 * `maxChars` on its own is kept whole rather than being awkwardly truncated
 * (a slightly-oversized chunk is far less harmful to retrieval quality than a
 * sentence cut off mid-thought).
 *
 * Chunks shorter than `minChars` are merged into the following chunk (avoids
 * a lot of near-useless tiny chunks from page-header/footer noise lines).
 */
export function chunkDocumentText(
  sourceDocId: string,
  text: string,
  opts: { maxChars?: number; minChars?: number } = {},
): KnowledgeChunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHUNK_CHARS;
  const minChars = opts.minChars ?? DEFAULT_MIN_CHUNK_CHARS;

  // Normalise page-break markers (added by our own PDF text extraction, see
  // scripts/ingest-acc-schedules.mjs) and collapse runs of blank lines so paragraph splitting is
  // well-behaved, without discarding real paragraph breaks.
  const cleaned = text
    .replace(/---\s*PAGE\s*\d+\s*---/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .trim();

  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p.length > 0);

  const rawChunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current && current.length + para.length + 1 > maxChars) {
      rawChunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n${para}` : para;
    }
  }
  if (current) rawChunks.push(current);

  // Merge any too-small chunk forward into the next one (or backward into the previous, for a
  // trailing small chunk with nothing after it).
  const merged: string[] = [];
  for (const chunk of rawChunks) {
    if (merged.length > 0 && chunk.length < minChars) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}\n${chunk}`;
    } else {
      merged.push(chunk);
    }
  }
  if (merged.length >= 2 && merged[merged.length - 1].length < minChars) {
    const last = merged.pop()!;
    merged[merged.length - 1] = `${merged[merged.length - 1]}\n${last}`;
  }

  return merged.map((text, chunkIndex) => ({
    id: `${sourceDocId}#${chunkIndex}`,
    sourceDocId,
    chunkIndex,
    text,
  }));
}
