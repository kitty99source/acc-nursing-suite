// ============================================================================
// AI-assisted patient duplicate detection (the first on-device AI feature —
// see docs/research/on-device-reasoning-and-call-capture-2026-08.md Section 8
// for why this was picked first, and docs/ai-features-setup.md for setup).
//
// Deterministic `findDuplicatePatientGroups` (patients.ts) only catches an
// EXACT NHI match or an EXACT normalized-name + DOB match — a single typo, a
// nickname, or a transposed DOB digit is guaranteed to be missed. This module
// adds a second, AI-assisted pass that:
//   1. Cheaply pre-filters the full patient list down to a handful of
//      plausible near-duplicate PAIRS using local fuzzy heuristics (no AI
//      call needed for this step — keeps the prompt small and fast).
//   2. Asks the local reasoning model to judge those candidate pairs and give
//      a one-line reason + confidence for any it thinks are the same person.
//   3. Never merges anything itself — returns suggestions for a human to
//      review and accept via the SAME `mergePatients` flow already used by
//      the exact-match "Check for duplicate patients" button (staging/
//      Review-Queue "human reviews, then accepts" pattern used everywhere
//      else in this codebase).
//
// Fails gracefully at every step: no local AI service running, a timeout, or
// an unparseable model answer all resolve to a plain "unavailable"/"no
// suggestions" result — never an exception, never a blocked UI.
// ============================================================================

import type { Patient } from '../types';
import { normalizePatientName } from './patients';
import { normalizeNhi } from './validation';
import {
  DEFAULT_AI_MODEL,
  extractJsonFromModelText,
  generateLocalAiResponse,
  type FetchLike,
} from './aiService';

export interface PatientDuplicateCandidatePair {
  a: Patient;
  b: Patient;
  /** Why the cheap pre-filter flagged this pair, shown if the AI call is skipped/fails. */
  heuristic: string;
}

/** Classic edit distance — small inputs only (patient names), so no need for a library. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function isDigitTranspose(x: string, y: string): boolean {
  if (!x || !y || x === y || x.length !== y.length) return false;
  return x.split('').sort().join('') === y.split('').sort().join('');
}

/**
 * Same year, and exactly one of month/day differs by a plausible transposed
 * digit (e.g. 1949-07-21 vs 1949-07-12 — day "21" vs "12") — an OCR/typo
 * error, not a different person.
 */
function isDobDigitTranspose(dobA: string, dobB: string): boolean {
  if (!dobA || !dobB || dobA === dobB) return false;
  const partsA = dobA.split('-');
  const partsB = dobB.split('-');
  if (partsA.length !== 3 || partsB.length !== 3) return false;
  const [yA, mA, dA] = partsA;
  const [yB, mB, dB] = partsB;
  if (!yA || yA !== yB) return false;
  const sameMonth = mA === mB;
  const sameDay = dA === dB;
  if (sameMonth === sameDay) return false; // need exactly one component to differ
  return sameMonth ? isDigitTranspose(dA, dB) : isDigitTranspose(mA, mB);
}

function firstToken(name: string): string {
  return name.split(/\s+/)[0] ?? '';
}

const MAX_CANDIDATE_PAIRS = 20;

/**
 * Cheap local fuzzy pre-filter: which pairs are worth spending an AI call on?
 * Deliberately excludes pairs `findDuplicatePatientGroups` already catches
 * exactly (same NHI, or same normalized name + DOB) — this pass only exists
 * to surface what the exact-match rule misses.
 */
export function buildFuzzyDuplicateCandidates(
  patients: Patient[],
  opts?: { maxPairs?: number },
): PatientDuplicateCandidatePair[] {
  const maxPairs = opts?.maxPairs ?? MAX_CANDIDATE_PAIRS;
  const candidates: PatientDuplicateCandidatePair[] = [];

  for (let i = 0; i < patients.length; i++) {
    for (let j = i + 1; j < patients.length; j++) {
      const a = patients[i];
      const b = patients[j];

      const nhiA = normalizeNhi(a.nhi);
      const nhiB = normalizeNhi(b.nhi);
      // Distinct real NHIs on both sides means distinct people — never a candidate.
      if (nhiA && nhiB && nhiA !== nhiB) continue;
      // Same NHI is already an exact match today — not this pass's job.
      if (nhiA && nhiB && nhiA === nhiB) continue;

      const nameA = normalizePatientName(a.name);
      const nameB = normalizePatientName(b.name);
      if (!nameA || !nameB) continue;
      const dobA = a.dob?.trim() ?? '';
      const dobB = b.dob?.trim() ?? '';
      const sameDob = !!dobA && dobA === dobB;
      const exactNameMatch = nameA === nameB;

      // Exact name + DOB is already caught by the deterministic rule.
      if (exactNameMatch && sameDob) continue;

      const dist = levenshtein(nameA, nameB);
      const nearTypo = dist > 0 && dist <= 2 && Math.max(nameA.length, nameB.length) >= 6;
      const sameFirstToken = firstToken(nameA) === firstToken(nameB) && firstToken(nameA).length >= 3;
      const dobTranspose = isDobDigitTranspose(dobA, dobB);

      let heuristic: string | null = null;
      if (nearTypo && sameDob) {
        heuristic = 'Same date of birth; name differs by a character or two (possible typo/OCR error).';
      } else if (sameFirstToken && sameDob && !exactNameMatch) {
        heuristic = 'Same date of birth; shares a name token (possible nickname/full-name variant).';
      } else if (dobTranspose && (exactNameMatch || nearTypo)) {
        heuristic = 'Same name; date of birth day/month digits look transposed.';
      } else if (nearTypo && !dobA && !dobB) {
        heuristic = 'Very similar name; neither record has a date of birth on file to confirm or rule out.';
      }

      if (heuristic) {
        candidates.push({ a, b, heuristic });
      }
    }
  }

  return candidates.slice(0, maxPairs);
}

