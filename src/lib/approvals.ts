import type { Approval, ClaimDocument, Patient } from '../types';
import { daysUntil } from './format';

/** Approvals that count for billing, expiry badges, and coverage (not archived history). */
export function isBillingApproval(approval: Approval): boolean {
  return approval.recordStatus !== 'historical';
}

export function isApprovalCurrent(approval: Approval): boolean {
  return daysUntil(approval.approvalEndDate) >= 0;
}

// ============================================================================
// Duplicate-approval detection, keyed by Purchase Order number.
//
// Byte-identical dedup in staging.ts (`removeByteIdenticalDuplicates`) only
// catches the SAME letter file imported twice. It does not catch a patient
// who has a second, functionally-redundant Approval record filed from a
// DIFFERENT letter/email (e.g. an ACC resend, or the same decision emailed
// again a year later) — those letters have different bytes, so the hash
// dedup never sees them as duplicates. But a genuinely NEW approval period
// for the same patient always gets a NEW PO number from ACC, so grouping on
// (patient, service code, PO number) safely tells the two cases apart:
// same PO -> the same underlying ACC decision filed twice; different PO ->
// a distinct, legitimate renewal that must never be touched.
// ============================================================================

export interface DuplicateApprovalGroup {
  /** Grouping key: normalized patient identity + service code + PO number. */
  key: string;
  patientId: string;
  serviceCode: Approval['serviceCode'];
  poNumber: string;
  /** All approvals in the group, newest first (see approvalRecency below). */
  approvals: Approval[];
  /** The newest record — kept. */
  keep: Approval;
  /** Everything else in the group — redundant, safe to remove. */
  redundant: Approval[];
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePo(po: string): string {
  return po.trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Sort key for "which duplicate is newer". Prefers the `addedDate` of the
 * letter document that filed this approval (real-world filing time) over the
 * approval's own dates, because two duplicates of the SAME PO/decision
 * typically carry identical (or near-identical) approval start/end dates —
 * the filing timestamp is what actually distinguishes "filed this year" from
 * "filed last year" in the reported bug. Falls back to `approvalEndDate` for
 * approvals with no attached letter (e.g. manually entered), then to
 * `approvalStartDate` if even that is missing/unparseable.
 */
function approvalRecency(approval: Approval, documents: ClaimDocument[]): number {
  const doc = approval.sourceDocumentId
    ? documents.find((d) => d.id === approval.sourceDocumentId)
    : undefined;
  const addedMs = doc ? Date.parse(doc.addedDate) : NaN;
  if (!Number.isNaN(addedMs)) return addedMs;
  const endMs = Date.parse(approval.approvalEndDate);
  if (!Number.isNaN(endMs)) return endMs;
  const startMs = Date.parse(approval.approvalStartDate);
  return Number.isNaN(startMs) ? 0 : startMs;
}

/**
 * Group Approval records by (patient identity, service code, PO number) and
 * report groups with more than one record as duplicates — everything but the
 * newest (see {@link approvalRecency}) is `redundant`. Approvals with a blank
 * PO number are never grouped (nothing reliable to match on). Patient
 * identity matches on `patientId` first, falling back to the normalized
 * patient name so two accidentally-duplicated Patient records for the same
 * person are still caught.
 *
 * Pure and read-only — callers decide whether/how to remove `redundant`
 * records (see ReviewQueue.tsx's `removeByteIdenticalDuplicates` pattern:
 * surface for review, only remove on explicit user confirmation).
 */
export function findDuplicateApprovalsByPO(
  approvals: Approval[],
  documents: ClaimDocument[] = [],
  patients: Patient[] = [],
): DuplicateApprovalGroup[] {
  const nameById = new Map(patients.map((p) => [p.id, normalizeName(p.name)]));
  const groups = new Map<string, Approval[]>();
  for (const a of approvals) {
    const po = normalizePo(a.poNumber || '');
    if (!po) continue;
    const identity = nameById.get(a.patientId) || a.patientId;
    const key = `${identity}::${a.serviceCode}::${po}`;
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }

  const result: DuplicateApprovalGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => approvalRecency(b, documents) - approvalRecency(a, documents),
    );
    const [keep, ...redundant] = sorted;
    result.push({
      key,
      patientId: keep.patientId,
      serviceCode: keep.serviceCode,
      poNumber: keep.poNumber,
      approvals: sorted,
      keep,
      redundant,
    });
  }
  return result;
}
