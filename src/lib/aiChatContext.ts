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
import { buildCaseStageSummary, buildComplianceRuleSummary } from './ai/knowledgeBase';
import { sourceDocById } from './acc/sourceDocs';
import type { RetrievedChunk } from './ai/knowledgeRetrieval';
import { DEFAULT_NUM_CTX } from './aiService';
import { checkContextBudget, CONTEXT_TRIM_TRIGGER_RATIO, contextTooLargeMessage } from './ai/contextBudget';
import {
  evaluateChatGrounding,
  UNGROUNDED_REFUSE_MESSAGE,
  type ChatGroundingDecision,
} from './ai/groundingGate';

// Re-exported for backwards compatibility with existing callers/tests — the
// actual implementation now lives in lib/ai/knowledgeBase.ts (see that file
// for why: it's the one place future rules/few-shot/RAG-result injection
// plugs into, rather than this prompt-assembly module).
export { buildCaseStageSummary, buildComplianceRuleSummary };
export { UNGROUNDED_REFUSE_MESSAGE, evaluateChatGrounding };

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
  /** Real ACC source documents retrieved and injected for this exchange (see buildChatMessages) — shown in the "Context used" disclosure alongside `contextUsed` so source citation is visible, not just record-chip context. */
  retrievedSources?: RetrievedSourceCitation[];
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
  /**
   * Set on an assistant reply when one or more OLDER turns had to be dropped from history to fit
   * this request's context budget (see `trimToBudget` in this file) — rendered as a small, honest
   * note so it's clear why the model may no longer "remember" something from several messages
   * back, rather than that looking like an unexplained lapse.
   */
  historyTrimmed?: boolean;
  /**
   * Set when older turns were compressed into a rolling summary for the model prompt (see
   * lib/ai/conversationSummary.ts) — the visible transcript is unchanged; this only flags that
   * the model saw a summary of earlier messages rather than every older turn verbatim.
   */
  historySummarized?: boolean;
  /**
   * Set when summarization was attempted but failed/timed out, so the send fell back to dropping
   * oldest turns (same degradation as `historyTrimmed`, with a clearer reason).
   */
  summaryFallbackTrimmed?: boolean;
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

// ----------------------------------------------------------------------------
// 2026-08-04 context-overflow bug fix: a Contract chip used to dump every
// single rate-table row's full description unconditionally — a real 39-row
// Allied Health schedule serialized to ~6.7K characters (~1.7K estimated
// tokens) on its own, and this app also has schedules with hundreds of rows
// (e.g. Elective Surgery), which would have serialized to tens of thousands
// of characters with no ceiling at all. Combined with knowledge-retrieval
// chunks + the system prompt + conversation history, this was the real cause
// of the owner's "summarize this contract" request timing out (see
// aiService.ts DEFAULT_NUM_CTX comment). Fix: once a contract has "many"
// rows, switch to a compact code+price-only view and cap how many rows are
// listed at all — a genuinely large table's chip payload now stays roughly
// bounded regardless of how many rows the real schedule has, and the user is
// told exactly how to get the missing detail (ask about a specific code)
// rather than the chip silently omitting rows with no explanation.
// ----------------------------------------------------------------------------

