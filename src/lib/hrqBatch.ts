// ============================================================================
// HRQ batch approve — high-confidence staging items with mandatory name confirm
// (P8-004). Never auto-commits; parsedPreview must be present from automation.
// ============================================================================

import type { ParsedLetter, ParsedServiceRow } from './letterImport';
import { assignRecordStatus } from './letterImport';
import type { StagingItem } from './staging';

/** Minimum parser confidence for batch approve (still requires name-list confirm). */
export const HRQ_BATCH_MIN_CONFIDENCE = 90;

/**
 * Bump when the letter parser changes in a way that should re-run on already-cached
 * letters (claim/NS extraction, etc.). Cached previews stamped with an older version
 * are treated as stale so the Review Queue re-parses them from bytes when opened.
 */
export const LETTER_PARSER_VERSION = 3;

export interface StagingParsedPreview {
  kind: 'approval' | 'decline';
  /** Parser version this preview was produced by (see LETTER_PARSER_VERSION). */
  parserVersion?: number;
  confidence: number;
  patientName: string;
  claimNumber?: string;
  parsed: ParsedLetter;
  fileBlobBase64: string;
  fileName: string;
  mimeType: string;
  patientId?: string;
  claimId?: string;
  patientPatch?: { name?: string; nhi?: string; dob?: string };
  claimPatch?: {
    claimNumber?: string;
    acc45Number?: string;
    poNumber?: string;
    injuryDescription?: string;
    day1Date?: string;
  };
  rows?: ParsedServiceRow[];
  reason?: string;
  servicePeriodDeclined?: string;
  /** Blocking/scoring issues from the parse, carried over for the auto-accept gate. */
  blockers?: string[];
  /** True when the patient/claim match was ambiguous (multiple candidates). */
  ambiguous?: boolean;
}

export interface BatchCommitDeps {
  commitParsedApproval: (
    parsed: import('./letterImport').ParsedApprovalLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientPatch?: StagingParsedPreview['patientPatch'];
      claimPatch?: StagingParsedPreview['claimPatch'];
      rows: ParsedServiceRow[];
      autoAccept?: boolean;
    },
  ) => Promise<{ patientId: string; claimId: string }>;
  commitParsedDecline: (
    parsed: import('./letterImport').ParsedDeclineLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientName?: string;
      claimNumber?: string;
      reason?: string;
      servicePeriodDeclined?: string;
    },
  ) => Promise<{ patientId: string; claimId: string }>;
}

export function isStagingParsedPreview(raw: unknown): raw is StagingParsedPreview {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as StagingParsedPreview;
  if (p.kind !== 'approval' && p.kind !== 'decline') return false;
  if (typeof p.confidence !== 'number' || p.confidence < HRQ_BATCH_MIN_CONFIDENCE) return false;
  if (!p.patientName?.trim()) return false;
  if (!p.parsed || typeof p.parsed !== 'object') return false;
  if (!p.fileBlobBase64 || typeof p.fileBlobBase64 !== 'string') return false;
  if (!p.fileName || !p.mimeType) return false;
  return true;
}

/** High-confidence letter-import-pending with a valid parsed preview — safe for batch UI. */
export function isBatchApprovable(item: StagingItem): boolean {
  if (item.status !== 'pending') return false;
  if (item.type !== 'letter-import-pending') return false;
  if (item.severity !== 'info') return false;
  return isStagingParsedPreview(item.parsedPreview);
}

export function stagingPatientName(item: StagingItem): string {
  const preview = item.parsedPreview;
  if (isStagingParsedPreview(preview)) return preview.patientName.trim();
  return item.title;
}

export function stagingPatientNames(items: StagingItem[]): string[] {
  return items.map(stagingPatientName);
}

export function allSelectedBatchApprovable(selected: StagingItem[]): boolean {
  return selected.length > 0 && selected.every(isBatchApprovable);
}

