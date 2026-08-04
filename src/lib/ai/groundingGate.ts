// ============================================================================
// Hard pre-flight grounding gate for the AI chat assistant (2026-08-04).
//
// Prompt-only "refuse when no excerpts" instructions FAILED twice in production
// against phi4-mini-reasoning (ba6a96a, ad054e9): with zero RAG chunks the model
// still saw the full static Schedule 5.x / NS04 rulebook (always injected into
// the system prompt) and confabulated that those WERE "emergency transport
// criteria", plus encyclopaedia free-association in <think>. Soft instructions
// are ignored by this CPU reasoning model — so the app must NOT call Ollama at
// all when neither retrieved chunks nor static KB are actually relevant.
//
// This module is the durable fix:
//   1. Score the user question against static compliance rules / case stages
//      with the same TF-IDF-lite scorer used for RAG chunks.
//   2. If retrieval returned nothing AND static KB is not relevant AND no
//      common-terms lexicon hit (and the turn is not a casual greeting /
//      chip-grounded record question) → refuse in app code; never call the model.
//   3. When the model IS called, only inject the static sections that scored
//      above the relevance threshold — never the whole rulebook every turn —
//      plus any matching lexicon acronym definitions (never the whole lexicon).
// ============================================================================

import { CASE_STAGE_LABEL } from '../caseWorkflow';
import {
  complianceKnowledgeFacts,
  type KnowledgeFact,
  buildCaseStageSummary,
} from './knowledgeBase';
import {
  buildCorpusIndex,
  MIN_RELEVANT_SCORE,
  scoreChunk,
  tokenize,
  type RetrievedChunk,
} from './knowledgeRetrieval';
import type { KnowledgeChunk } from './knowledgeChunking';
import { retrieveKnowledgeForQuery } from './knowledgeCorpus';
import {
  buildLexiconSections,
  matchLexiconTerms,
  type LexiconTerm,
} from './commonTermsLexicon';

/**
 * Minimum TF-IDF-lite score for a static compliance rule / case-stages block to
 * count as relevant to the current question. Empirically probed against the real
 * COMPLIANCE_RULES set (2026-08-04):
 *   - "NS04 prior approval" / "25 consult package cap" / provider-travel rules → 0.66–1.0+
 *   - "case stage awaiting nurse docs" → ~0.93 against the stages block
 *   - Weak incidental overlap ("review rights" vs NS05 annual review) → ~0.17
 *   - "emergency transport criteria" / "geneva conventions" / "flight air ambulance" → 0
 * 0.25 sits in the gap: real topic matches pass; coincidental single-word hits and
 * wholly off-topic questions do not. Distinct from `MIN_RELEVANT_SCORE` (RAG corpus)
 * because the static rule corpus is tiny (~15 docs) and produces different IDF scales.
 */
export const MIN_STATIC_RELEVANT_SCORE = 0.25;

/** Cap how many individual static rules we inject even when several score above the threshold — keeps the prompt small and on-topic. */
export const MAX_STATIC_RULES_INJECTED = 5;

/**
 * Deterministic refuse message when the hard gate fires. Shown as a normal assistant
 * bubble; no Sources chips; model never runs.
 */
export const UNGROUNDED_REFUSE_MESSAGE =
  "I don't have grounded ACC material on that in my current knowledge base. I can help with " +
  'nursing/allied-health/elective-surgery schedules, package caps, review/appeal rights, weekly ' +
  'compensation, telehealth, emergency/patient transport, etc. — or ask a clarifying question about which of those you mean.';

/** Pure-greeting / thanks turns that should still reach the model without requiring RAG or static KB. */
const CASUAL_QUERY_RE =
  /^(hi|hello|hey|thanks|thank you|ty|ok|okay|cheers|good morning|good afternoon|good evening|how are you|yo)[\s!.?]*$/i;

export function isCasualChatQuery(query: string): boolean {
  return CASUAL_QUERY_RE.test(query.trim());
}

interface StaticDoc {
  id: string;
  kind: 'rule' | 'case-stages';
  fact?: KnowledgeFact;
  chunk: KnowledgeChunk;
}

