// ============================================================================
// Review Queue bulk import (user request "C").
//
// Lets the nurse file several staged letters in one action WITHOUT losing the
// safety of manual sign-off. An item is only auto-committed when ALL of these
// hold:
//   1. its letter file bytes are available (found in the folder they pick),
//   2. the file parses as a recognised ACC letter,
//   3. parser confidence is high (>= BULK_MIN_CONFIDENCE),
//   4. there are NO blocking fixes outstanding, and
//   5. it confidently matches an EXISTING patient + claim
//      (matchLetterToData only matches on claim number / NHI — never name).
//
// Anything that fails a check is LEFT in the queue, clearly flagged with a
// reason, so nothing is force-saved. New-patient letters (no existing match)
// stay manual on purpose — the nurse should eyeball a brand-new profile.
// ============================================================================

import type { Claim, Patient } from '../types';
import type { LetterIssue, LetterParseResult, ParsedApprovalLetter, ParsedDeclineLetter } from './letterImport';
import { prefillFromParsed } from './letterImport';
import { HRQ_BATCH_MIN_CONFIDENCE } from './hrqBatch';
import type { StagingItem } from './staging';

/** Minimum parser confidence for an item to auto-commit in a bulk run. */
export const BULK_MIN_CONFIDENCE = HRQ_BATCH_MIN_CONFIDENCE;

export type BulkSkipReason =
  | 'file-not-found'
  | 'unreadable'
  | 'unrecognised'
  | 'low-confidence'
  | 'needs-fix'
  | 'no-match';

export interface BulkQualifyResult {
  eligible: boolean;
  reason?: BulkSkipReason;
  detail: string;
}

function blockingIssues(issues: LetterIssue[]): LetterIssue[] {
  return issues.filter((i) => i.blocking !== false);
}

/**
 * Pure decision: can this parsed staged letter be auto-committed unattended?
 * SAFE by construction — every "no" leaves the item in the queue. Pass `null`
 * when the letter file was not found in the chosen folder.
 */
export function qualifyForBulk(result: LetterParseResult | null): BulkQualifyResult {
  if (!result) {
    return {
      eligible: false,
      reason: 'file-not-found',
      detail: 'Letter file not found in the chosen folder — use Review & import to pick it.',
    };
  }
  if (!result.parsed) {
    return {
      eligible: false,
      reason: 'unrecognised',
      detail: 'Not a recognised ACC letter — review individually.',
    };
  }
  const blocking = blockingIssues(result.issues);
  if (blocking.length > 0) {
    return {
      eligible: false,
      reason: 'needs-fix',
      detail: `Needs a manual fix: ${blocking[0].message}`,
    };
  }
  if (result.overallConfidence < BULK_MIN_CONFIDENCE) {
    return {
      eligible: false,
      reason: 'low-confidence',
      detail: `Confidence ${result.overallConfidence}% is below ${BULK_MIN_CONFIDENCE}% — review individually.`,
    };
  }
  const m = result.match;
  if (!m.claimId || !m.patientId || m.ambiguous) {
    return {
      eligible: false,
      reason: 'no-match',
      detail: 'No confident match to an existing patient/claim — review individually.',
    };
  }
  return { eligible: true, detail: 'High confidence and matched to an existing patient/claim.' };
}

export interface BulkCommitDeps {
  /** Return the letter File for a staged item, or undefined if bytes unavailable. */
  resolveFile: (item: StagingItem) => Promise<File | undefined>;
  /** Parse a letter file (store.parseLetterFile — runs match + scoring). */
  parse: (file: File) => Promise<LetterParseResult>;
  commitApproval: (
    parsed: ParsedApprovalLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientPatch?: Partial<Patient>;
      claimPatch?: Partial<Claim>;
      rows: ParsedApprovalLetter['serviceRows'];
      historicRows?: ParsedApprovalLetter['packageRows'];
    },
  ) => Promise<{ patientId: string; claimId: string }>;
  commitDecline: (
    parsed: ParsedDeclineLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientName?: string;
      claimNumber?: string;
      reason?: string;
    },
  ) => Promise<{ patientId: string; claimId: string }>;
}

export interface BulkImportOutcome {
  stagingId: string;
  title: string;
  committed: boolean;
  kind?: 'approval' | 'decline';
  patientId?: string;
  claimId?: string;
  reason?: BulkSkipReason;
  detail: string;
}

/**
 * Run a bulk import over the given staged items. Commits only the qualifying
 * ones; returns an outcome per item (committed or the reason it was skipped).
 * Never throws for a single item — a failed commit is reported and the rest
 * continue, so one bad letter can't abort the batch.
 */
export async function runBulkImport(
  items: StagingItem[],
  deps: BulkCommitDeps,
): Promise<BulkImportOutcome[]> {
  const outcomes: BulkImportOutcome[] = [];
  for (const item of items) {
    const file = await deps.resolveFile(item);
    if (!file) {
      const q = qualifyForBulk(null);
      outcomes.push({ stagingId: item.id, title: item.title, committed: false, reason: q.reason, detail: q.detail });
      continue;
    }

    let result: LetterParseResult;
    try {
      result = await deps.parse(file);
    } catch (err) {
      outcomes.push({
        stagingId: item.id,
        title: item.title,
        committed: false,
        reason: 'unreadable',
        detail: `Could not read the file: ${(err as Error).message}`,
      });
      continue;
    }

    const q = qualifyForBulk(result);
    if (!q.eligible || !result.parsed) {
      outcomes.push({ stagingId: item.id, title: item.title, committed: false, reason: q.reason, detail: q.detail });
      continue;
    }

    try {
      if (result.parsed.kind === 'approval') {
        const pre = prefillFromParsed(result.parsed);
        const res = await deps.commitApproval(result.parsed, file, {
          patientId: result.match.patientId,
          claimId: result.match.claimId,
          patientPatch: result.match.patient
            ? { name: result.match.patient.name, nhi: result.match.patient.nhi, dob: result.match.patient.dob }
            : pre.patient,
          claimPatch: pre.claim,
          rows: result.parsed.serviceRows,
          historicRows: result.parsed.packageRows,
        });
        outcomes.push({ stagingId: item.id, title: item.title, committed: true, kind: 'approval', ...res, detail: q.detail });
      } else {
        const res = await deps.commitDecline(result.parsed, file, {
          patientId: result.match.patientId,
          claimId: result.match.claimId,
          patientName: result.match.patient?.name ?? result.parsed.patient.name,
          claimNumber: result.parsed.claim.claimNumber,
          reason: result.parsed.reason,
        });
        outcomes.push({ stagingId: item.id, title: item.title, committed: true, kind: 'decline', ...res, detail: q.detail });
      }
    } catch (err) {
      outcomes.push({
        stagingId: item.id,
        title: item.title,
        committed: false,
        reason: 'unreadable',
        detail: `Save failed: ${(err as Error).message}`,
      });
    }
  }
  return outcomes;
}

/** Normalise a filename for case-insensitive matching against staged names. */
export function normalizeMatchName(name: string): string {
  return name.trim().toLowerCase();
}

/** Candidate on-disk filenames for a staged item, most-specific first. */
export function candidateFileNames(item: StagingItem): string[] {
  const names = [item.expectedFileName, item.sourceFileName].filter((n): n is string => !!n?.trim());
  return [...new Set(names.map(normalizeMatchName))];
}
