import type { FocusTarget } from '../state/store';
import type {
  AppData,
  Approval,
  Claim,
  InvoiceLine,
  Patient,
  ServiceCode,
  ServiceLine,
  Settings,
} from '../types';
import {
  MAX_PACKAGE_CONSULTS,
  NS06_APPROVAL_THRESHOLD,
  NS06_WATCH_THRESHOLD,
  PACKAGE_CODES,
  TRAVEL_ELIGIBLE_CODES,
} from './serviceCodes';
import { determinePackage } from './calculator';
import { daysBetween, todayISO } from './format';
import { isBillingApproval, isApprovalCurrent } from './approvals';

// ============================================================================
// ACC contract-compliance engine. Pure functions over AppData (like the
// calculator / analytics) so it is fully deterministic and unit-testable.
//
// It encodes concrete, checkable rules from the two ACC documents:
//   - Nursing Services Service Schedule (March 2025)
//   - Nursing Services Operational Guidelines (March 2025)
// and cross-checks the STRUCTURED data (claims / service lines / approvals)
// against the BILLING LOG (invoice lines), flagging mismatches between what was
// planned and what was billed.
// ============================================================================

/** Version tag for the encoded rule set (P6-001 / U-20). */
export const COMPLIANCE_RULES_VERSION = '2025-03';

/** Every fix intent action must route to a module with a handler (P6-002). */
export const FIX_INTENT_ROUTES: Record<FixIntent['action'], FocusTarget> = {
  'link-approval': 'patients',
  'create-approval': 'approvals',
  'request-po': 'patients',
  'downgrade-package': 'patients',
  'split-ns04': 'approvals',
  'mark-discharged': 'patients',
  'generate-invoices': 'billing',
  'review-ns05': 'approvals',
  'review-duplicate': 'billing',
};

export type FindingSeverity = 'violation' | 'warning' | 'predictive';

/** Codes that represent provider travel; only billable alongside NS05/NS07/NS20. */
export const TRAVEL_CODES: ServiceCode[] = ['NSTD10', 'NSTT1', 'NSTT1D', 'NSAC'];

/** A one-click, pre-filled remedy attached to a finding. */
export interface FixIntent {
  action:
    | 'link-approval'
    | 'create-approval'
    | 'request-po'
    | 'downgrade-package'
    | 'split-ns04'
    | 'mark-discharged'
    | 'generate-invoices'
    | 'review-ns05'
    | 'review-duplicate';
  module: 'patients' | 'approvals' | 'billing';
  label: string;
  claimId?: string;
  patientId?: string;
  // Free-form hints consumed by the target module to pre-fill a modal.
  prefill?: Record<string, unknown>;
}

export interface ComplianceFinding {
  id: string;
  ruleId: string;
  severity: FindingSeverity;
  claimId?: string;
  patientId?: string;
  patientName: string;
  claimNumber: string;
  title: string;
  detail: string;
  clauseRef: string;
  /** Rule-set version stamped at scan time (P6-001). */
  rulesVersion: string;
  fix?: FixIntent;
}

export interface ComplianceRule {
  id: string;
  title: string;
  clauseRef: string;
  severity: FindingSeverity;
  description: string;
}

