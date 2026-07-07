import type { AppData, Approval, Claim, InvoiceLine, Patient, ServiceLine } from '../types';

/** Pre-built lookup maps for analytics and compliance hot paths (P1-003, P1-011). */
export interface DataIndexes {
  patientsById: Map<string, Patient>;
  claimsById: Map<string, Claim>;
  /** Uppercase claim number → claim */
  claimsByNumber: Map<string, Claim>;
  /** Uppercase acc45 → claim */
  claimsByAcc45: Map<string, Claim>;
  linesByClaimId: Map<string, ServiceLine[]>;
  approvalsByClaimId: Map<string, Approval[]>;
  /** Resolved claim id or free-text key → invoice lines */
  invoicesByClaimKey: Map<string, InvoiceLine[]>;
}

function claimLookupKeys(claim: Claim): string[] {
  const keys: string[] = [`claim:${claim.id}`];
  const num = (claim.claimNumber || '').trim().toUpperCase();
  const acc = (claim.acc45Number || '').trim().toUpperCase();
  if (num) keys.push(`num:${num}`);
  if (acc) keys.push(`acc:${acc}`);
  return keys;
}

function invoiceClaimKey(inv: InvoiceLine, claim?: Claim): string {
  if (claim) return `claim:${claim.id}`;
  const num = (inv.claimNumber || '').trim().toUpperCase();
  if (num) return `num:${num}`;
  const acc = (inv.acc45Number || '').trim().toUpperCase();
  if (acc) return `acc:${acc}`;
  return `free:${(inv.patientName || '').trim().toLowerCase()}`;
}

export function buildDataIndexes(data: AppData): DataIndexes {
  const patientsById = new Map<string, Patient>();
  for (const p of data.patients) patientsById.set(p.id, p);

  const claimsById = new Map<string, Claim>();
  const claimsByNumber = new Map<string, Claim>();
  const claimsByAcc45 = new Map<string, Claim>();
  for (const c of data.claims) {
    claimsById.set(c.id, c);
    const num = (c.claimNumber || '').trim().toUpperCase();
    const acc = (c.acc45Number || '').trim().toUpperCase();
    if (num && !claimsByNumber.has(num)) claimsByNumber.set(num, c);
    if (acc && !claimsByAcc45.has(acc)) claimsByAcc45.set(acc, c);
  }

  const linesByClaimId = new Map<string, ServiceLine[]>();
  for (const l of data.serviceLines) {
    const arr = linesByClaimId.get(l.claimId) ?? [];
    arr.push(l);
    linesByClaimId.set(l.claimId, arr);
  }

  const approvalsByClaimId = new Map<string, Approval[]>();
  for (const a of data.approvals) {
    const arr = approvalsByClaimId.get(a.claimId) ?? [];
    arr.push(a);
    approvalsByClaimId.set(a.claimId, arr);
  }

  const invoicesByClaimKey = new Map<string, InvoiceLine[]>();
  for (const inv of data.invoiceLines) {
    const num = (inv.claimNumber || '').trim().toUpperCase();
    const acc = (inv.acc45Number || '').trim().toUpperCase();
    const claim =
      (num && claimsByNumber.get(num)) ||
      (acc && claimsByAcc45.get(acc)) ||
      undefined;
    const key = invoiceClaimKey(inv, claim);
    const arr = invoicesByClaimKey.get(key) ?? [];
    arr.push(inv);
    invoicesByClaimKey.set(key, arr);
  }

  return {
    patientsById,
    claimsById,
    claimsByNumber,
    claimsByAcc45,
    linesByClaimId,
    approvalsByClaimId,
    invoicesByClaimKey,
  };
}

/** Resolve a claim from an invoice line using pre-built indexes. */
export function claimForInvoiceIndexed(inv: InvoiceLine, idx: DataIndexes): Claim | undefined {
  const num = (inv.claimNumber || '').trim().toUpperCase();
  const acc = (inv.acc45Number || '').trim().toUpperCase();
  return (num && idx.claimsByNumber.get(num)) || (acc && idx.claimsByAcc45.get(acc)) || undefined;
}

export function invoicesForClaim(claim: Claim, idx: DataIndexes): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  const seen = new Set<string>();
  for (const key of claimLookupKeys(claim)) {
    const lines = idx.invoicesByClaimKey.get(key);
    if (!lines) continue;
    for (const inv of lines) {
      if (!seen.has(inv.id)) {
        seen.add(inv.id);
        out.push(inv);
      }
    }
  }
  return out;
}