export interface AiDuplicateSuggestion {
  patientAId: string;
  patientBId: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

export type AiDuplicateCheckStatus =
  | 'ok'
  | 'no-candidates'
  | 'unavailable'
  | 'unparseable'
  | 'disabled';

export interface AiDuplicateCheckResult {
  status: AiDuplicateCheckStatus;
  suggestions: AiDuplicateSuggestion[];
  candidatesChecked: number;
  error?: string;
}

function buildPrompt(candidates: PatientDuplicateCandidatePair[]): { prompt: string; refMap: Map<string, Patient> } {
  const refMap = new Map<string, Patient>();
  const lines: string[] = [];
  candidates.forEach((c, idx) => {
    const refA = `P${idx}a`;
    const refB = `P${idx}b`;
    refMap.set(refA, c.a);
    refMap.set(refB, c.b);
    lines.push(
      `Pair ${idx}: ${refA} = {name: "${c.a.name}", dob: "${c.a.dob || 'unknown'}", notes: "${(c.a.notes || '').slice(0, 120)}"} ` +
        `vs ${refB} = {name: "${c.b.name}", dob: "${c.b.dob || 'unknown'}", notes: "${(c.b.notes || '').slice(0, 120)}"}`,
    );
  });

  const prompt =
    'You are checking a list of patient records for possible DUPLICATE entries for the SAME real person, ' +
    'entered slightly differently (typo, nickname, OCR digit error, etc). ' +
    'Below are candidate pairs a simple fuzzy-matching pass already flagged as WORTH CHECKING. ' +
    'For each pair, decide if it is LIKELY the same person, and if so give a one-sentence reason and a confidence. ' +
    'Do not flag a pair unless there is a real signal (a similar name with a clearly different date of birth is NOT enough). ' +
    'Reply with ONLY a JSON array (no prose, no markdown fence), one object per pair you believe is a likely duplicate: ' +
    '[{"pair": "P0", "reason": "one sentence", "confidence": "high"|"medium"|"low"}]. ' +
    'Omit pairs you do not believe are duplicates. If none are duplicates, reply with an empty array [].\n\n' +
    lines.join('\n');

  return { prompt, refMap };
}

function parseModelSuggestions(
  text: string,
  candidates: PatientDuplicateCandidatePair[],
): AiDuplicateSuggestion[] {
  const parsed = extractJsonFromModelText(text);
  if (!Array.isArray(parsed)) return [];

  const suggestions: AiDuplicateSuggestion[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const pairRef = typeof row.pair === 'string' ? row.pair.trim() : '';
    const match = pairRef.match(/^P(\d+)$/i);
    if (!match) continue;
    const idx = Number(match[1]);
    const candidate = candidates[idx];
    if (!candidate) continue;

    const reason = typeof row.reason === 'string' && row.reason.trim() ? row.reason.trim() : 'Local AI flagged this pair as a likely duplicate.';
    const confidenceRaw = typeof row.confidence === 'string' ? row.confidence.toLowerCase() : '';
    const confidence: AiDuplicateSuggestion['confidence'] =
      confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low' ? confidenceRaw : 'medium';

    suggestions.push({
      patientAId: candidate.a.id,
      patientBId: candidate.b.id,
      reason,
      confidence,
    });
  }
  return suggestions;
}

/**
 * Full pipeline: build candidates → ask the local model → parse into
 * dismissible suggestions. `enabled=false` (the Settings toggle) short-
 * circuits before any network call is attempted.
 */
export async function runAiDuplicatePatientCheck(
  patients: Patient[],
  opts: {
    enabled: boolean;
    baseUrl: string;
    fetchImpl?: FetchLike;
    model?: string;
    timeoutMs?: number;
    maxPairs?: number;
    numThread?: number | null;
    keepAlive?: string | number;
  },
): Promise<AiDuplicateCheckResult> {
  if (!opts.enabled) {
    return { status: 'disabled', suggestions: [], candidatesChecked: 0 };
  }

  const candidates = buildFuzzyDuplicateCandidates(patients, { maxPairs: opts.maxPairs });
  if (candidates.length === 0) {
    return { status: 'no-candidates', suggestions: [], candidatesChecked: 0 };
  }

  const { prompt, refMap } = buildPrompt(candidates);
  void refMap; // kept for potential future cross-checking; parsing goes via candidate index today.

  const result = await generateLocalAiResponse(opts.baseUrl, prompt, {
    fetchImpl: opts.fetchImpl,
    model: opts.model ?? DEFAULT_AI_MODEL,
    timeoutMs: opts.timeoutMs,
    numThread: opts.numThread,
    keepAlive: opts.keepAlive,
  });

  if (!result.ok) {
    return { status: 'unavailable', suggestions: [], candidatesChecked: candidates.length, error: result.error };
  }

  const suggestions = parseModelSuggestions(result.text, candidates);
  if (suggestions.length === 0 && extractJsonFromModelText(result.text) === null) {
    return {
      status: 'unparseable',
      suggestions: [],
      candidatesChecked: candidates.length,
      error: 'Could not parse a JSON answer from the local AI model.',
    };
  }

  return { status: 'ok', suggestions, candidatesChecked: candidates.length };
}