export const COMPLIANCE_RULES: Record<string, ComplianceRule> = {
  'one-package-per-claim': {
    id: 'one-package-per-claim',
    title: 'Second package needs a purchase order',
    clauseRef: 'Schedule 5.3 / OG re-entry & transfer',
    severity: 'violation',
    description:
      'Only one package of care can be invoiced per claim without a PO. A second package requires an ACC179 purchase-order request.',
  },
  'ns04-needs-approval': {
    id: 'ns04-needs-approval',
    title: 'NS04 without ACC approval',
    clauseRef: 'Schedule 5.11.2',
    severity: 'violation',
    description: 'Extended Nursing (NS04) requires ACC prior approval before it is delivered or billed.',
  },
  'ns04-before-threshold': {
    id: 'ns04-before-threshold',
    title: 'NS04 used before the 25-consult / 105-day threshold',
    clauseRef: 'Schedule 5.11.4',
    severity: 'warning',
    description: 'NS04 only applies from the 26th consult or the 106th day of service.',
  },
  'exceeds-25-cap': {
    id: 'exceeds-25-cap',
    title: 'Exceeds 25-consult package cap',
    clauseRef: 'Schedule 5.8.4 / 5.9.2 / 5.10.2',
    severity: 'violation',
    description: 'Packages allow a maximum of 25 consults; consults beyond 25 must bill as Extended Nursing (NS04).',
  },
  'package-mismatch': {
    id: 'package-mismatch',
    title: "Package doesn't match duration / consults",
    clauseRef: 'Schedule 5.9.1.2 / 5.10.1.2',
    severity: 'warning',
    description: 'The selected package does not match the recorded duration and consult count, and no override reason was given.',
  },
  'plan-vs-bill-mismatch': {
    id: 'plan-vs-bill-mismatch',
    title: 'Billed package differs from the recorded plan',
    clauseRef: 'Schedule 5.3 / 5.4',
    severity: 'warning',
    description: 'The package invoiced does not match the package the service-line record supports.',
  },
  'ns06-over-50': {
    id: 'ns06-over-50',
    title: 'Over 50 NS06 treatments on one claim',
    clauseRef: 'Schedule 6.1.2',
    severity: 'violation',
    description: 'More than 50 Subsequent Injury (NS06) treatments on the same claim require ACC approval.',
  },
  'ns07-oversight-approval': {
    id: 'ns07-oversight-approval',
    title: '2nd+ Oversight Consultation needs approval',
    clauseRef: 'Schedule 6.2.2',
    severity: 'warning',
    description: 'The first NS07 per claim is approval-free; the second and subsequent require prior ACC approval.',
  },
  'ns05-annual-review': {
    id: 'ns05-annual-review',
    title: 'Ongoing Nursing due for annual review / CNA',
    clauseRef: 'Schedule 5.12.4 / 6.4.2',
    severity: 'warning',
    description: 'NS05 must be reviewed at least annually; 12+ months continuous service needs a Comprehensive Nursing Assessment.',
  },
  'travel-needs-eligible': {
    id: 'travel-needs-eligible',
    title: 'Travel billed without an eligible service',
    clauseRef: 'Schedule 15.2.2 / Travel',
    severity: 'violation',
    description: 'Travel is only billable alongside Ongoing Nursing (NS05), Oversight (NS07) or a Comprehensive Nursing Assessment (NS20/NS20T).',
  },
  'ns04-beyond-approval': {
    id: 'ns04-beyond-approval',
    title: 'NS04 delivered beyond the approval',
    clauseRef: 'Schedule 5.11.5',
    severity: 'violation',
    description: 'Only the ACC-approved number of NS04 consults, within the approved period, may be invoiced.',
  },
  'double-billing': {
    id: 'double-billing',
    title: 'Possible double billing',
    clauseRef: 'Schedule 9.3',
    severity: 'warning',
    description: 'Two invoice lines share the same claim, code, date and sheet — check this is not a duplicate.',
  },
  'near-25-consults': {
    id: 'near-25-consults',
    title: 'Approaching the 25-consult cap',
    clauseRef: 'Schedule 5.11.1',
    severity: 'predictive',
    description: 'This episode is nearing 25 consults; request NS04 approval before the cap is reached.',
  },
  'near-105-days': {
    id: 'near-105-days',
    title: 'Approaching the 105-day limit',
    clauseRef: 'Schedule 5.11.1',
    severity: 'predictive',
    description: 'This episode is nearing 105 days; NS04 will be needed from day 106.',
  },
  'near-50-ns06': {
    id: 'near-50-ns06',
    title: 'Approaching the 50 NS06 cap',
    clauseRef: 'Schedule 6.1.2',
    severity: 'predictive',
    description: 'NS06 treatments are approaching 50; approval will be required beyond 50.',
  },
  'ns07-first-used': {
    id: 'ns07-first-used',
    title: 'First Oversight used — next needs approval',
    clauseRef: 'Schedule 6.2.2',
    severity: 'predictive',
    description: 'The first NS07 has been used; any further Oversight Consultation on this claim needs prior approval.',
  },
  'discharged-awaiting-billing': {
    id: 'discharged-awaiting-billing',
    title: 'Discharged — not yet billed',
    clauseRef: 'OG Invoicing / Service Exit',
    severity: 'warning',
    description: 'This claim is discharged but has not been billed yet; do not let it fall through the cracks.',
  },
};

