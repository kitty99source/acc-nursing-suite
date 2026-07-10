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
export const LETTER_PARSER_VERSION = 2;

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
