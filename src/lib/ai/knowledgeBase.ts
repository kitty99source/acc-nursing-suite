// ============================================================================
// "Knows the rulebook" static knowledge for the AI chat assistant's system
// prompt. Pulled out of aiChatContext.ts (2026-08-04) into its own module so
// this is ONE clear place for "what static knowledge does the assistant get
// told about" — the next additions (more rules, a few-shot "here's how we
// handled a similar case before" example set, and eventually real RAG search
// results) all plug in here rather than being scattered across the
// prompt-assembly code.
//
// Per docs/research/ai-chat-assistant-2026-08.md's research on small local
// models: this "structured rules file, programmatically summarised into the
// system prompt" approach — not RAG, not fine-tuning — IS the current
// practitioner-recommended lightweight alternative for a small, mostly-static
// knowledge base at this app's current data volume. See that doc for the
// full research writeup and the "when you have real contract/case history
// data volume" future RAG build plan.
//
// IMPORTANT (2026-08-04 hard-gate follow-up): do NOT dump the full rulebook
// into every turn. `buildKnowledgeBaseSections()` below is the "all rules"
// view kept for tests/docs; production prompt assembly uses
// `buildRelevantStaticSections` from groundingGate.ts so only rules that
// score as relevant to the current question are injected. Off-topic questions
// with zero RAG chunks never receive Schedule 5.x text at all (and never
// reach the model — see evaluateChatGrounding).
//
// Everything here is built PROGRAMMATICALLY from this codebase's own real
// domain data (compliance.ts, caseWorkflow.ts) — never hand-written/invented
// policy text — so if those rules change, the assistant's knowledge updates
// itself automatically next run. No network call, pure data-in/text-out, so
// this stays fully unit-testable without a real model.
// ============================================================================

import { CASE_STAGE_LABEL } from '../caseWorkflow';
import { COMPLIANCE_RULES } from '../compliance';

/**
 * A single self-contained fact/rule the assistant should know. Currently only
 * populated from COMPLIANCE_RULES, but shaped generically so a future
 * owner-editable knowledge source (e.g. a JSON file of "here's how we handled
 * situation X before" examples) can be merged in via the same shape without
 * changing callers.
 */
export interface KnowledgeFact {
  /** Short heading, e.g. a rule title. */
  title: string;
  /** Optional reference/citation shown alongside the title (e.g. an ACC clause). */
  ref?: string;
  /** Plain-language body. */
  body: string;
}

/** The compliance rulebook, reshaped as generic knowledge facts. */
export function complianceKnowledgeFacts(): KnowledgeFact[] {
  return Object.values(COMPLIANCE_RULES).map((r) => ({
    title: r.title,
    ref: r.clauseRef,
    body: r.description,
  }));
}

export function buildComplianceRuleSummary(): string {
  return complianceKnowledgeFacts()
    .map((f) => `- ${f.title}${f.ref ? ` (${f.ref})` : ''}: ${f.body}`)
    .join('\n');
}

export function buildCaseStageSummary(): string {
  return Object.values(CASE_STAGE_LABEL).join(' -> ');
}

/**
 * Few-shot "here's how we handled a similar case before" examples. Not
 * populated yet (no real accumulated case-history corpus exists in this app
 * today) — kept as an explicit, always-empty extension point so a future pass
 * has one obvious place to add owner-curated examples without another
 * refactor. See docs/research/ai-chat-assistant-2026-08.md.
 */
export interface FewShotExample {
  situation: string;
  goodResponse: string;
}

export function fewShotExamples(): FewShotExample[] {
  return [];
}

function buildFewShotSection(): string | null {
  const examples = fewShotExamples();
  if (examples.length === 0) return null;
  const rendered = examples
    .map((e, i) => `Example ${i + 1}:\nSituation: ${e.situation}\nGood response: ${e.goodResponse}`)
    .join('\n\n');
  return `Here is how similar situations have been handled well before — follow the same style/reasoning:\n\n${rendered}`;
}

/**
 * Full static rulebook sections (ALL compliance rules + case stages). Kept for
 * unit tests / docs that want to assert the complete rule text exists. Production
 * chat assembly must use `buildRelevantStaticSections` (groundingGate.ts) instead
 * — injecting this whole block on every turn is what let phi4-mini-reasoning
 * mash Schedule 5.x nursing caps into "emergency transport criteria".
 */
export function buildKnowledgeBaseSections(): string[] {
  const sections = [
    'REFERENCE MATERIAL for this turn only (injected by the app every request — NOT prior user ' +
      'messages, NOT conversation history, NOT something the user "mentioned" or "provided earlier"):\n\n' +
      'Static compliance rules (rule title, ACC schedule/clause reference, plain description). ' +
      'Use a rule ONLY when it specifically answers the question; never mash unrelated rules ' +
      '(e.g. nursing package caps) into an answer about a different topic:\n' +
      buildComplianceRuleSummary(),
    'Static case-workflow stages a claim moves through in this app, in order (same reference-' +
      'material rule — not user-provided history): ' +
      buildCaseStageSummary() +
      '.',
  ];
  const fewShot = buildFewShotSection();
  if (fewShot) sections.push(fewShot);
  return sections;
}