/** More than this many rows: drop the (often long) per-row description and show code + price only. */
const CONTRACT_RATE_TABLE_COMPACT_THRESHOLD = 10;
/** Hard ceiling on rows actually listed, even in compact form — protects against a schedule with hundreds of codes (e.g. Elective Surgery) still producing an unbounded chip payload. */
const CONTRACT_RATE_TABLE_MAX_ROWS_SHOWN = 40;

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
    const rows = contract.rateTable;
    const compact = rows.length > CONTRACT_RATE_TABLE_COMPACT_THRESHOLD;
    const shown = rows.slice(0, CONTRACT_RATE_TABLE_MAX_ROWS_SHOWN);
    const hiddenCount = rows.length - shown.length;
    lines.push(
      `Rate table (${rows.length}${
        compact ? ', compact view — code + price only; ask about a specific code for its full description' : ''
      }):`,
    );
    for (const r of shown) {
      lines.push(
        compact
          ? `  - ${r.serviceCode}: $${r.rate.toFixed(2)}`
          : `  - ${r.serviceCode}${r.description ? ` (${r.description})` : ''}: $${r.rate.toFixed(2)}`,
      );
    }
    if (hiddenCount > 0) {
      const exampleCode = rows[shown.length]?.serviceCode ?? shown[0]?.serviceCode;
      lines.push(
        `  ...and ${hiddenCount} more code(s) not shown — ask about a specific code (e.g. "what's the rate ` +
          `for ${exampleCode}?") for detail.`,
      );
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

/**
 * Injected into the system message when RAG-lite retrieval returns zero (or only
 * weak/off-topic) chunks for this turn. Harder than the static system-prompt
 * groundedness text alone — sits immediately next to the empty-retrieval outcome
 * so the model cannot "miss" it. See 2026-08-04 emergency-transport / flight
 * hallucination follow-up.
 */
export const NO_RETRIEVED_EXCERPTS_INSTRUCTION =
  'NO ACC document excerpts were retrieved for this question (topic absent from the knowledge ' +
  'base, or only weak/off-topic keyword overlap). You MUST NOT invent criteria, frameworks, ' +
  'foreign-jurisdiction rules, aircraft/helicopter models, cost ranges, or medical-encyclopaedia ' +
  'content, and MUST NOT mash unrelated static compliance rules (e.g. nursing package caps like ' +
  '25 consults / 105 days / NS04) into an answer about a different topic. Reply briefly in ONE of ' +
  'these two shapes only: (1) one short clarifying question about which NZ ACC document/service ' +
  'they mean, OR (2) plainly that this is not in your current knowledge base. Prefer under ~80 ' +
  'words. No multi-section essay. No fake citations or markdown schedule links like ' +
  '[Schedule 5.11.1](#).';

/**
 * Base system instructions — deliberately WITHOUT the static compliance rulebook.
 * Static rules are injected per-turn only when they score as relevant (see
 * `buildAssistantSystemPrompt` / groundingGate.ts). Dumping Schedule 5.x on every
 * turn let phi4-mini-reasoning invent "Emergency Transport Criteria" from nursing caps.
 */
export const AI_ASSISTANT_SYSTEM_PROMPT_BASE = [
  'You are the built-in assistant for ACCAdminsuite, an offline, on-device admin tool for an ACC ' +
    '(Accident Compensation Corporation, New Zealand) billing/compliance team. Default scope is ' +
    'New Zealand ACC and this app\'s own knowledge base only. This app covers multiple ACC-funded ' +
    'service types with real ingested source material — nursing, elective surgery, and allied ' +
    'health (physiotherapy/occupational therapy/hand therapy/podiatry) — not just district nursing. ' +
    'You run entirely locally via Ollama on the user\'s own laptop — you must never claim to send, ' +
    'store, or need to send any data anywhere else.',
  'Scope lock — NZ ACC / this knowledge base only: do NOT bring in other countries\' frameworks ' +
    '(USA HIPAA, Canadian/American air-ambulance schemes, French/European military systems, ' +
    'Geneva Conventions, Médecins Sans Frontières, IATA, foreign AerMed/EMERT schemes, etc.), ' +
    'invented acronyms (e.g. METLR, ACASAA, AASAA), aircraft models (Eurocopter, Black Hawk, etc.), ' +
    'cost ranges, or general medical-encyclopaedia content unless those exact facts appear in ' +
    'retrieved document excerpts or attached record chips for THIS turn. If they do not appear, ' +
    'they are out of scope — refuse or ask one clarifying question instead of writing an essay. ' +
    'Never invent a named criteria document (e.g. "Emergency Transport Criteria (New Zealand ACC ' +
    'Framework)") that is not literally titled in the provided excerpts or static reference material.',
  'Conversation history vs reference material — CRITICAL: any static compliance rules / case-' +
    'workflow stages shown below are REFERENCE MATERIAL the app injects only when relevant to ' +
    'THIS question. They are NOT prior user messages and NOT "what the user said earlier". NEVER ' +
    'claim the user "provided", "mentioned", or "gave you earlier" compliance rules, schedule ' +
    'numbers, or case stages unless that content literally appears as a prior user or assistant ' +
    'turn in the messages array for this request. A brand-new chat has empty history — do not ' +
    'invent a prior conversation. A "Rolling prior-chat summary" block (if present) is the ONLY ' +
    'compressed prior-chat context; if that block is absent, there is no prior chat context.',
  'Base your advice ONLY on: (1) facts the user stated in the messages array, (2) any static ' +
    'reference material below WHEN present and it specifically covers the topic asked, (3) ' +
    'attached record-chip data, and (4) any real ACC document excerpts retrieved for THIS ' +
    'question (each tagged with its real source document and URL). Do not invent ACC policy, ' +
    'clause numbers, prices, or thresholds that are not present in this material — if you are ' +
    'not sure, say so plainly instead of guessing.',
  'CRITICAL — when document excerpts ARE present below: they have ALREADY been retrieved and ' +
    'given to you for this exact question. Never say "I cannot access external documents" or ' +
    'similar — that is false whenever excerpts are present. Answer directly from them, citing ' +
    'the real source title. Only say something is not covered when it is genuinely absent from ' +
    'everything given to you (see groundedness below) — never as a generic no-access habit.',
  'CRITICAL — when a "NO ACC document excerpts were retrieved" notice is present (or no excerpt ' +
    'block exists for this turn): you MUST answer briefly — either one clarifying question OR a ' +
    'plain "not in my current knowledge base" — NOT a multi-section essay, NOT a comprehensive ' +
    'overview, and NOT a mash-up of unrelated static rules into a fake answer for the asked topic. ' +
    'Cap ungrounded replies to roughly 80 words.',
  'Groundedness — never invent specifics beyond what you were given: use only facts stated by the ' +
    'user in the messages array, or present in the static reference material/attached chip ' +
    'data/retrieved excerpts for this turn. Never invent or substitute place names, dates, ' +
    'amounts, or other concrete details not actually stated (e.g. if the user names two specific ' +
    'places, discuss exactly those two, never a different one). If the answer needs information ' +
    'you were not given, say so plainly (e.g. "the reference material I have doesn\'t specifically ' +
    'cover that") rather than guessing.',
  'Citation integrity — only cite a source you actually used: when you use one of the real ' +
    'document excerpts below to support a specific claim, name its real title (as shown next to ' +
    'the excerpt). Do NOT invent markdown links, fake schedule anchors, or placeholder citations ' +
    'like [Schedule 5.11.1](#). If the retrieved excerpts do not actually address what the user ' +
    'asked (e.g. they are about a different topic, or only share a few incidental words with the ' +
    'question), do NOT cite them, and do NOT let their mere presence make an otherwise-invented ' +
    'answer look grounded. It is a serious error to attach a source as if it supports content that ' +
    'source does not actually contain.',
  'It is OK, and preferred, to say you do not know rather than fabricate: if the excerpts/rules/' +
    'chip data given to you do not specifically cover the topic asked (e.g. a clinical/ambulance/' +
    'emergency-transport classification, flight/helicopter criteria, a specific numeric threshold, ' +
    'a named scheme), say plainly that your current knowledge base does not have grounded ' +
    'information on that specific topic — do not invent a plausible-sounding "general knowledge" ' +
    'answer dressed up as if it were ACC policy. Never invent specific numbers, timeframes, or ' +
    'named classification systems/schemes (e.g. a "Red/Silver/Gold" triage system) unless they ' +
    'literally appear in the material given to you. This applies even under your own step-by-step ' +
    'reasoning — do not reason your way into "since I lack real access, I will rely on general ' +
    'knowledge" and then present the result as if it were grounded; the correct move when you ' +
    'genuinely lack grounding is to say so, not to guess confidently.',
  'It is also OK to ask a brief clarifying question instead of guessing: if the user\'s question is ' +
    'ambiguous or under-specified in a way that would force you to guess a key detail to answer well ' +
    '(e.g. which specific scenario, service, timeframe, or document they mean), ask ONE short, ' +
    'targeted clarifying question rather than answering broadly on a guess. Keep it brief — one ' +
    'question, not an interrogation — the same way a good coding assistant asks one clarifying ' +
    'question about an ambiguous request rather than guessing at requirements.',
  'IMPORTANT distinction: any ACC Service Schedule / price-table content shown to you is ACC\'s ' +
    'NATIONAL PUBLISHED TEMPLATE (the same public document ACC applies to every supplier of that ' +
    'service type) — it is NEVER this specific organisation\'s own signed, negotiated contract. If ' +
    'asked about "our contract" specifically, say that the national schedule is real grounding but ' +
    'this organisation\'s own contract number, named-provider list, or any negotiated rate variation ' +
    'is not in this data and would need to come from their own contracts/records team.',
  'When you use one of the real document excerpts shown below to answer, mention which source ' +
    'document it came from (e.g. "per the Nursing Services Service Schedule...") so the user can see ' +
    'where the information came from — do not present it as if you already knew it. Prefer short ' +
    'bullets over filler "comprehensive overview" prose when excerpts are on-topic.',
  'If the user has attached one or more record "chips" (a patient, etc.), a block of that record\'s real ' +
    'data will follow this system message — answer using that data specifically, and do not fabricate ' +
    'details (dates, NHI, notes) that are not present in it. If something the user asks about is not in ' +
    'the attached data, say what is missing rather than guessing.',
  'Keep answers concise and practical for a busy admin/billing worker. Prefer bullets. Avoid long ' +
    'authoritative essays when the material does not support them.',
  'For simple greetings or small talk (e.g. "hello", "thanks", "how are you"), respond briefly ' +
    'and naturally in one or two sentences without extensive reasoning — do not deliberate over what ' +
    'a casual greeting "means". Reserve detailed step-by-step reasoning for genuinely complex ' +
    'questions about specific cases, compliance rules, or data that ARE covered by the material above.',
].join('\n\n');

/**
 * Alias kept for existing tests/callers that assert instruction text. Static compliance
 * sections are NO LONGER part of this constant — they are injected per-turn via
 * `buildAssistantSystemPrompt(staticSections)` only when relevant.
 */
export const AI_ASSISTANT_SYSTEM_PROMPT = AI_ASSISTANT_SYSTEM_PROMPT_BASE;

/** Assembles the system message: base instructions + any per-turn relevant static KB sections. */
export function buildAssistantSystemPrompt(staticSections: string[] = []): string {
  if (staticSections.length === 0) return AI_ASSISTANT_SYSTEM_PROMPT_BASE;
  return [AI_ASSISTANT_SYSTEM_PROMPT_BASE, ...staticSections].join('\n\n');
}

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

// ----------------------------------------------------------------------------
// 2026-08-04 multi-turn timeout fix (owner report: chat works fine for the
// first ~2-3 exchanges, then "Couldn't reach the local AI model" starts
// happening again in the SAME conversation). Root cause, confirmed by
// re-reading this file's own `trimToBudget` before this fix: `MAX_HISTORY_TURNS`
// above caps history by MESSAGE COUNT (8 messages = 4 user/assistant pairs),
// not by size — and the PRIOR fix in this same file (the 15-minute total
// timeout raise in aiService.ts) deliberately let real assistant replies run
// much longer (up to `DEFAULT_CHAT_NUM_PREDICT` = 2048 tokens each) instead of
// being cut off early. Those two changes combined are exactly the gap: by
// turn 3-4, the last 8 raw messages can include 3-4 of those now-much-longer
// assistant replies, which alone can approach or exceed `DEFAULT_NUM_CTX`
// (8192) even before the system prompt, any attached chip, and any retrieved
// knowledge chunk are added — and the old `trimToBudget` (see below) only
// ever dropped retrieved knowledge chunks to make room, NEVER history itself,
// so a prompt that the char-based budget estimate judged "just barely fits"
// could still exceed the model's REAL tokenizer count (this estimate is
// explicitly documented in contextBudget.ts as a rough ~4-chars/token
// approximation, not the model's actual vocabulary) and get sent to Ollama
// anyway — which is the raw "stuck/crashed" timeout the owner saw, not the
// honest, pre-flight `contextTooLargeMessage` refusal this app already has
// for the single-turn case.
//
// Investigated and RULED OUT as contributing causes (see aiChatContext.test.ts
// for the regression tests backing these):
//   - Context-chip re-injection: `assembleMessages` below DOES re-serialize
//     and re-send a chip's full content in the system message on every turn.
//     This looks redundant at first glance, but it is NOT a bug: unlike a real
//     multi-turn transcript, the system message itself (where chip content
//     lives) is NEVER persisted into `history` — only the user/assistant TEXT
//     of each turn is. If chip content were only sent once, the model would
//     genuinely forget the attached patient/contract's details after turn 1.
//     This is a constant, bounded cost per request (proportional to the
//     number of attached chips, which does not grow with conversation
//     length), not a per-turn-compounding one — real, but not THE bug.
//   - Retrieved knowledge chunks: `retrieveKnowledgeForQuery` (called fresh
//     in `buildChatMessages` below) runs once per NEW user message and
//     replaces the previous turn's chunks entirely — it does not
//     accumulate/append across turns. Confirmed correct, no fix needed.
//
// Fix: `trimToBudget` now has a second trimming pass. After exhausting every
// retrievable knowledge chunk (unchanged priority — those are the cheapest,
// least-relevant-by-construction thing to lose), if the assembled prompt
// STILL doesn't fit the budget, drop the OLDEST history turns one at a time
// (oldest-first, since a several-turns-back exchange is the least likely to
// still matter to the CURRENT question) until it fits or history is empty.
// The new user message and the system prompt are never touched — dropping
// either would defeat the whole point of the request. This turns "silently
// send an oversized prompt and let Ollama choke" into the same graceful,
// honest degradation this app already does for chunks, extended to cover the
// one thing that can genuinely grow per-turn: history itself.
// ----------------------------------------------------------------------------

export interface BuildChatMessagesOptions {
  history: ChatTurn[];
  chips: ContextChip[];
  data: AppData;
  userMessage: string;
  /** The `num_ctx` this request will actually be sent with (see aiService.ts DEFAULT_NUM_CTX) — used to decide whether/how much to trim. Defaults to DEFAULT_NUM_CTX. */
  numCtx?: number;
  /**
   * Rolling summary of older turns (see lib/ai/conversationSummary.ts). Injected into the system
   * message; when set, `history` should already be the recent verbatim window only.
   */
  conversationSummary?: string;
  /**
   * When true, skip the usual `MAX_HISTORY_TURNS` slice — caller already windowed history (e.g.
   * after summarization) and we must not drop further recent turns by re-slicing.
   */
  historyAlreadyWindowed?: boolean;
  /**
   * Optional precomputed grounding decision (AiChatPanel runs the gate BEFORE summarization so an
   * off-topic turn never hits Ollama at all — including the summarize side-job). When omitted,
   * `buildChatMessages` evaluates the gate itself.
   */
  grounding?: ChatGroundingDecision;
}

/** One real source document whose text was retrieved and injected for a given chat turn — the "Context used" disclosure's citation list. */
export interface RetrievedSourceCitation {
  sourceDocId: string;
  title: string;
  url: string;
  /** How relevant the RAG-lite scorer judged this chunk to the question (see knowledgeRetrieval.ts) — shown for transparency, not a probability. */
  score: number;
  /** The exact retrieved excerpt text, so "Context used" can show precisely what was injected — same faithfulness rule as the chip serializers. */
  excerpt: string;
}

export interface BuildChatMessagesResult {
  /** Structured messages array sent to generateLocalAiChatResponseStream (Ollama `/api/chat`). Empty array when `contextTooLarge` or `ungroundedRefuse` is true — never send this to Ollama in that case. */
  messages: ChatMessage[];
  /** Just the serialized chip context, for the "Context used" UI — '' if no chips. */
  contextBlock: string;
  /** Real ACC source documents whose text was retrieved (via the RAG-lite keyword/TF-IDF scorer — see knowledgeRetrieval.ts) and injected into the system message for this turn — [] if nothing scored above the relevance threshold. Reflects chunks actually kept after any budget-driven trimming below. */
  retrievedSources: RetrievedSourceCitation[];
  /**
   * True when the assembled prompt was still too large to fit `numCtx` with room for a reply,
   * EVEN AFTER dropping the lowest-relevance retrieved chunks (see the trimming loop below) — the
   * 2026-08-04 context-overflow safety net. The caller (AiChatPanel) must show
   * `contextTooLargeMessage` instead of sending `messages` to Ollama at all.
   */
  contextTooLarge?: boolean;
  /** Present alongside `contextTooLarge: true` — the honest, specific user-facing message (see contextBudget.ts `contextTooLargeMessage`). */
  contextTooLargeMessage?: string;
  /**
   * True when the hard pre-flight grounding gate fired (no RAG chunks AND static KB not relevant
   * AND no chips AND not a casual greeting) — the caller MUST persist `ungroundedRefuseMessage`
   * as a normal assistant bubble and MUST NOT call Ollama. See groundingGate.ts.
   */
  ungroundedRefuse?: boolean;
  /** Present alongside `ungroundedRefuse: true` — the deterministic app-generated refuse text. */
  ungroundedRefuseMessage?: string;
  /**
   * True when one or more OLDER history turns had to be dropped (oldest-first, after every
   * retrieved knowledge chunk was already dropped) to fit this turn's prompt inside the model's
   * context budget — see the multi-turn timeout fix above `trimToBudget`. The caller (AiChatPanel)
   * can surface this so the user understands why an earlier reply is no longer "remembered" this
   * turn, rather than it looking like the model silently forgot something.
   */
  historyTrimmed?: boolean;
  /** True when a rolling conversation summary was injected into the system message for this turn. */
  historySummarized?: boolean;
}

function buildRetrievedKnowledgeBlock(chunks: RetrievedChunk[]): { text: string; citations: RetrievedSourceCitation[] } {
  const citations: RetrievedSourceCitation[] = chunks.map((r) => {
    const doc = sourceDocById(r.chunk.sourceDocId);
    return {
      sourceDocId: r.chunk.sourceDocId,
      title: doc?.title ?? r.chunk.sourceDocId,
      url: doc?.url ?? '',
      score: r.score,
      excerpt: r.chunk.text,
    };
  });
  const text = citations
    .map((c) => `Source: "${c.title}" (${c.url})\n${c.excerpt}`)
    .join('\n---\n');
  return { text, citations };
}

/**
 * Assembles the structured `messages` array sent to the local model: one
 * leading `system` message (grounding system prompt + the current
 * context-chip block, if any, + any relevant real ACC document excerpts
 * retrieved for this question — see knowledgeCorpus.ts/knowledgeRetrieval.ts),
 * then a capped window of recent conversation history as real `user`/
 * `assistant` messages, then the new user message.
 *
 * Async ONLY because of the knowledge-corpus retrieval step (a `fetch` of the
 * static, locally-served corpus asset — see knowledgeCorpus.ts; still zero
 * external network calls). The retrieval step degrades to "no sources"
 * (never throws) if the corpus asset is unavailable — this function's
 * chip/history/system-prompt assembly is otherwise exactly as before.
 */
function assembleMessages(
  recentHistory: ChatTurn[],
  userMessage: string,
  knowledgeBlock: string,
  contextBlock: string,
  staticSections: string[],
  conversationSummary?: string,
  /**
   * When true, skip the hard "NO ACC document excerpts" refuse instruction — used for casual
   * greetings and chip-only turns where empty retrieval is expected and the model should still
   * answer briefly from chip data / small talk, not refuse.
   */
  skipEmptyRetrievalRefuse?: boolean,
): ChatMessage[] {
  let systemContent = buildAssistantSystemPrompt(staticSections);
  if (knowledgeBlock) {
    systemContent +=
      '\n\nReal ACC document excerpts retrieved and provided to you for THIS exact question — this ' +
      'material is available to you right now, you already have it, use it directly to answer and cite ' +
      'the real source title; do not say you lack access to documents. Prefer short bullets. If, after ' +
      'reading them, these excerpts do not actually address what was asked, say so plainly instead of ' +
      'inventing an answer — and do not cite any of them as a "source" for content they do not actually ' +
      'support:\n' +
      knowledgeBlock;
  } else if (!skipEmptyRetrievalRefuse && staticSections.length === 0) {
    // Defense-in-depth only: the hard app-side gate should have refused before calling the model
    // when there is truly no grounding. Kept for chip/casual edge cases that still reach here
    // without static sections, and as a belt-and-braces prompt reminder if a future caller bypasses
    // the gate. Static-relevant turns with no RAG chunks do NOT get this — the injected rules ARE
    // the grounding.
    systemContent += `\n\n${NO_RETRIEVED_EXCERPTS_INSTRUCTION}`;
  }
  if (contextBlock) {
    systemContent += `\n\nContext used (attached by the user for this question):\n${contextBlock}`;
  }
  if (conversationSummary?.trim()) {
    systemContent +=
      '\n\nRolling prior-chat summary (older turns from THIS chat were compressed for context ' +
      'size — the only prior-chat context; treat as compressed facts from earlier turns in this ' +
      'same thread, not as verbatim quotes, and not as something the user "just provided" outside ' +
      'the transcript; the most recent turns follow as real messages):\n' +
      conversationSummary.trim();
  } else if (recentHistory.length === 0) {
    systemContent +=
      '\n\nThis is a fresh chat turn with no rolling prior-chat summary and no prior user/' +
      'assistant messages in the array yet (aside from the new user message that follows). Do not ' +
      'invent prior conversation context.';
  }

  const messages: ChatMessage[] = [{ role: 'system', content: systemContent }];
  for (const turn of recentHistory) {
    messages.push({ role: turn.role, content: turn.content });
  }
  messages.push({ role: 'user', content: userMessage });
  return messages;
}

/**
 * Context-budget trimming + final safety net (2026-08-04 fix for the real
 * "Contract chip + ToC chunk + T&Cs chunk" timeout incident — see
 * aiService.ts DEFAULT_NUM_CTX and contextBudget.ts for the full writeup).
 *
 * Priority order, matching the incident's own real trade-offs: conversation
 * history and the user's own question are NEVER trimmed (they're small and
 * are the actual point of the request); the Contract-chip rate table is
 * already kept roughly bounded regardless of budget by
 * `serializeContractContext`'s compact view; so the one thing left to trim
 * reactively, in response to an actually-oversized prompt, is the
 * lowest-relevance retrieved knowledge chunks — dropped one at a time,
 * lowest score first, only once the estimated prompt would use more than
 * `CONTEXT_TRIM_TRIGGER_RATIO` of `numCtx`. If even dropping every retrieved
 * chunk still leaves the prompt too large to fit `numCtx` with room for a
 * reply (e.g. several large chips attached at once), this refuses to send
 * at all rather than risk the same crash/hang the owner hit.
 */
function trimToBudget(
  recentHistory: ChatTurn[],
  userMessage: string,
  retrievedChunks: RetrievedChunk[],
  contextBlock: string,
  numCtx: number,
  staticSections: string[],
  conversationSummary?: string,
  skipEmptyRetrievalRefuse?: boolean,
): { messages: ChatMessage[]; keptChunks: RetrievedChunk[]; historyTrimmed: boolean; tooLarge: boolean } {
  // Already sorted best-first by retrieveTopChunks — pop from the end to drop the LOWEST-scoring
  // chunk first, keeping the most relevant ones as long as possible.
  const remainingChunks = [...retrievedChunks];
  // Oldest-first drop order once chunks are exhausted (see multi-turn fix comment above) — slice
  // from the FRONT so the most recent exchanges are the last thing lost.
  let remainingHistory = recentHistory;

  function build(): ChatMessage[] {
    const { text: knowledgeBlock } = buildRetrievedKnowledgeBlock(remainingChunks);
    return assembleMessages(
      remainingHistory,
      userMessage,
      knowledgeBlock,
      contextBlock,
      staticSections,
      conversationSummary,
      skipEmptyRetrievalRefuse,
    );
  }

  // Reserve a fraction of `numCtx` for the model's own reply rather than a fixed token count —
  // this way the "safe" ceiling scales with whatever `numCtx` is actually in effect, and lines up
  // exactly with `CONTEXT_TRIM_TRIGGER_RATIO` (the trim loop and the final safety-net check both
  // target the SAME real ceiling, rather than two different thresholds that could disagree). At
  // the real default (numCtx 8192), this reserves 2048 tokens — matching
  // `DEFAULT_CHAT_NUM_PREDICT` exactly, not a coincidence: both represent "how much of the window
  // a real reply could realistically use".
  const reservedForResponseTokens = numCtx * (1 - CONTEXT_TRIM_TRIGGER_RATIO);

  let messages = build();
  let budget = checkContextBudget(messages, { numCtx, reservedForResponseTokens });

  // Priority 1: drop the lowest-relevance retrieved knowledge chunk(s) — unchanged from the
  // single-turn fix, still the cheapest/least-relevant-by-construction thing to lose.
  while (remainingChunks.length > 0 && !budget.ok) {
    remainingChunks.pop();
    messages = build();
    budget = checkContextBudget(messages, { numCtx, reservedForResponseTokens });
  }

  // Priority 2 (multi-turn fix): every chunk is already gone and the prompt STILL doesn't fit —
  // the only thing left that can grow per-turn is history itself. Drop the oldest turn first.
  // The new user message (`userMessage`, appended separately in `assembleMessages`) is never
  // touched here.
  while (remainingHistory.length > 0 && !budget.ok) {
    remainingHistory = remainingHistory.slice(1);
    messages = build();
    budget = checkContextBudget(messages, { numCtx, reservedForResponseTokens });
  }

  return {
    messages: budget.ok ? messages : [],
    keptChunks: remainingChunks,
    historyTrimmed: remainingHistory.length < recentHistory.length,
    tooLarge: !budget.ok,
  };
}

export async function buildChatMessages(opts: BuildChatMessagesOptions): Promise<BuildChatMessagesResult> {
  const contextBlock = buildContextBlock(opts.chips, opts.data);
  const recentHistory = opts.historyAlreadyWindowed
    ? [...opts.history]
    : opts.history.slice(-MAX_HISTORY_TURNS);
  const numCtx = opts.numCtx ?? DEFAULT_NUM_CTX;
  const conversationSummary = opts.conversationSummary?.trim() || undefined;

  // Hard pre-flight grounding gate (2026-08-04): prompt-only refuse instructions failed twice
  // against phi4-mini-reasoning. If neither RAG nor static KB is relevant (and no chips/casual),
  // refuse in app code — never call the model, never inject Schedule 5.x as bait.
  const grounding: ChatGroundingDecision =
    opts.grounding ??
    (await evaluateChatGrounding({
      userMessage: opts.userMessage,
      hasChips: opts.chips.length > 0,
    }));

  if (!grounding.allowModel) {
    return {
      messages: [],
      contextBlock,
      retrievedSources: [],
      ungroundedRefuse: true,
      ungroundedRefuseMessage: grounding.refuseMessage,
    };
  }

  const skipEmptyRetrievalRefuse =
    grounding.reason === 'casual' ||
    grounding.reason === 'chip-context' ||
    grounding.reason === 'lexicon-relevant';

  const { messages, keptChunks, historyTrimmed, tooLarge } = trimToBudget(
    recentHistory,
    opts.userMessage,
    grounding.retrievedChunks,
    contextBlock,
    numCtx,
    grounding.staticSections,
    conversationSummary,
    skipEmptyRetrievalRefuse,
  );

  if (tooLarge) {
    const itemCount = opts.chips.length + grounding.retrievedChunks.length;
    return {
      messages: [],
      contextBlock,
      retrievedSources: [],
      contextTooLarge: true,
      contextTooLargeMessage: contextTooLargeMessage(itemCount),
    };
  }

  const { citations: retrievedSources } = buildRetrievedKnowledgeBlock(keptChunks);
  return {
    messages,
    contextBlock,
    retrievedSources,
    historyTrimmed: historyTrimmed || undefined,
    historySummarized: conversationSummary ? true : undefined,
  };
}

// ----------------------------------------------------------------------------
// "This conversation is getting long" nudge (2026-08-04, part of the
// multi-turn timeout fix above) — a lightweight UX nicety, not a functional
// fix on its own: once a conversation has racked up enough turns that history
// trimming (or an outright refusal) becomes realistically likely on the NEXT
// message, tell the user proactively rather than letting them discover it via
// a timeout or a "some earlier context was dropped" note after the fact.
// Threshold is deliberately generous (higher than `MAX_HISTORY_TURNS`, which
// already only ever sends the last 8 messages) — this is about the OWNER's
// own sense of "this thread has gone on a while", not a hard technical limit.
// ----------------------------------------------------------------------------
export const LONG_CONVERSATION_MESSAGE_THRESHOLD = 10;

/** True once a conversation has enough turns that starting fresh would likely help (see above). */
export function isConversationGettingLong(messageCount: number): boolean {
  return messageCount >= LONG_CONVERSATION_MESSAGE_THRESHOLD;
}
