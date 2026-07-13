// ============================================================================
// Review Queue category classifier (District Nursing Admin).
//
// Splits a large HRQ into actionable slices — same idea as Loan Equipment's
// vendor × lifecycle filters, but for nursing:
//   • mail kind: ACC approval letter vs approval request vs decline vs other
//   • latest approval service: NS04 vs NS05 vs unknown/other
//
// Derived at display time from subject / filename / title / cached parse hints
// (never invents PHI). Synthetic fixtures only in tests.
// ============================================================================

import type { DocumentKind } from '../types';
import type { StagingItem } from './staging';
import { assignRecordStatus, type ParsedServiceRow } from './letterImport';

/** Latest NS04/NS05 service on the letter (or unknown when not detectable yet). */
export type ReviewServiceCategory = 'NS04' | 'NS05' | 'unknown';

/**
 * What kind of mail this staging row most likely is.
 * Maps onto DocumentKind for Accept / I-drive save outcomes.
 */
export type ReviewMailKind =
  | 'acc-approval-letter'
  | 'approval-request'
  | 'acc-decline-letter'
  | 'other';

export const REVIEW_MAIL_KIND_LABEL: Record<ReviewMailKind, string> = {
  'acc-approval-letter': 'ACC approval letter',
  'approval-request': 'Approval request',
  'acc-decline-letter': 'ACC decline letter',
  other: 'Other / uncategorised',
};

export const REVIEW_SERVICE_LABEL: Record<ReviewServiceCategory, string> = {
  NS04: 'NS04 — Extended Nursing',
  NS05: 'NS05 — Ongoing Nursing',
  unknown: 'Unknown / other service',
};

/** Default filter: ACC approval letters (most actionable for filing periods). */
export const DEFAULT_REVIEW_MAIL_KIND_FILTER: ReviewMailKind | 'all' = 'acc-approval-letter';
export const DEFAULT_REVIEW_SERVICE_FILTER: ReviewServiceCategory | 'all' = 'all';

export interface ReviewCategoryHints {
  /** Loose parse preview when available (cached or on-item). */
  serviceRows?: ParsedServiceRow[];
  /** Parsed letter kind from letterImport / staging preview. */
  letterKind?: 'approval' | 'decline' | 'unknown';
}

function haystack(item: Pick<StagingItem, 'title' | 'summary' | 'sourceFileName' | 'expectedFileName' | 'emailSubject'>): string {
  return [
    item.emailSubject ?? '',
    item.sourceFileName ?? '',
    item.expectedFileName ?? '',
    item.title ?? '',
    item.summary ?? '',
  ]
    .join('\n')
    .toLowerCase();
}

/**
 * Classify mail kind from filename/subject heuristics + optional parse hints.
 * Approval letters (NUR02) win over request tokens when both appear (ACC often
 * puts "approve" in the attachment name of a real letter).
 */
export function classifyReviewMailKind(
  item: Pick<StagingItem, 'title' | 'summary' | 'sourceFileName' | 'expectedFileName' | 'emailSubject'>,
  hints?: ReviewCategoryHints,
): ReviewMailKind {
  if (hints?.letterKind === 'approval') return 'acc-approval-letter';
  if (hints?.letterKind === 'decline') return 'acc-decline-letter';

  const text = haystack(item);

  if (/nur04|decline\s+of\s+nursing|nursing\s+services\s+decline|declin/.test(text)) {
    return 'acc-decline-letter';
  }
  // Real ACC approval letters (NUR02 / "Approval for nursing services").
  if (/nur02|approval\s+for\s+nursing|nursing\s+services\s+approve/.test(text)) {
    return 'acc-approval-letter';
  }
  // Requests we sent / are chasing — NOT yet an ACC approval letter.
  if (
    /approval\s*request|request\s*(for\s*)?approval|seeking\s*approval|prior\s*approval\s*request|ns04\s*request|ns05\s*request/.test(
      text,
    )
  ) {
    return 'approval-request';
  }
  if (/approv/.test(text) && !/request/.test(text)) {
    return 'acc-approval-letter';
  }
  return 'other';
}

/**
 * Latest NS04/NS05 on the letter. Prefers parsed service rows (current row when
 * stamped); otherwise looks for NS04/NS05 tokens in subject/filename.
 * When both codes appear in text without row dates, prefers the last mention.
 */
export function classifyReviewServiceCategory(
  item: Pick<StagingItem, 'title' | 'summary' | 'sourceFileName' | 'expectedFileName' | 'emailSubject'>,
  hints?: ReviewCategoryHints,
): ReviewServiceCategory {
  const rows = hints?.serviceRows ?? [];
  if (rows.length > 0) {
    const stamped = assignRecordStatus(rows);
    const current = stamped.find((r) => r.recordStatus === 'current') ?? stamped[stamped.length - 1];
    if (current?.serviceCode === 'NS04' || current?.serviceCode === 'NS05') {
      return current.serviceCode;
    }
  }

  const text = haystack(item);
  // Underscores/hyphens are common in saved filenames (…_NS04_…); \b treats `_` as a word char.
  const matches = [...text.matchAll(/(?:^|[^a-z0-9])(ns0[45])(?![a-z0-9])/gi)];
  if (matches.length === 0) return 'unknown';
  const last = matches[matches.length - 1]![1]!.toUpperCase();
  return last === 'NS05' ? 'NS05' : 'NS04';
}

export function reviewMailKindToDocumentKind(kind: ReviewMailKind): DocumentKind {
  if (kind === 'acc-approval-letter') return 'acc-approval-letter';
  if (kind === 'acc-decline-letter') return 'acc-decline-letter';
  if (kind === 'approval-request') return 'approval-request';
  return 'other';
}

export function classifyStagingReviewCategories(
  item: StagingItem,
  hints?: ReviewCategoryHints,
): { mailKind: ReviewMailKind; service: ReviewServiceCategory } {
  // Prefer structured preview on the item when present (even below auto-accept confidence).
  const preview = item.parsedPreview as
    | { kind?: string; parsed?: { kind?: string; serviceRows?: ParsedServiceRow[] }; rows?: ParsedServiceRow[] }
    | undefined;
  const merged: ReviewCategoryHints = { ...hints };
  if (!merged.letterKind && preview) {
    const k = preview.kind ?? preview.parsed?.kind;
    if (k === 'approval' || k === 'decline') merged.letterKind = k;
  }
  if (!merged.serviceRows?.length && preview) {
    const rows = preview.rows ?? preview.parsed?.serviceRows;
    if (rows?.length) merged.serviceRows = rows;
  }
  return {
    mailKind: classifyReviewMailKind(item, merged),
    service: classifyReviewServiceCategory(item, merged),
  };
}

/** I-drive live-path top folder for a document kind (under District Nursing root). */
export function adminIDriveTopFolderForKind(kind: DocumentKind): 'Letters' | 'Approval Requests' {
  return kind === 'approval-request' ? 'Approval Requests' : 'Letters';
}