function buildStaticDocs(): StaticDoc[] {
  const facts = complianceKnowledgeFacts();
  const docs: StaticDoc[] = facts.map((fact, i) => ({
    id: `rule:${i}:${fact.title}`,
    kind: 'rule' as const,
    fact,
    chunk: {
      id: `rule:${i}`,
      sourceDocId: 'static-compliance',
      chunkIndex: i,
      text: `${fact.title} ${fact.ref ?? ''} ${fact.body}`,
    },
  }));
  docs.push({
    id: 'case-stages',
    kind: 'case-stages',
    chunk: {
      id: 'case-stages',
      sourceDocId: 'static-stages',
      chunkIndex: 0,
      text:
        'case workflow stages claim progress nurse docs ACC approval declined closed: ' +
        Object.values(CASE_STAGE_LABEL).join(' '),
    },
  });
  return docs;
}

// Built once per module load — COMPLIANCE_RULES / CASE_STAGE_LABEL are static.
const STATIC_DOCS = buildStaticDocs();
const STATIC_INDEX = buildCorpusIndex(STATIC_DOCS.map((d) => d.chunk));

export interface ScoredStaticRule {
  fact: KnowledgeFact;
  score: number;
}

export interface StaticKnowledgeRelevance {
  /** Rules scoring above `MIN_STATIC_RELEVANT_SCORE`, best-first, capped. */
  relevantRules: ScoredStaticRule[];
  /** True when the case-stages block scored above the threshold. */
  includeCaseStages: boolean;
  caseStagesScore: number;
  /** Max score across rules + stages — used by the hard gate. */
  maxScore: number;
  /** True when any static section is relevant enough to inject / pass the gate. */
  isRelevant: boolean;
}

/**
 * Scores the user question against the static compliance rulebook and case-stage
 * labels. Pure — no network. Used both for the hard gate and for conditional
 * injection (only relevant rules, not the whole book).
 */
export function scoreStaticKnowledgeRelevance(
  query: string,
  opts: { minScore?: number; maxRules?: number } = {},
): StaticKnowledgeRelevance {
  const minScore = opts.minScore ?? MIN_STATIC_RELEVANT_SCORE;
  const maxRules = opts.maxRules ?? MAX_STATIC_RULES_INJECTED;
  if (tokenize(query).length === 0) {
    return {
      relevantRules: [],
      includeCaseStages: false,
      caseStagesScore: 0,
      maxScore: 0,
      isRelevant: false,
    };
  }

  const scoredRules: ScoredStaticRule[] = [];
  let caseStagesScore = 0;
  let maxScore = 0;

  for (const doc of STATIC_DOCS) {
    const score = scoreChunk(query, doc.chunk, STATIC_INDEX);
    if (score > maxScore) maxScore = score;
    if (doc.kind === 'case-stages') {
      caseStagesScore = score;
      continue;
    }
    if (doc.fact && score > minScore) {
      scoredRules.push({ fact: doc.fact, score });
    }
  }

  scoredRules.sort((a, b) => b.score - a.score);
  const relevantRules = scoredRules.slice(0, maxRules);
  const includeCaseStages = caseStagesScore > minScore;

  return {
    relevantRules,
    includeCaseStages,
    caseStagesScore,
    maxScore,
    isRelevant: relevantRules.length > 0 || includeCaseStages,
  };
}

/**
 * Builds the reference-material system-prompt sections for ONLY the static
 * facts that scored as relevant. Returns [] when nothing is relevant — callers
 * must not fall back to dumping the full rulebook.
 */
export function buildRelevantStaticSections(relevance: StaticKnowledgeRelevance): string[] {
  if (!relevance.isRelevant) return [];

  const sections: string[] = [];
  const framing =
    'REFERENCE MATERIAL for this turn only (injected by the app because it scored as relevant ' +
    'to THIS question — NOT prior user messages, NOT conversation history, NOT something the ' +
    'user "mentioned" or "provided earlier"):';

  if (relevance.relevantRules.length > 0) {
    const rulesBlock = relevance.relevantRules
      .map((r) => `- ${r.fact.title}${r.fact.ref ? ` (${r.fact.ref})` : ''}: ${r.fact.body}`)
      .join('\n');
    sections.push(
      `${framing}\n\nStatic compliance rules that specifically match this question. Use a rule ` +
        `ONLY when it answers what was asked; never mash unrelated rules into a different topic:\n` +
        rulesBlock,
    );
  }

  if (relevance.includeCaseStages) {
    sections.push(
      (relevance.relevantRules.length === 0 ? `${framing}\n\n` : '') +
        'Static case-workflow stages a claim moves through in this app, in order (same ' +
        'reference-material rule — not user-provided history): ' +
        buildCaseStageSummary() +
        '.',
    );
  }

  return sections;
}

