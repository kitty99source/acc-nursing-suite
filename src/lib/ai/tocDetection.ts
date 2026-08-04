// ============================================================================
// Heuristic detector for "table of contents"-shaped text: real ACC narrative
// PDFs (e.g. Elective Surgery Services Operational Guidelines) extract a ToC
// page as plain text that is mostly leader-dot-separated title/page-number
// pairs — no substantive content at all, just section titles and page
// numbers. A chunk shaped like this is genuinely worse than useless as
// injected chat context: it consumes real prompt/context-window budget while
// telling the model nothing it could actually answer a question with (see
// the 2026-08-04 "AI chat timed out summarising a Contract chip" incident,
// where a real ToC chunk was one of three context sources combined into a
// prompt that plausibly exceeded the model's context window).
//
// Used at TWO layers, deliberately: knowledgeChunking.ts excludes ToC-shaped
// chunks entirely at ingestion time (so they never even ship in
// knowledge-chunks.json), and knowledgeRetrieval.ts also filters them out at
// retrieval time as a defense-in-depth backstop for any already-generated
// corpus or future chunk source this detector wasn't run against yet.
// ============================================================================

/**
 * A ToC line looks like `<title> ........................ 12` — a run of 3+
 * dot-leader characters (optionally with spaces mixed in) immediately
 * followed by a bare page number. Ordinary narrative prose essentially never
 * contains this pattern even once; a real ToC page contains dozens.
 */
const TOC_LEADER_PATTERN = /\.{3,}\s*\d{1,4}(?=\s|$)/g;

/** Below this many leader-dot-plus-page-number matches, this is not a ToC page. */
const TOC_LEADER_MATCH_FLOOR = 5;

/**
 * True when `text` looks like a table-of-contents page (a run of leader-dot "<title> ..... <page>"
 * entries) rather than substantive narrative content.
 *
 * Deliberately relies ONLY on the leader-dot signal, not a secondary "numeric/repetitive tokens"
 * density heuristic — an earlier version of this function also flagged chunks as ToC-shaped based
 * on a high ratio of numeric tokens + low unique-word ratio, reasoning that a ToC page is mostly
 * digits and repeated header words. In practice, real ACC contract clause text (heavily numbered
 * sub-clauses like "5.3.1.1", "6.1.4.2.5", price tables with many repeated column headers) matched
 * that same shape just as often as an actual ToC — a real-data test against this app's own
 * `docs/research/raw-text/` corpus found the density heuristic wrongly excluded 49 of 59 flagged
 * chunks (genuine substantive referral/eligibility/pricing clauses), vs. only 10 real ToC pages —
 * i.e. it was net-harmful. The leader-dot pattern alone correctly caught all 10 real ToC pages in
 * that same corpus with zero false positives, so it is kept as the sole signal.
 */
export function isLikelyTableOfContents(text: string): boolean {
  const leaderMatches = text.match(TOC_LEADER_PATTERN);
  return (leaderMatches?.length ?? 0) >= TOC_LEADER_MATCH_FLOOR;
}
