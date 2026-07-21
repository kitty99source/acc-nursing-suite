// ============================================================================
// Case workflow: pure domain library for the day-to-day nursing-services
// pipeline (memo -> nurse docs -> ACC submission -> approved/declined).
//
// Grounded in Nursing Services Processes:
//   1. Weekly monitoring / NS01-NS06 review outside the app.
//   2. Send ACC179 + memo to district nurse (recorded here).
//   3. Await nursing paperwork; correct if wrong.
//   4. Save request + submit to ACC (out-of-band; recorded here).
//   5. Await ACC letter (approval / decline).
//   6. Monthly invoice + remittance (Billing module).
//
// All exports are pure functions over inputs; no React, no store. Dates are
// ISO YYYY-MM-DD (day-precision) or ISO datetime strings for events. Clock
// injection (`nowISO`) is available on the mutating helper so tests are
// deterministic.
// ============================================================================

import type {
  AppData,
  CaseEvent,
  CaseEventKind,
  CaseStage,
  Claim,
  MemoPurpose,
} from '../types';
import { daysBetween, todayISO, uid } from './format';

/** UI order for the step tracker + timeline. */
export const CASE_STAGE_ORDER: CaseStage[] = [
  'not_started',
  'awaiting_nurse_docs',
  'docs_received',
  'docs_returned',
  'awaiting_acc',
  'approved',
  'declined',
  'closed',
];

const TERMINAL_STAGES = new Set<CaseStage>(['approved', 'declined', 'closed']);

export function isTerminalStage(stage: CaseStage | undefined): boolean {
  return TERMINAL_STAGES.has(stage ?? 'not_started');
}

/** Case is "open" (visible in dashboards / follow-up lists). */
export function isOpenCase(claim: Claim): boolean {
  const stage = claim.caseStage ?? 'not_started';
  return stage !== 'not_started' && !isTerminalStage(stage);
}

// ---------------------------------------------------------------------------
// Date math
// ---------------------------------------------------------------------------

/** Add N calendar days to an ISO date (day precision), UTC-safe. */
export function addCalendarDays(iso: string, n: number): string {
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return iso;
  const next = new Date(ms + n * 24 * 60 * 60 * 1000);
  return next.toISOString().slice(0, 10);
}

/**
 * Add N working days (Mon–Fri) to an ISO date. NZ public-holiday calendar is
 * intentionally OUT OF SCOPE for v1 — a dismissible banner tells the user we
 * count weekdays only. Working-day math advances the anchor day itself if it
 * is a weekend so a Friday+1 lands on the following Monday, not Saturday.
 */
