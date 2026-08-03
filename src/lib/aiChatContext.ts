// ============================================================================
// Chat-panel context assembly: draggable/clickable "chips" (Cursor-style file
// chips, but for AdminSuite records) get serialized into a plain-text context
// block that is prepended to the user's message before it is sent to the same
// local model server the duplicate-detection feature already talks to
// (see aiService.ts). Nothing here calls the network — this module is pure
// data-in/text-out so it can be fully unit-tested without a real model.
//
// Trust/transparency: the exact text this module produces is what the chat
// panel shows in each reply's "Context used" expandable section, so a chip's
// serialization must never include more than what a user could see by
// opening that record in the app themselves.
//
// Scope (per the 2026-08 AI-assistant build): only Patient records are a
// chippable context type today. AdminSuite has no Contract/provider-contract
// data model at all (confirmed by searching the codebase) — that is future
// work alongside full contract-PDF-text RAG, see
// docs/research/ai-chat-assistant-2026-08.md.
// ============================================================================

import type { AppData, Claim, Patient } from '../types';
import { CASE_STAGE_LABEL } from './caseWorkflow';
import { formatDateNZ } from './format';
import { buildCaseStageSummary, buildComplianceRuleSummary, buildKnowledgeBaseSections } from './ai/knowledgeBase';

// Re-exported for backwards compatibility with existing callers/tests — the
// actual implementation now lives in lib/ai/knowledgeBase.ts (see that file
// for why: it's the one place future rules/few-shot/RAG-result injection
// plugs into, rather than this prompt-assembly module).
export { buildCaseStageSummary, buildComplianceRuleSummary };

/**
 * One turn of the chat panel's conversation. Lives here (not in
 * state/aiChatStore.ts) so lib/idb.ts can reference this shape for its
 * persisted-history record without importing the zustand store module — that
 * import direction would otherwise create a real idb.ts <-> aiChatStore.ts
 * circular dependency (this module never imports idb.ts).
 */
export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Chips attached when a user message was sent (kept for display on that bubble). */
  chips?: ContextChip[];
  /** The exact serialized context text sent to the model alongside this exchange, for the "Context used" disclosure. */
  contextUsed?: string;
  /**
   * The reasoning-model's chain-of-thought trace (from `<think>...</think>`), stripped out of
   * `content` by `parseThinkResponse` (see lib/ai/thinkParser.ts) before display. Undefined for
   * user messages, and for assistant messages where the model didn't emit a `<think>` block (or
   * it was empty) — never shown as part of the primary bubble, only behind the "Show reasoning"
   * toggle, same transparency pattern as `contextUsed`'s "Context used" disclosure.
   */
  reasoning?: string;
  /** Set when the local model call failed/timed out — rendered as a distinct, non-fatal notice. */
  error?: string;
}

export type ContextChipType = 'patient';

export interface ContextChip {
  /** Stable id so the same record can't be attached twice — `type:recordId`. */
  id: string;
  type: ContextChipType;
  recordId: string;
  /** Display label shown on the chip pill (e.g. the patient's name). */
  label: string;
}

export function makePatientChip(patient: Patient): ContextChip {
  return { id: `patient:${patient.id}`, type: 'patient', recordId: patient.id, label: patient.name || 'Unnamed patient' };
}

function serializeClaimForContext(claim: Claim): string {
  const stage = claim.caseStage ? CASE_STAGE_LABEL[claim.caseStage] : 'unknown';
  const parts = [
    `  - Claim ${claim.claimNumber || claim.acc45Number || claim.id}`,
    `type ${claim.type}`,
    `status ${claim.status}`,
    `case stage: ${stage}`,
  ];
  if (claim.injuryDescription) parts.push(`injury: ${claim.injuryDescription}`);
  if (claim.day1Date) parts.push(`day 1: ${formatDateNZ(claim.day1Date)}`);
  return parts.join(', ');
}

/**
 * Plain-text serialization of one Patient record's real data fields (name,
 * NHI, DOB, notes, and their claims with case stage) — this is exactly what
 * gets shown back to the user in "Context used", so it must stay a faithful,
 * un-embellished rendering of the record and never invent fields the app
 * doesn't actually have.
 */
export function serializePatientContext(patient: Patient, data: AppData): string {
  const claims = data.claims.filter((c) => c.patientId === patient.id);
  const lines = [
    `Patient: ${patient.name || 'Unnamed'}`,
    `NHI: ${patient.nhi || 'not on file'}`,
    `Date of birth: ${patient.dob ? formatDateNZ(patient.dob) : 'not on file'}`,
    `Notes: ${patient.notes?.trim() || 'none'}`,
  ];
  if (claims.length === 0) {
    lines.push('Claims: none on file');
  } else {
    lines.push(`Claims (${claims.length}):`);
    for (const c of claims) lines.push(serializeClaimForContext(c));
  }
  return lines.join('\n');
}