export function previewToFile(preview: StagingParsedPreview): File {
  const binary = atob(preview.fileBlobBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], preview.fileName, { type: preview.mimeType });
}

export async function commitBatchStagingItem(
  item: StagingItem,
  deps: BatchCommitDeps,
): Promise<{ patientId: string; claimId: string; kind: 'approval' | 'decline' }> {
  if (!isBatchApprovable(item)) {
    throw new Error(`"${item.title}" is not eligible for batch approve.`);
  }
  const preview = item.parsedPreview;
  if (!isStagingParsedPreview(preview)) {
    throw new Error(`"${item.title}" has an invalid parsed preview.`);
  }
  const file = previewToFile(preview);

  if (preview.kind === 'approval') {
    if (preview.parsed.kind !== 'approval') {
      throw new Error(`Preview kind mismatch for "${item.title}".`);
    }
    const rows =
      preview.rows && preview.rows.length > 0
        ? preview.rows
        : assignRecordStatus(preview.parsed.serviceRows);
    const result = await deps.commitParsedApproval(preview.parsed, file, {
      patientId: preview.patientId,
      claimId: preview.claimId,
      patientPatch: preview.patientPatch,
      claimPatch: preview.claimPatch,
      rows,
    });
    return { ...result, kind: 'approval' };
  }

  if (preview.parsed.kind !== 'decline') {
    throw new Error(`Preview kind mismatch for "${item.title}".`);
  }
  const result = await deps.commitParsedDecline(preview.parsed, file, {
    patientId: preview.patientId,
    claimId: preview.claimId,
    patientName: preview.patientName,
    claimNumber: preview.claimNumber ?? preview.parsed.claim.claimNumber,
    reason: preview.reason ?? preview.parsed.reason,
    servicePeriodDeclined: preview.servicePeriodDeclined ?? preview.parsed.serviceRequested,
  });
  return { ...result, kind: 'decline' };
}

export async function commitBatchStagingItems(
  items: StagingItem[],
  deps: BatchCommitDeps,
): Promise<Array<{ stagingId: string; patientId: string; claimId: string; kind: 'approval' | 'decline' }>> {
  const results: Array<{ stagingId: string; patientId: string; claimId: string; kind: 'approval' | 'decline' }> = [];
  for (const item of items) {
    const commit = await commitBatchStagingItem(item, deps);
    results.push({ stagingId: item.id, ...commit });
  }
  return results;
}

// ============================================================================
// Auto-accept ready (100% confidence) letters — approvals only.
//
// This is deliberately much stricter than isBatchApprovable above: it exists
// to file a letter with ZERO human review, so every condition is checked
// explicitly against the parsed preview rather than trusting the confidence
// number alone (defense-in-depth — a future scoring bug should never let an
// ambiguous match or a decline slip through unattended).
// ============================================================================

/** Confidence required for silent auto-accept — anything less always needs a human. */
export const AUTO_ACCEPT_MIN_CONFIDENCE = 100;

/**
 * Pure eligibility check against a parsed preview alone (no StagingItem
 * status lookup) — kept separate so the gate itself is trivially unit
 * testable without constructing full staging items.
 */
export function isAutoAcceptEligiblePreview(preview: StagingParsedPreview | undefined): boolean {
  if (!preview) return false;
  if (preview.kind !== 'approval') return false; // declines always stay manual
  if (preview.parsed.kind !== 'approval') return false;
  if (preview.confidence !== AUTO_ACCEPT_MIN_CONFIDENCE) return false;
  if ((preview.blockers?.length ?? 0) > 0) return false;
  if (preview.ambiguous) return false;
  const rows = preview.rows?.length ? preview.rows : preview.parsed.serviceRows;
  if (!rows || rows.length === 0) return false;
  return true;
}