export function addWorkingDays(iso: string, n: number): string {
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return iso;
  const d = new Date(ms);
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0=Sun ... 6=Sat
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** Due date for chasing the nurse (memoSentAt + calendar days). */
export function computeNurseFollowUpDue(memoSentAtISO: string, days: number): string {
  const anchor = memoSentAtISO.slice(0, 10);
  return addCalendarDays(anchor, Math.max(0, days));
}

/** Due date for chasing ACC (submittedToAccAt + working days). */
export function computeAccFollowUpDue(submittedAtISO: string, workingDays: number): string {
  const anchor = submittedAtISO.slice(0, 10);
  return addWorkingDays(anchor, Math.max(0, workingDays));
}

// ---------------------------------------------------------------------------
// Legal stage transitions
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<CaseStage, CaseStage[]> = {
  not_started: ['awaiting_nurse_docs'],
  awaiting_nurse_docs: ['awaiting_nurse_docs', 'docs_received', 'closed'],
  docs_received: ['docs_returned', 'awaiting_acc', 'closed'],
  docs_returned: ['docs_received', 'closed'],
  awaiting_acc: ['awaiting_acc', 'approved', 'declined', 'closed'],
  approved: [],
  declined: [],
  closed: [],
};

/**
 * Return the set of stages the caller may transition into from `from`. Same
 * source and destination is legal for stages that support in-place refresh
 * (chase actions bump the due date without changing stage).
 */
export function nextStages(from: CaseStage): CaseStage[] {
  return TRANSITIONS[from] ?? [];
}

export function assertTransition(from: CaseStage, to: CaseStage): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal case transition: ${from} → ${to}`);
  }
}

// ---------------------------------------------------------------------------
// Case transitions (pure mutator + event append)
// ---------------------------------------------------------------------------

export interface CaseTransitionInput {
  kind: CaseEventKind;
  note?: string;
  documentId?: string;
  memoId?: string;
  by?: string;
  /** Injectable clock; defaults to the current time. */
  nowISO?: string;
  /** Settings-driven follow-up windows (calendar / working days). */
  nurseFollowUpDays?: number;
  accFollowUpWorkingDays?: number;
}

export interface CaseTransitionResult {
  claim: Claim;
  event: CaseEvent;
}

/**
 * Pure: given a claim and a `CaseTransitionInput`, produce the patched claim
 * (new stage + timestamps + due dates) plus the append-only event. The caller
 * is responsible for persisting both.
 */
export function applyCaseTransition(
  claim: Claim,
  input: CaseTransitionInput,
): CaseTransitionResult {
  const now = input.nowISO ?? new Date().toISOString();
  const nurseDays = input.nurseFollowUpDays ?? 7;
  const accWorkingDays = input.accFollowUpWorkingDays ?? 10;
  const from = claim.caseStage ?? 'not_started';
  let to: CaseStage = from;
  const patch: Partial<Claim> = {};

  switch (input.kind) {
    case 'memo_sent': {
      to = 'awaiting_nurse_docs';
      patch.memoSentAt = now;
      patch.nurseFollowUpDue = computeNurseFollowUpDue(now, nurseDays);
      break;
    }
    case 'nurse_chased': {
      to = 'awaiting_nurse_docs';
      patch.nurseFollowUpDue = computeNurseFollowUpDue(now, nurseDays);
      break;
    }
    case 'docs_received': {
      to = 'docs_received';
      patch.docsReceivedAt = now;
      break;
    }
    case 'docs_returned': {
      if (!input.note?.trim()) {
        throw new Error('A reason note is required to return docs for correction.');
      }
      to = 'docs_returned';
      patch.docsReturnedAt = now;
      break;
    }
    case 'corrected_docs_received': {
      to = 'docs_received';
      patch.correctedDocsReceivedAt = now;
      break;
    }
    case 'submitted_to_acc': {
      to = 'awaiting_acc';
      patch.submittedToAccAt = now;
      patch.accFollowUpDue = computeAccFollowUpDue(now, accWorkingDays);
      break;
    }
    case 'acc_chased': {
      to = 'awaiting_acc';
      patch.accFollowUpDue = computeAccFollowUpDue(now, accWorkingDays);
      break;
    }
    case 'acc_approved': {
      to = 'approved';
      patch.accRespondedAt = now;
      break;
    }
    case 'acc_declined': {
      to = 'declined';
      patch.accRespondedAt = now;
      break;
    }
    case 'closed': {
      to = 'closed';
      break;
    }
    case 'note':
    case 'attachment_added': {
      // Non-stage-changing events; still legal from any stage.
      to = from;
      break;
    }
  }

  if (to !== from) assertTransition(from, to);

  const event: CaseEvent = {
    id: uid('evt'),
    at: now,
    kind: input.kind,
    ...(input.note ? { note: input.note } : {}),
    ...(input.documentId ? { documentId: input.documentId } : {}),
    ...(input.memoId ? { memoId: input.memoId } : {}),
    ...(input.by ? { by: input.by } : {}),
  };

  const nextClaim: Claim = {
    ...claim,
    ...patch,
    caseStage: to,
    caseEvents: [...(claim.caseEvents ?? []), event],
  };
  return { claim: nextClaim, event };
}

// ---------------------------------------------------------------------------
// Helpers for lists / queries
// ---------------------------------------------------------------------------

export function findOpenClaimsForPatient(claims: Claim[], patientId: string): Claim[] {
  return claims.filter((c) => c.patientId === patientId && isOpenCase(c));
}

/**
 * Suggest a default memo target (same claim renewal vs new claim) from the
 * chosen purpose. The user can always override — the decision is explicit.
 */
export function defaultMemoTarget(purpose: MemoPurpose | undefined): 'same_claim' | 'new_claim' {
  switch (purpose) {
    case 'new_claim_approval':
    case 'subsequent_ns06':
      return 'new_claim';
    case 'renewal_same_claim':
    case 'extended_ns04':
    case 'ongoing_ns05':
    case 'long_term_ns03':
      return 'same_claim';
    default:
      return 'same_claim';
  }
}

export function claimsNeedingNurseFollowUp(data: AppData, today = todayISO()): Claim[] {
  return data.claims.filter((c) => {
    const stage = c.caseStage ?? 'not_started';
    if (stage !== 'awaiting_nurse_docs' && stage !== 'docs_returned') return false;
    if (!c.nurseFollowUpDue) return false;
    // due today or earlier
    return daysBetween(today, c.nurseFollowUpDue) <= 0;
  });
}

export function claimsNeedingAccFollowUp(data: AppData, today = todayISO()): Claim[] {
  return data.claims.filter((c) => {
    if ((c.caseStage ?? 'not_started') !== 'awaiting_acc') return false;
    if (!c.accFollowUpDue) return false;
    return daysBetween(today, c.accFollowUpDue) <= 0;
  });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

export const CASE_STAGE_LABEL: Record<CaseStage, string> = {
  not_started: 'Not started',
  awaiting_nurse_docs: 'Awaiting nurse docs',
  docs_received: 'Docs received',
  docs_returned: 'Returned for correction',
  awaiting_acc: 'Waiting on ACC',
  approved: 'Approved',
  declined: 'Declined',
  closed: 'Closed',
};

export const MEMO_PURPOSE_LABEL: Record<MemoPurpose, string> = {
  renewal_same_claim: 'Renewal on this claim',
  new_claim_approval: 'New claim approval',
  long_term_ns03: 'Long-term (NS03)',
  extended_ns04: 'Extended (NS04)',
  ongoing_ns05: 'Ongoing (NS05)',
  subsequent_ns06: 'Subsequent (NS06)',
  other: 'Other',
};