/** Dispatches by chip type. Returns a one-line note for a chip whose record can no longer be found. */
export function serializeChipContext(chip: ContextChip, data: AppData): string {
  if (chip.type === 'patient') {
    const patient = data.patients.find((p) => p.id === chip.recordId);
    if (!patient) return `Patient: (record no longer found — id ${chip.recordId})`;
    return serializePatientContext(patient, data);
  }
  return `(unsupported context type: ${chip.type})`;
}

/**
 * Builds the full "Context used" block for a set of chips, or '' when there
 * are none. Chips are separated by a blank line + a `---` rule so the model
 * (and the transparency UI) can clearly tell where one record ends and the
 * next begins.
 */
export function buildContextBlock(chips: ContextChip[], data: AppData): string {
  if (chips.length === 0) return '';
  return chips.map((c) => serializeChipContext(c, data)).join('\n---\n');
}

// ----------------------------------------------------------------------------
// "Knows the rulebook" grounding — a compact system prompt built from this
// codebase's OWN real domain knowledge (compliance rules, case-stage enum,
// and future few-shot examples / RAG results), assembled by
// lib/ai/knowledgeBase.ts. Not hand-written/invented policy — if the
// underlying rules change, this prompt updates itself automatically next run.
// ----------------------------------------------------------------------------

export const AI_ASSISTANT_SYSTEM_PROMPT = [
  'You are the built-in assistant for ACCAdminsuite, an offline, on-device admin tool for a ' +
    'district nursing ACC (Accident Compensation Corporation, New Zealand) billing/compliance team. ' +
    'You run entirely locally via Ollama on the user\'s own laptop — you must never claim to send, ' +
    'store, or need to send any data anywhere else.',
  'Base your advice ONLY on the real rules and workflow stages below, taken directly from this ' +
    'app\'s own compliance engine and case-workflow model. Do not invent ACC policy, clause numbers, ' +
    'or thresholds that are not listed here — if you are not sure, say so plainly instead of guessing.',
  ...buildKnowledgeBaseSections(),
  'If the user has attached one or more record "chips" (a patient, etc.), a block of that record\'s real ' +
    'data will follow this system message — answer using that data specifically, and do not fabricate ' +
    'details (dates, NHI, notes) that are not present in it. If something the user asks about is not in ' +
    'the attached data, say what is missing rather than guessing.',
  'Keep answers concise and practical for a busy admin/billing worker.',
  'For simple greetings or small talk (e.g. "hello", "thanks", "how are you"), respond briefly ' +
    'and naturally in one or two sentences without extensive reasoning — do not deliberate over what ' +
    'a casual greeting "means". Reserve detailed step-by-step reasoning for genuinely complex ' +
    'questions about specific cases, compliance rules, or data.',
].join('\n\n');

// ----------------------------------------------------------------------------
// Conversation -> model-prompt assembly.
// ----------------------------------------------------------------------------

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_TURNS = 8;

export interface BuildChatPromptOptions {
  history: ChatTurn[];
  chips: ContextChip[];
  data: AppData;
  userMessage: string;
}

export interface BuildChatPromptResult {
  /** Full text sent to generateLocalAiResponse. */
  prompt: string;
  /** Just the serialized chip context, for the "Context used" UI — '' if no chips. */
  contextBlock: string;
}

/**
 * Assembles the final prompt string sent to the local model: grounding
 * system prompt, then the current context-chip block (if any), then a capped
 * window of recent conversation history, then the new user message. Pure
 * string assembly — no network call, so this is trivially unit-testable.
 */
export function buildChatPrompt(opts: BuildChatPromptOptions): BuildChatPromptResult {
  const contextBlock = buildContextBlock(opts.chips, opts.data);
  const recentHistory = opts.history.slice(-MAX_HISTORY_TURNS);

  const sections: string[] = [AI_ASSISTANT_SYSTEM_PROMPT];

  if (contextBlock) {
    sections.push(`Context used (attached by the user for this question):\n${contextBlock}`);
  }

  if (recentHistory.length > 0) {
    const transcript = recentHistory
      .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
      .join('\n');
    sections.push(`Conversation so far:\n${transcript}`);
  }

  sections.push(`User: ${opts.userMessage}\nAssistant:`);

  return { prompt: sections.join('\n\n'), contextBlock };
}