/**
 * Full eligibility gate for a staging item: pending-only, plus the
 * denormalized `autoAcceptEligible` flag stamped on the item by
 * `stagingPreparse.ts` / `ReviewQueue.tsx` after a parse (foreground or
 * background) clears `isAutoAcceptEligiblePreview`. Deliberately does NOT
 * look at `item.parsedPreview` — under the lean-queue redesign that field is
 * never populated (parsed data lives in the hash-keyed letter parse cache),
 * so gating on it here made this permanently false for every item.
 */
export function isAutoAcceptEligible(item: StagingItem): boolean {
  if (item.status !== 'pending') return false;
  return item.autoAcceptEligible === true;
}

export interface AutoAcceptDeps extends BatchCommitDeps {
  /**
   * Resolve the full parsed preview for an eligible item at commit time.
   * `StagingItem` only carries the lightweight `autoAcceptEligible` flag
   * (see staging.ts) — the actual parsed data (service rows, file bytes,
   * patient/claim patch, etc.) lives in the hash-keyed letter parse cache,
   * not on the item. Return `undefined` if the cached parse/blob can no
   * longer be resolved (cache evicted, launcher bridge down, etc.) — the
   * caller skips this item and continues the batch rather than failing it.
   */
  resolvePreview: (item: StagingItem) => Promise<StagingParsedPreview | undefined>;
}

/** Commit a single auto-accept-eligible staging item, tagging the created Approval(s). */
export async function commitAutoAcceptItem(
  item: StagingItem,
  deps: AutoAcceptDeps,
): Promise<{ patientId: string; claimId: string }> {
  if (!isAutoAcceptEligible(item)) {
    throw new Error(`"${item.title}" is not eligible for auto-accept.`);
  }
  const preview = await deps.resolvePreview(item);
  // Re-check the full gate against the freshly-resolved preview (not just the
  // denormalized flag) — defense-in-depth so a stale/incorrect flag can never
  // let something unattended through, matching the "never auto-commit
  // without checking every condition" stance this whole gate is built on.
  if (
    !preview ||
    preview.kind !== 'approval' ||
    preview.parsed.kind !== 'approval' ||
    !isAutoAcceptEligiblePreview(preview)
  ) {
    throw new Error(
      `"${item.title}" could not be resolved for auto-accept — the letter file or its cached parse is no longer available.`,
    );
  }
  const file = previewToFile(preview);
  const rows =
    preview.rows && preview.rows.length > 0 ? preview.rows : assignRecordStatus(preview.parsed.serviceRows);
  return deps.commitParsedApproval(preview.parsed, file, {
    patientId: preview.patientId,
    claimId: preview.claimId,
    patientPatch: preview.patientPatch,
    claimPatch: preview.claimPatch,
    rows,
    autoAccept: true,
  });
}

export interface AutoAcceptProgress {
  /** 1-based index of the item currently being committed. */
  index: number;
  total: number;
  item: StagingItem;
}

export interface AutoAcceptOutcome {
  stagingId: string;
  title: string;
  ok: boolean;
  patientId?: string;
  claimId?: string;
  error?: string;
}

/**
 * Commit a batch of auto-accept-eligible items in sequence. A failure on one
 * item (e.g. a document-write error) is caught, recorded, and skipped — the
 * rest of the batch still runs. `commitParsedApproval` is the rollback-safe
 * store action, so a failed item never leaves an orphaned patient/claim
 * behind and its staging item is simply never advanced past 'pending'.
 */
export async function runAutoAccept(
  items: StagingItem[],
  deps: AutoAcceptDeps,
  onProgress?: (progress: AutoAcceptProgress) => void,
): Promise<AutoAcceptOutcome[]> {
  const outcomes: AutoAcceptOutcome[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.({ index: i + 1, total: items.length, item });
    try {
      const result = await commitAutoAcceptItem(item, deps);
      outcomes.push({ stagingId: item.id, title: item.title, ok: true, ...result });
    } catch (err) {
      outcomes.push({
        stagingId: item.id,
        title: item.title,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcomes;
}