export type ChatGroundingDecision =
  | {
      allowModel: false;
      refuseMessage: string;
      retrievedChunks: [];
      staticRelevance: StaticKnowledgeRelevance;
      staticSections: [];
      lexiconHits: [];
      reason: 'no-retrieval-and-static-irrelevant';
    }
  | {
      allowModel: true;
      retrievedChunks: RetrievedChunk[];
      staticRelevance: StaticKnowledgeRelevance;
      staticSections: string[];
      /** Matched common-terms lexicon entries for this turn (may be empty). */
      lexiconHits: LexiconTerm[];
      reason:
        | 'retrieved-chunks'
        | 'static-relevant'
        | 'lexicon-relevant'
        | 'chip-context'
        | 'casual';
    };

export interface EvaluateChatGroundingOptions {
  userMessage: string;
  /** True when the user attached one or more record chips (patient/contract) — chip data is itself grounding. */
  hasChips?: boolean;
  /**
   * Optional pre-retrieved chunks (so callers that already ran retrieval — e.g. buildChatMessages —
   * do not fetch twice). When omitted, this function runs `retrieveKnowledgeForQuery`.
   */
  retrievedChunks?: RetrievedChunk[];
}

/**
 * Hard pre-flight grounding decision. When `allowModel` is false the caller MUST NOT
 * call Ollama (not even for summarization of an empty/off-topic turn) — persist
 * `refuseMessage` as a normal assistant bubble instead.
 *
 * Allow paths (any one is enough):
 *   - RAG returned at least one chunk above `MIN_RELEVANT_SCORE`
 *   - Static compliance/stages scored above `MIN_STATIC_RELEVANT_SCORE`
 *   - Common-terms lexicon hit (acronym/glossary match for this question)
 *   - User attached record chips (answer from chip data)
 *   - Casual greeting/thanks (no knowledge needed)
 */
export async function evaluateChatGrounding(
  opts: EvaluateChatGroundingOptions,
): Promise<ChatGroundingDecision> {
  const staticRelevance = scoreStaticKnowledgeRelevance(opts.userMessage);
  const lexiconHits = matchLexiconTerms(opts.userMessage);
  const lexiconSections = buildLexiconSections(lexiconHits);
  // Lexicon sections append after static rules so acronym definitions sit next to
  // any matching compliance text without replacing it.
  const staticSections = [...buildRelevantStaticSections(staticRelevance), ...lexiconSections];
  const retrievedChunks =
    opts.retrievedChunks ?? (await retrieveKnowledgeForQuery(opts.userMessage));

  if (retrievedChunks.length > 0) {
    return {
      allowModel: true,
      retrievedChunks,
      staticRelevance,
      staticSections,
      lexiconHits,
      reason: 'retrieved-chunks',
    };
  }

  if (staticRelevance.isRelevant) {
    return {
      allowModel: true,
      retrievedChunks: [],
      staticRelevance,
      staticSections,
      lexiconHits,
      reason: 'static-relevant',
    };
  }

  if (lexiconHits.length > 0) {
    return {
      allowModel: true,
      retrievedChunks: [],
      staticRelevance,
      staticSections,
      lexiconHits,
      reason: 'lexicon-relevant',
    };
  }

  if (opts.hasChips) {
    return {
      allowModel: true,
      retrievedChunks: [],
      staticRelevance,
      staticSections: [],
      lexiconHits: [],
      reason: 'chip-context',
    };
  }

  if (isCasualChatQuery(opts.userMessage)) {
    return {
      allowModel: true,
      retrievedChunks: [],
      staticRelevance,
      staticSections: [],
      lexiconHits: [],
      reason: 'casual',
    };
  }

  return {
    allowModel: false,
    refuseMessage: UNGROUNDED_REFUSE_MESSAGE,
    retrievedChunks: [],
    staticRelevance,
    staticSections: [],
    lexiconHits: [],
    reason: 'no-retrieval-and-static-irrelevant',
  };
}

/** Re-export for tests / docs that want a single import surface with the RAG threshold. */
export { MIN_RELEVANT_SCORE };
