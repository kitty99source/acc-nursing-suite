import type { AppData } from '../types';

/** Referential integrity checks — warnings only; load proceeds. */
export function validateReferentialIntegrity(data: AppData): string[] {
  const warnings: string[] = [];
  const patientIds = new Set(data.patients.map((p) => p.id));
  const claimIds = new Set(data.claims.map((c) => c.id));

  for (const c of data.claims) {
    if (!patientIds.has(c.patientId)) {
      warnings.push(`Claim ${c.claimNumber || c.id} references missing patient ${c.patientId}`);
    }
  }

  for (const s of data.serviceLines) {
    if (!claimIds.has(s.claimId)) {
      warnings.push(`Service line ${s.id} references missing claim ${s.claimId}`);
    }
  }

  for (const a of data.approvals) {
    if (a.patientId && !patientIds.has(a.patientId)) {
      warnings.push(`Approval ${a.id} references missing patient ${a.patientId}`);
    }
    if (a.claimId && !claimIds.has(a.claimId)) {
      warnings.push(`Approval ${a.id} references missing claim ${a.claimId}`);
    }
  }

  for (const d of data.documents) {
    if (!claimIds.has(d.claimId)) {
      warnings.push(`Document "${d.fileName}" references missing claim ${d.claimId}`);
    }
  }

  for (const d of data.declines) {
    if (d.patientId && !patientIds.has(d.patientId)) {
      warnings.push(`Decline for ${d.patientName || d.id} references missing patient ${d.patientId}`);
    }
    if (d.claimId && !claimIds.has(d.claimId)) {
      warnings.push(`Decline for ${d.claimNumber || d.id} references missing claim ${d.claimId}`);
    }
  }

  for (const m of data.memos ?? []) {
    if (!patientIds.has(m.patientId)) {
      warnings.push(`Memo ${m.id} references missing patient ${m.patientId}`);
    }
    if (m.claimId && !claimIds.has(m.claimId)) {
      warnings.push(`Memo ${m.id} references missing claim ${m.claimId}`);
    }
  }

  return warnings;
}

export interface BlobIntegrityReport {
  metadataCount: number;
  blobCount: number;
  orphanBlobIds: string[];
  missingBlobIds: string[];
}

/** Compare document metadata vs IndexedDB blob keys. */
export function compareDocumentBlobs(
  data: AppData,
  blobIds: string[],
): BlobIntegrityReport {
  const metaIds = new Set(data.documents.map((d) => d.id));
  const blobSet = new Set(blobIds);
  const orphanBlobIds = blobIds.filter((id) => !metaIds.has(id));
  const missingBlobIds = data.documents.map((d) => d.id).filter((id) => !blobSet.has(id));
  return {
    metadataCount: data.documents.length,
    blobCount: blobIds.length,
    orphanBlobIds,
    missingBlobIds,
  };
}
