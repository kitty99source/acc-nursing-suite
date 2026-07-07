import type { AppData } from '../types';
import type { ComplianceFinding } from './compliance';
import { runCompliance, runComplianceForClaims } from './compliance';

let cachedData: AppData | null = null;
let cachedFindings: ComplianceFinding[] | null = null;
let cachedHash = '';
let runCount = 0;

let snapshotFindings: ComplianceFinding[] | null = null;
let snapshotHash = '';

/** Lightweight fingerprint — enough to detect data edits without serializing everything. */
export function dataFingerprint(data: AppData): string {
  return [
    data.patients.length,
    data.claims.length,
    data.serviceLines.length,
    data.approvals.length,
    data.invoiceLines.length,
    data.declines.length,
    data.documents.length,
    data.settings.expiryThresholdDays,
  ].join(':');
}

export function invalidateComplianceCache(): void {
  cachedData = null;
  cachedFindings = null;
  cachedHash = '';
}

export function setComplianceSnapshot(findings: ComplianceFinding[], hash: string): void {
  snapshotFindings = findings;
  snapshotHash = hash;
}

export function getComplianceSnapshot(): { findings: ComplianceFinding[]; hash: string } | null {
  if (!snapshotFindings) return null;
  return { findings: snapshotFindings, hash: snapshotHash };
}

export function clearComplianceSnapshot(): void {
  snapshotFindings = null;
  snapshotHash = '';
}

/**
 * Shared compliance getter — at most one full scan per data reference per tick.
 * Supports incremental re-scan when only a few claims changed (P1-012).
 */
export function getComplianceFindings(
  data: AppData,
  opts?: { dirtyClaimIds?: Iterable<string>; forceFull?: boolean },
): ComplianceFinding[] {
  const hash = dataFingerprint(data);
  const dirty = opts?.dirtyClaimIds ? [...opts.dirtyClaimIds] : [];

  if (!opts?.forceFull && cachedData === data && cachedFindings && cachedHash === hash) {
    return cachedFindings;
  }

  if (
    !opts?.forceFull &&
    cachedFindings &&
    cachedHash &&
    dirty.length > 0 &&
    dirty.length <= 10 &&
    cachedData
  ) {
    const dirtySet = new Set(dirty);
    const incremental = runComplianceForClaims(data, dirtySet);
    const kept = cachedFindings.filter((f) => !f.claimId || !dirtySet.has(f.claimId));
    const merged = [...kept, ...incremental];
    runCount += 1;
    cachedData = data;
    cachedFindings = merged;
    cachedHash = hash;
    return merged;
  }

  if (!opts?.forceFull && snapshotFindings && snapshotHash === hash) {
    runCount += 1;
    cachedData = data;
    cachedFindings = snapshotFindings;
    cachedHash = hash;
    return snapshotFindings;
  }

  runCount += 1;
  const findings = runCompliance(data);
  cachedData = data;
  cachedFindings = findings;
  cachedHash = hash;
  return findings;
}

export function filterFindingsForPatient(
  findings: ComplianceFinding[],
  patientId: string,
): ComplianceFinding[] {
  return findings.filter((f) => f.patientId === patientId);
}

export function filterFindingsForClaim(
  findings: ComplianceFinding[],
  claimId: string,
): ComplianceFinding[] {
  return findings.filter((f) => f.claimId === claimId);
}

/** Test helpers */
export function resetComplianceCacheForTests(): void {
  invalidateComplianceCache();
  clearComplianceSnapshot();
  runCount = 0;
}

export function complianceRunCount(): number {
  return runCount;
}