// ----------------------------------------------------------------------------
// Matching helpers: link the free-text Billing Log to structured claims.
// ----------------------------------------------------------------------------

function norm(s?: string): string {
  return (s ?? '').trim().toUpperCase();
}

interface ClaimIndex {
  byClaimNumber: Map<string, Claim>;
  byAcc45: Map<string, Claim>;
}

function buildClaimIndex(claims: Claim[]): ClaimIndex {
  const byClaimNumber = new Map<string, Claim>();
  const byAcc45 = new Map<string, Claim>();
  for (const c of claims) {
    if (c.claimNumber) byClaimNumber.set(norm(c.claimNumber), c);
    if (c.acc45Number) byAcc45.set(norm(c.acc45Number), c);
  }
  return { byClaimNumber, byAcc45 };
}

/** Resolve the Claim an invoice line belongs to, if we can. */
export function claimForInvoice(inv: InvoiceLine, index: ClaimIndex): Claim | undefined {
  return (
    index.byClaimNumber.get(norm(inv.claimNumber)) ||
    index.byAcc45.get(norm(inv.acc45Number)) ||
    undefined
  );
}

/** Stable grouping key for a set of invoice lines (claim id when known). */
function invoiceGroupKey(inv: InvoiceLine, claim?: Claim): string {
  if (claim) return `claim:${claim.id}`;
  const num = norm(inv.claimNumber) || norm(inv.acc45Number) || norm(inv.poNumber);
  return num ? `num:${num}` : `inv:${inv.id}`;
}

// ----------------------------------------------------------------------------
// Billing readiness — powers the "safe to bill now" UI and the discharge flag.
// ----------------------------------------------------------------------------

export type BillingState = 'waiting' | 'ready' | 'blocked-on-approval' | 'billed';

export interface ClaimBillingInfo {
  state: BillingState;
  reason: string;
}

/** Does this claim have any package/service invoice line already raised? */
function hasBilledWork(invoices: InvoiceLine[]): boolean {
  return invoices.some((i) => PACKAGE_CODES.includes(i.serviceCode) || i.serviceCode === 'NS04' || i.serviceCode === 'NS05');
}

/** True when the package episode is complete enough to invoice. */
function episodeComplete(claim: Claim, lines: ServiceLine[]): boolean {
  if (claim.status === 'discharged') return true;
  return lines.some((l) => {
    if (!PACKAGE_CODES.includes(l.serviceCode)) return false;
    if (l.lastConsultDate) return true;
    if ((l.consultCount || 0) >= MAX_PACKAGE_CONSULTS) return true;
    if (l.day1Date && daysBetween(l.day1Date, todayISO()) > 105) return true;
    return false;
  });
}

export function claimBillingState(
  claim: Claim,
  lines: ServiceLine[],
  approvals: Approval[],
  invoices: InvoiceLine[],
): ClaimBillingInfo {
  if (hasBilledWork(invoices)) return { state: 'billed', reason: 'Work has been invoiced for this claim.' };

  const needsApproval = lines.some((l) => l.serviceCode === 'NS04' || l.serviceCode === 'NS05');
  const hasCurrentApproval = approvals.some(
    (a) => isBillingApproval(a) && isApprovalCurrent(a),
  );
  if (needsApproval && !hasCurrentApproval) {
    return { state: 'blocked-on-approval', reason: 'Needs a current NS04/NS05 approval / PO before billing.' };
  }

  if (episodeComplete(claim, lines)) {
    return { state: 'ready', reason: 'Episode complete — safe to bill now.' };
  }
  return { state: 'waiting', reason: 'Episode still in progress — bill only once complete.' };
}

// ----------------------------------------------------------------------------
// The engine.
// ----------------------------------------------------------------------------

export interface ComplianceSummary {
  violations: number;
  warnings: number;
  predictive: number;
  total: number;
}

export function complianceSummary(findings: ComplianceFinding[]): ComplianceSummary {
  const s: ComplianceSummary = { violations: 0, warnings: 0, predictive: 0, total: findings.length };
  for (const f of findings) {
    if (f.severity === 'violation') s.violations += 1;
    else if (f.severity === 'warning') s.warnings += 1;
    else s.predictive += 1;
  }
  return s;
}

