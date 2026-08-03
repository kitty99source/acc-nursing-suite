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
// Scope: Patient and (as of 2026-08-04) Contract records are chippable
// context types — Contract was added once AdminSuite gained a real Contract
// data model (see types/index.ts `Contract`), extending the `ContextChipType`
// union that was deliberately left open for exactly this in the prior pass.
// Full contract-PDF-text RAG is still NOT built (no real document corpus
// exists yet) — see docs/research/ai-chat-assistant-2026-08.md.
// ============================================================================

import type { AppData, Claim, Contract, Patient } from '../types';
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
  /**
   * True when this assistant message is a user-cancelled partial reply (the "Stop generating"
   * button — see aiChatStore.ts `stopGeneration`), not a genuinely complete response. The partial
   * text streamed so far is kept and shown (never discarded), but visually marked so it's not
   * confused with a real, finished answer — same rationale as Cursor's own chat UI keeping a
   * stopped response's partial text visible rather than vanishing it.
   */
  stopped?: boolean;
}

export type ContextChipType = 'patient' | 'contract';

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

export function makeContractChip(contract: Contract): ContextChip {
  return {
    id: `contract:${contract.id}`,
    type: 'contract',
    recordId: contract.id,
    label: contract.providerName || 'Unnamed contract',
  };
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

/**
 * Plain-text serialization of one Contract record's real data fields — same faithful,
 * un-embellished rendering rule as `serializePatientContext` (this is exactly what's shown back
 * in "Context used"), never invents rate/date/coverage details the record doesn't actually have.
 */
export function serializeContractContext(contract: Contract): string {
  const lines = [
    `Contract: ${contract.providerName || 'Unnamed'}`,
    `Customer number: ${contract.customerNumber || 'not on file'}`,
    `Claims email: ${contract.claimsEmail || 'not on file'}`,
    `Effective: ${formatDateNZ(contract.effectiveFrom) || 'not on file'} to ${
      contract.effectiveTo ? formatDateNZ(contract.effectiveTo) : 'ongoing'
    }`,
    `Service codes covered: ${contract.serviceCodesCovered.length ? contract.serviceCodesCovered.join(', ') : 'none on file'}`,
  ];
  if (contract.rateTable.length === 0) {
    lines.push('Rate table: none on file');
  } else {
    lines.push(`Rate table (${contract.rateTable.length}):`);
    for (const r of contract.rateTable) {
      lines.push(`  - ${r.serviceCode}${r.description ? ` (${r.description})` : ''}: $${r.rate.toFixed(2)}`);
    }
  }
  lines.push(`Notes: ${contract.notes?.trim() || 'none'}`);
  return lines.join('\n');
}

/** Dispatches by chip type. Returns a one-line note for a chip whose record can no longer be found. */
export function serializeChipContext(chip: ContextChip, data: AppData): string {
  if (chip.type === 'patient') {
    const patient = data.patients.find((p) => p.id === chip.recordId);
    if (!patient) return `Patient: (record no longer found — id ${chip.recordId})`;
    return serializePatientContext(patient, data);
  }
  if (chip.type === 'contract') {
    const contract = (data.contracts ?? []).find((c) => c.id === chip.recordId);
    if (!contract) return `Contract: (record no longer found — id ${chip.recordId})`;
    return serializeContractContext(contract);
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
// Conversation -> model-messages assembly.
//
// 2026-08-04 hallucination bug fix: this used to flatten the whole
// conversation into ONE plain-text prompt string with hand-written
// "User:"/"Assistant:" turn labels, sent to Ollama's `/api/generate`
// endpoint. That gives the model a visible, literal, continuable
// transcript pattern to imitate — combined with no real chat-template
// turn-boundary tokens and no `stop` sequences, a reasoning model like
// Phi-4-mini-reasoning has no hard signal for "stop after your own turn"
// and can (and did, per the owner's "hello" report) keep predicting more
// `User:`/`Assistant:` turns of a fully invented conversation.
//
// Fix: build a proper structured `messages` array (`{role, content}[]`) and
// send it to Ollama's `/api/chat` endpoint instead (see aiService.ts
// `generateLocalAiChatResponseStream`). Ollama applies the model's real
// chat template server-side, which has actual turn-boundary tokens the
// model was trained to respect — far more robust than guessing a stop-
// string list to bolt onto `/api/generate`. Each history turn becomes its
// own `user`/`assistant` message (never rendered as literal "User:"/
// "Assistant:" text the model could pattern-match and continue), and the
// system prompt + any attached record context live in a single leading
// `system` message, cleanly separated from the live conversation.
// ----------------------------------------------------------------------------

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** One message in the structured array sent to Ollama's `/api/chat`. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY_TURNS = 8;

export interface BuildChatMessagesOptions {
  history: ChatTurn[];
  chips: ContextChip[];
  data: AppData;
  userMessage: string;
}

export interface BuildChatMessagesResult {
  /** Structured messages array sent to generateLocalAiChatResponseStream (Ollama `/api/chat`). */
  messages: ChatMessage[];
  /** Just the serialized chip context, for the "Context used" UI — '' if no chips. */
  contextBlock: string;
}

/**
 * Assembles the structured `messages` array sent to the local model: one
 * leading `system` message (grounding system prompt + the current
 * context-chip block, if any), then a capped window of recent conversation
 * history as real `user`/`assistant` messages, then the new user message.
 * Pure data assembly — no network call, so this is trivially unit-testable.
 */
export function buildChatMessages(opts: BuildChatMessagesOptions): BuildChatMessagesResult {
  const contextBlock = buildContextBlock(opts.chips, opts.data);
  const recentHistory = opts.history.slice(-MAX_HISTORY_TURNS);

  let systemContent = AI_ASSISTANT_SYSTEM_PROMPT;
  if (contextBlock) {
    systemContent += `\n\nContext used (attached by the user for this question):\n${contextBlock}`;
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: opts.userMessage });

  return { messages, contextBlock };
}