function push(
  out: ComplianceFinding[],
  ruleId: string,
  key: string,
  rulesVersion: string,
  fields: Partial<ComplianceFinding> & { patientName: string; claimNumber: string; detail: string },
): void {
  const rule = COMPLIANCE_RULES[ruleId];
  out.push({
    id: `${ruleId}:${key}`,
    ruleId,
    severity: rule.severity,
    title: rule.title,
    clauseRef: rule.clauseRef,
    rulesVersion,
    ...fields,
  });
}

/** Incremental scan for specific claims only (P1-012). */
export function runComplianceForClaims(data: AppData, claimIds: Set<string>): ComplianceFinding[] {
  return runCompliance(data, claimIds);
}

export function runCompliance(data: AppData, claimFilter?: Set<string>): ComplianceFinding[] {
  const out: ComplianceFinding[] = [];
  const rulesVersion = data.settings.complianceRulesVersion ?? COMPLIANCE_RULES_VERSION;
  const rates = data.settings.serviceRates as Settings['serviceRates'];
  const patientsById = new Map<string, Patient>(data.patients.map((p) => [p.id, p]));
  const index = buildClaimIndex(data.claims);

  // Group invoice lines by resolved claim (or free-text claim number).
  const invoiceGroups = new Map<string, { claim?: Claim; invoices: InvoiceLine[] }>();
  for (const inv of data.invoiceLines) {
    const claim = claimForInvoice(inv, index);
    const key = invoiceGroupKey(inv, claim);
    let g = invoiceGroups.get(key);
    if (!g) {
      g = { claim, invoices: [] };
      invoiceGroups.set(key, g);
    }
    g.invoices.push(inv);
  }

  const linesByClaim = new Map<string, ServiceLine[]>();
  for (const l of data.serviceLines) {
    const arr = linesByClaim.get(l.claimId) ?? [];
    arr.push(l);
    linesByClaim.set(l.claimId, arr);
  }
  const approvalsByClaim = new Map<string, Approval[]>();
  for (const a of data.approvals) {
    const arr = approvalsByClaim.get(a.claimId) ?? [];
    arr.push(a);
    approvalsByClaim.set(a.claimId, arr);
  }

  const patientName = (claim?: Claim, fallback = ''): string => {
    if (claim) return patientsById.get(claim.patientId)?.name || fallback || claim.claimNumber;
    return fallback;
  };

  // ---- Structured, per-claim rules ----------------------------------------
  for (const claim of data.claims) {
    if (claimFilter && !claimFilter.has(claim.id)) continue;
    const lines = linesByClaim.get(claim.id) ?? [];
    const approvals = approvalsByClaim.get(claim.id) ?? [];
    const invoices =
      invoiceGroups.get(`claim:${claim.id}`)?.invoices ?? [];
    const name = patientName(claim);
    const base = {
      claimId: claim.id,
      patientId: claim.patientId,
      patientName: name,
      claimNumber: claim.claimNumber,
    };

    const packageLines = lines.filter((l) => PACKAGE_CODES.includes(l.serviceCode));
    const hasNs04Signal =
      lines.some((l) => l.serviceCode === 'NS04') || invoices.some((i) => i.serviceCode === 'NS04');
    const ns04Approvals = approvals.filter((a) => a.serviceCode === 'NS04' && isBillingApproval(a));
    const ns05Approvals = approvals.filter((a) => a.serviceCode === 'NS05' && isBillingApproval(a));

    // NS04 without any approval on the claim.
    if (hasNs04Signal && ns04Approvals.length === 0) {
      push(out, 'ns04-needs-approval', claim.id, rulesVersion, {
        ...base,
        detail: `NS04 (Extended Nursing) is in use on ${claim.claimNumber || 'this claim'} but there is no NS04 approval on file.`,
        fix: {
          action: 'create-approval',
          module: 'approvals',
          label: 'Create NS04 approval',
          claimId: claim.id,
          patientId: claim.patientId,
          prefill: { serviceCode: 'NS04', poNumber: claim.poNumber },
        },
      });
    }

    // Package rules driven by service-line records.
    for (const line of packageLines) {
      const det = determinePackage(
        {
          day1: line.day1Date,
          lastConsult: line.lastConsultDate || undefined,
          consultCount: line.consultCount,
          interruptions: line.interruptions,
        },
        rates,
      );
      const effective = line.overridePackage ?? line.serviceCode;

      // 25-consult cap without NS04.
      if (line.consultCount > MAX_PACKAGE_CONSULTS && !hasNs04Signal) {
        push(out, 'exceeds-25-cap', line.id, rulesVersion, {
          ...base,
          detail: `${line.consultCount} consults logged on a ${effective} package (cap ${MAX_PACKAGE_CONSULTS}); consults beyond ${MAX_PACKAGE_CONSULTS} must bill as NS04.`,
          fix: {
            action: 'split-ns04',
            module: 'approvals',
            label: 'Set up NS04 for the overflow',
            claimId: claim.id,
            patientId: claim.patientId,
            prefill: { serviceCode: 'NS04', poNumber: claim.poNumber },
          },
        });
      }

      // Package doesn't match duration/consults (and no override reason).
      const supported = det.primaryPackage;
      if (effective !== supported && PACKAGE_CODES.includes(effective) && !line.overrideReason) {
        push(out, 'package-mismatch', line.id, rulesVersion, {
          ...base,
          detail: `Recorded ${effective} but ${line.consultCount} consult(s) over ${det.durationDays} day(s) supports ${supported}.`,
          fix: {
            action: 'downgrade-package',
            module: 'patients',
            label: `Set override to ${supported}`,
            claimId: claim.id,
            patientId: claim.patientId,
            prefill: { serviceLineId: line.id, overridePackage: supported },
          },
        });
      }

      // NS04 used before the threshold is reached.
      if (hasNs04Signal && !det.needsExtended && line.consultCount <= MAX_PACKAGE_CONSULTS) {
        push(out, 'ns04-before-threshold', line.id, rulesVersion, {
          ...base,
          detail: `NS04 is present but ${effective} shows only ${line.consultCount} consult(s) / ${det.durationDays} day(s) — below the 26th-consult / day-106 threshold.`,
        });
      }

      // Predictive: nearing the caps (ongoing episodes only).
      if (!line.lastConsultDate) {
        if (line.consultCount >= 20 && line.consultCount <= MAX_PACKAGE_CONSULTS) {
          push(out, 'near-25-consults', line.id, rulesVersion, {
            ...base,
            severity: 'predictive',
            detail: `${line.consultCount}/${MAX_PACKAGE_CONSULTS} consults used — request NS04 approval before the cap.`,
          });
        }
        const daysSoFar = line.day1Date ? daysBetween(line.day1Date, todayISO()) : 0;
        if (daysSoFar >= 90 && daysSoFar <= 105) {
          push(out, 'near-105-days', line.id, rulesVersion, {
            ...base,
            severity: 'predictive',
            detail: `${daysSoFar}/105 days elapsed — NS04 will be needed from day 106.`,
          });
        }
      }
    }

    // Cross-check: billed package vs recorded plan (both sources of truth).
    const billedPackages = invoices.filter((i) => PACKAGE_CODES.includes(i.serviceCode)).map((i) => i.serviceCode);
    if (packageLines.length > 0 && billedPackages.length > 0) {
      const supported = new Set(packageLines.map((l) => l.overridePackage ?? l.serviceCode));
      for (const billed of billedPackages) {
        if (!supported.has(billed)) {
          push(out, 'plan-vs-bill-mismatch', `${claim.id}:${billed}`, rulesVersion, {
            ...base,
            detail: `Billed ${billed} but the service-line record supports ${[...supported].join(' / ')}.`,
            fix: {
              action: 'review-duplicate',
              module: 'billing',
              label: 'Review in Billing Log',
              claimId: claim.id,
            },
          });
        }
      }
    }

    // NS04 delivered beyond the approved number / period.
    for (const a of ns04Approvals) {
      if (a.consultsUsed != null && a.approvedHoursOrConsults > 0 && a.consultsUsed > a.approvedHoursOrConsults) {
        push(out, 'ns04-beyond-approval', `${a.id}:used`, rulesVersion, {
          ...base,
          detail: `${a.consultsUsed} NS04 consults used against ${a.approvedHoursOrConsults} approved (PO ${a.poNumber || '—'}).`,
          fix: {
            action: 'create-approval',
            module: 'approvals',
            label: 'Request further NS04 approval',
            claimId: claim.id,
            patientId: claim.patientId,
            prefill: { serviceCode: 'NS04', poNumber: claim.poNumber },
          },
        });
      }
      const lateNs04 = invoices.find(
        (i) => i.serviceCode === 'NS04' && i.invoiceDate && a.approvalEndDate && daysBetween(a.approvalEndDate, i.invoiceDate) > 0,
      );
      if (lateNs04) {
        push(out, 'ns04-beyond-approval', `${a.id}:late`, rulesVersion, {
          ...base,
          detail: `An NS04 invoice dated ${lateNs04.invoiceDate} is after the approval end date ${a.approvalEndDate} (PO ${a.poNumber || '—'}).`,
        });
      }
    }

    // NS05 annual review / Comprehensive Nursing Assessment.
    for (const a of ns05Approvals) {
      const ageDays = a.approvalStartDate ? daysBetween(a.approvalStartDate, todayISO()) : 0;
      const hasRecentCNA = invoices.some(
        (i) => (i.serviceCode === 'NS20' || i.serviceCode === 'NS20T') && i.invoiceDate && daysBetween(i.invoiceDate, todayISO()) <= 365,
      );
      if (ageDays >= 365 && !a.accEmailedRenewalDate) {
        push(out, 'ns05-annual-review', `${a.id}:review`, rulesVersion, {
          ...base,
          detail: `Ongoing Nursing approved ${a.approvalStartDate} (${Math.floor(ageDays / 30)} months ago) — due for annual review${hasRecentCNA ? '' : ' and a Comprehensive Nursing Assessment'}.`,
          fix: {
            action: 'review-ns05',
            module: 'approvals',
            label: 'Open NS05 approval',
            claimId: claim.id,
            patientId: claim.patientId,
          },
        });
      } else if (ageDays >= 305 && ageDays < 365) {
        push(out, 'ns05-annual-review', `${a.id}:soon`, rulesVersion, {
          ...base,
          severity: 'predictive',
          detail: `Ongoing Nursing reaches its 12-month review in ${365 - ageDays} day(s); prompt ACC for renewal.`,
        });
      }
    }

    // Discharged but not yet billed — don't let it fall through.
    if (claim.status === 'discharged') {
      const billingInfo = claimBillingState(claim, lines, approvals, invoices);
      if (billingInfo.state !== 'billed') {
        push(out, 'discharged-awaiting-billing', claim.id, rulesVersion, {
          ...base,
          detail:
            billingInfo.state === 'blocked-on-approval'
              ? 'Discharged and awaiting approval / PO before you can bill.'
              : 'Discharged and ready to bill — this has not been invoiced yet.',
          fix:
            billingInfo.state === 'blocked-on-approval'
              ? {
                  action: 'create-approval',
                  module: 'approvals',
                  label: 'Record the approval / PO',
                  claimId: claim.id,
                  patientId: claim.patientId,
                  prefill: { poNumber: claim.poNumber },
                }
              : {
                  action: 'generate-invoices',
                  module: 'billing',
                  label: 'Generate invoice lines',
                  claimId: claim.id,
                  patientId: claim.patientId,
                },
        });
      }
    }
  }

  // ---- Invoice-centric rules (work even without a structured claim) --------
  for (const [key, group] of invoiceGroups) {
    if (claimFilter && group.claim && !claimFilter.has(group.claim.id)) continue;
    const { claim, invoices } = group;
    const first = invoices[0];
    const name = patientName(claim, first?.patientName);
    const claimNumber = claim?.claimNumber || first?.claimNumber || '—';
    const base = {
      claimId: claim?.id,
      patientId: claim?.patientId,
      patientName: name,
      claimNumber,
    };

    // One package of care per claim (needs a PO for a second).
    const pkgLines = invoices.filter((i) => PACKAGE_CODES.includes(i.serviceCode));
    if (pkgLines.length > 1) {
      const distinctPOs = new Set(pkgLines.map((i) => norm(i.poNumber)).filter(Boolean));
      if (distinctPOs.size < pkgLines.length) {
        push(out, 'one-package-per-claim', key, rulesVersion, {
          ...base,
          detail: `${pkgLines.length} packages invoiced on this claim but only ${distinctPOs.size} distinct PO(s); a second package needs its own purchase order (ACC179).`,
          fix: {
            action: 'request-po',
            module: 'patients',
            label: 'Request a purchase order',
            claimId: claim?.id,
            patientId: claim?.patientId,
            prefill: { poNumber: claim?.poNumber },
          },
        });
      }
    }

    // NS06 > 50 (and predictive when approaching).
    const ns06Count = invoices.filter((i) => i.serviceCode === 'NS06').length;
    if (ns06Count > NS06_APPROVAL_THRESHOLD) {
      push(out, 'ns06-over-50', key, rulesVersion, {
        ...base,
        detail: `${ns06Count} NS06 treatments on this claim — approval is required beyond ${NS06_APPROVAL_THRESHOLD}.`,
        fix: {
          action: 'request-po',
          module: 'patients',
          label: 'Request NS06 approval',
          claimId: claim?.id,
          patientId: claim?.patientId,
        },
      });
    } else if (ns06Count >= NS06_WATCH_THRESHOLD) {
      push(out, 'near-50-ns06', key, rulesVersion, {
        ...base,
        severity: 'predictive',
        detail: `${ns06Count} NS06 treatments — approaching the ${NS06_APPROVAL_THRESHOLD}-treatment approval threshold.`,
      });
    }

    // Oversight (NS07): first is free, 2nd+ need approval.
    const ns07Count = invoices.filter((i) => i.serviceCode === 'NS07').length;
    if (ns07Count >= 2) {
      push(out, 'ns07-oversight-approval', key, rulesVersion, {
        ...base,
        detail: `${ns07Count} Oversight Consultations (NS07) on this claim; the 2nd and later require prior approval.`,
      });
    } else if (ns07Count === 1) {
      push(out, 'ns07-first-used', key, rulesVersion, {
        ...base,
        severity: 'predictive',
        detail: 'First Oversight Consultation used; any further NS07 on this claim needs prior approval.',
      });
    }

    // Travel only alongside NS05 / NS07 / NS20(/T).
    const hasTravel = invoices.some((i) => TRAVEL_CODES.includes(i.serviceCode));
    const hasEligible = invoices.some((i) => TRAVEL_ELIGIBLE_CODES.includes(i.serviceCode));
    if (hasTravel && !hasEligible) {
      push(out, 'travel-needs-eligible', key, rulesVersion, {
        ...base,
        detail: 'A travel code is billed on this claim with no NS05 / NS07 / NS20 to justify it.',
        fix: {
          action: 'review-duplicate',
          module: 'billing',
          label: 'Review in Billing Log',
          claimId: claim?.id,
        },
      });
    }

    // Possible double billing: same code+date+sheet twice.
    const seen = new Map<string, number>();
    for (const i of invoices) {
      const dk = `${i.serviceCode}|${i.invoiceDate}|${norm(i.invoiceSheet)}`;
      seen.set(dk, (seen.get(dk) ?? 0) + 1);
    }
    for (const [dk, count] of seen) {
      if (count > 1) {
        const [code, date] = dk.split('|');
        push(out, 'double-billing', `${key}:${dk}`, rulesVersion, {
          ...base,
          detail: `${count} ${code} lines share date ${date || '(none)'} on the same sheet — check for a duplicate.`,
          fix: {
            action: 'review-duplicate',
            module: 'billing',
            label: 'Review in Billing Log',
            claimId: claim?.id,
          },
        });
      }
    }
  }

  const rank: Record<FindingSeverity, number> = { violation: 0, warning: 1, predictive: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** Returns orphan fix intents whose module does not match FIX_INTENT_ROUTES (P6-002). */
export function orphanFixIntents(findings: ComplianceFinding[]): FixIntent[] {
  const orphans: FixIntent[] = [];
  for (const f of findings) {
    if (!f.fix) continue;
    const expected = FIX_INTENT_ROUTES[f.fix.action];
    if (!expected || f.fix.module !== expected) orphans.push(f.fix);
  }
  return orphans;
}
