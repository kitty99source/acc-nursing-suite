import type { AppData, Approval, ApprovalStatus, InvoiceLine } from '../types';
import { daysUntil, daysBetween, todayISO, monthIndex, yearOf, MONTH_NAMES } from './format';
import { revenueGroupForCode, type RevenueGroup } from './serviceCodes';

// ============================================================================
// Derived analytics. Pure functions over AppData (+ today's date) so the
// dashboard, status columns and Excel export all share one source of truth.
// ============================================================================

export interface ApprovalComputed {
  daysUntilExpiry: number;
  status: ApprovalStatus;
}

export function computeApproval(approval: Approval, thresholdDays: number): ApprovalComputed {
  const days = daysUntil(approval.approvalEndDate);
  let status: ApprovalStatus;
  if (days < 0) status = 'EXPIRED';
  else if (days <= thresholdDays) status = 'Expiring Soon (<30 days)';
  else status = 'Active';
  return { daysUntilExpiry: days, status };
}

export function isApprovalCurrent(approval: Approval): boolean {
  return daysUntil(approval.approvalEndDate) >= 0;
}

export interface BillingFunnel {
  awaitingBilling: { count: number; amount: number };
  billed: { count: number; amount: number };
  remittance: { count: number; amount: number };
}

export function billingFunnel(data: AppData): BillingFunnel {
  const f: BillingFunnel = {
    awaitingBilling: { count: 0, amount: 0 },
    billed: { count: 0, amount: 0 },
    remittance: { count: 0, amount: 0 },
  };
  for (const inv of data.invoiceLines) {
    const amt = inv.amountInvoiced || 0;
    if (inv.status === 'Awaiting Billing') {
      f.awaitingBilling.count += 1;
      f.awaitingBilling.amount += amt;
    } else if (inv.status === 'Billed') {
      f.billed.count += 1;
      f.billed.amount += amt;
    } else if (inv.status === 'Remittance') {
      f.remittance.count += 1;
      f.remittance.amount += amt;
    }
  }
  return f;
}

/** Outstanding = invoiced but not (fully) paid. */
export function outstandingAmount(inv: InvoiceLine): number {
  const invoiced = inv.amountInvoiced || 0;
  const paid = inv.amountPaid || 0;
  return Math.max(0, invoiced - paid);
}

export function isOutstanding(inv: InvoiceLine): boolean {
  if (inv.status === 'Billed' && (inv.amountPaid ?? 0) >= (inv.amountInvoiced || 0)) return false;
  return outstandingAmount(inv) > 0 || inv.status !== 'Billed';
}

export interface AgingBuckets {
  b0_30: number;
  b31_60: number;
  b61_90: number;
  b90plus: number;
  total: number;
}

export function outstandingAging(data: AppData): AgingBuckets {
  const buckets: AgingBuckets = { b0_30: 0, b31_60: 0, b61_90: 0, b90plus: 0, total: 0 };
  const today = todayISO();
  for (const inv of data.invoiceLines) {
    const amt = outstandingAmount(inv);
    if (amt <= 0) continue;
    if (inv.status === 'Billed') continue; // fully paid billed rows excluded above; keep unpaid only
    const ageBase = inv.invoiceDate || today;
    const age = daysBetween(ageBase, today);
    if (age <= 30) buckets.b0_30 += amt;
    else if (age <= 60) buckets.b31_60 += amt;
    else if (age <= 90) buckets.b61_90 += amt;
    else buckets.b90plus += amt;
    buckets.total += amt;
  }
  return buckets;
}

export interface MonthlyPoint {
  month: string;
  invoiced: number;
  paid: number;
}

/** Invoiced vs paid by month, for the most relevant year (defaults to current year). */
export function invoicedVsPaidByMonth(data: AppData, year?: number): MonthlyPoint[] {
  const targetYear = year ?? new Date().getFullYear();
  const points: MonthlyPoint[] = MONTH_NAMES.map((m) => ({ month: m, invoiced: 0, paid: 0 }));
  for (const inv of data.invoiceLines) {
    if (yearOf(inv.invoiceDate) === targetYear) {
      const mi = monthIndex(inv.invoiceDate);
      if (mi >= 0) points[mi].invoiced += inv.amountInvoiced || 0;
    }
    if (inv.datePaid && yearOf(inv.datePaid) === targetYear) {
      const mi = monthIndex(inv.datePaid);
      if (mi >= 0) points[mi].paid += inv.amountPaid || 0;
    }
  }
  return points;
}

export interface RevenuePoint {
  group: RevenueGroup;
  invoiced: number;
  paid: number;
}

export function revenueByGroup(data: AppData): RevenuePoint[] {
  const map = new Map<RevenueGroup, RevenuePoint>();
  const order: RevenueGroup[] = ['Packages (NS01-03)', 'NS04', 'NS05', 'NS06', 'Other'];
  for (const g of order) map.set(g, { group: g, invoiced: 0, paid: 0 });
  for (const inv of data.invoiceLines) {
    const g = revenueGroupForCode(inv.serviceCode);
    const point = map.get(g)!;
    point.invoiced += inv.amountInvoiced || 0;
    point.paid += inv.amountPaid || 0;
  }
  return order.map((g) => map.get(g)!).filter((p) => p.invoiced > 0 || p.paid > 0 || p.group !== 'Other');
}

export interface YearSummaryRow {
  month: string;
  packagesInvoiced: number;
  packagesPaid: number;
  ns04Invoiced: number;
  ns04Paid: number;
  ns05Invoiced: number;
  ns05Paid: number;
  ns06Invoiced: number;
  ns06Paid: number;
}

export function yearSummary(data: AppData, year?: number): YearSummaryRow[] {
  const targetYear = year ?? new Date().getFullYear();
  const rows: YearSummaryRow[] = MONTH_NAMES.map((m) => ({
    month: m,
    packagesInvoiced: 0,
    packagesPaid: 0,
    ns04Invoiced: 0,
    ns04Paid: 0,
    ns05Invoiced: 0,
    ns05Paid: 0,
    ns06Invoiced: 0,
    ns06Paid: 0,
  }));
  for (const inv of data.invoiceLines) {
    const group = revenueGroupForCode(inv.serviceCode);
    if (yearOf(inv.invoiceDate) === targetYear) {
      const mi = monthIndex(inv.invoiceDate);
      if (mi >= 0) {
        const amt = inv.amountInvoiced || 0;
        if (group === 'Packages (NS01-03)') rows[mi].packagesInvoiced += amt;
        else if (group === 'NS04') rows[mi].ns04Invoiced += amt;
        else if (group === 'NS05') rows[mi].ns05Invoiced += amt;
        else if (group === 'NS06') rows[mi].ns06Invoiced += amt;
      }
    }
    if (inv.datePaid && yearOf(inv.datePaid) === targetYear) {
      const mi = monthIndex(inv.datePaid);
      if (mi >= 0) {
        const amt = inv.amountPaid || 0;
        if (group === 'Packages (NS01-03)') rows[mi].packagesPaid += amt;
        else if (group === 'NS04') rows[mi].ns04Paid += amt;
        else if (group === 'NS05') rows[mi].ns05Paid += amt;
        else if (group === 'NS06') rows[mi].ns06Paid += amt;
      }
    }
  }
  return rows;
}

export interface ActionItem {
  id: string;
  kind: 'approval' | 'billing' | 'decline' | 'complex' | 'coverage';
  severity: 'danger' | 'warn';
  title: string;
  detail: string;
}

export function buildActionQueue(data: AppData): ActionItem[] {
  const items: ActionItem[] = [];
  const threshold = data.settings.expiryThresholdDays;

  for (const a of data.approvals) {
    const { daysUntilExpiry, status } = computeApproval(a, threshold);
    const patient = data.patients.find((p) => p.id === a.patientId);
    const name = patient?.name ?? a.patientId;
    if (status === 'EXPIRED') {
      items.push({
        id: `ap-${a.id}`,
        kind: 'approval',
        severity: 'danger',
        title: `${a.serviceCode} approval EXPIRED — ${name}`,
        detail: `Expired ${Math.abs(daysUntilExpiry)} day(s) ago (PO ${a.poNumber}).`,
      });
    } else if (status === 'Expiring Soon (<30 days)') {
      items.push({
        id: `ap-${a.id}`,
        kind: 'approval',
        severity: 'warn',
        title: `${a.serviceCode} approval expiring — ${name}`,
        detail: `${daysUntilExpiry} day(s) until expiry (PO ${a.poNumber}).`,
      });
    }
  }

  for (const inv of data.invoiceLines) {
    if (inv.status === 'Awaiting Billing') {
      items.push({
        id: `bill-${inv.id}`,
        kind: 'billing',
        severity: 'warn',
        title: `Awaiting billing — ${inv.patientName}`,
        detail: `${inv.serviceCode} on ${inv.invoiceSheet || '(no sheet)'}.`,
      });
    } else if (inv.status === 'Remittance') {
      const age = daysBetween(inv.invoiceDate || todayISO(), todayISO());
      items.push({
        id: `bill-${inv.id}`,
        kind: 'billing',
        severity: age > 60 ? 'danger' : 'warn',
        title: `Remittance outstanding — ${inv.patientName}`,
        detail: `${inv.serviceCode}, ${age} day(s) since invoice.`,
      });
    }
  }

  for (const d of data.declines) {
    if (d.status === 'Awaiting nursing docs for resubmission' || d.status === 'Awaiting response from ACC') {
      const age = daysBetween(d.declineReceivedDate || todayISO(), todayISO());
      items.push({
        id: `dec-${d.id}`,
        kind: 'decline',
        severity: age > 30 ? 'danger' : 'warn',
        title: `Open decline — ${d.patientName}`,
        detail: `${d.status} (${age} day(s) since received).`,
      });
    }
  }

  for (const c of data.complexCases) {
    if (c.status === 'Resolved') continue;
    const due = daysUntil(c.nextReviewDate);
    if (c.nextReviewDate && due <= 0) {
      items.push({
        id: `cx-${c.id}`,
        kind: 'complex',
        severity: 'warn',
        title: `Complex case review due — ${c.patientName}`,
        detail: `Review date ${due === 0 ? 'is today' : `passed ${Math.abs(due)} day(s) ago`}.`,
      });
    }
  }

  // Coverage gaps: active claims whose service line requires approval but lacks a current one.
  for (const claim of data.claims) {
    if (claim.status !== 'active') continue;
    const lines = data.serviceLines.filter((s) => s.claimId === claim.id);
    const needsApproval = lines.some((s) => s.serviceCode === 'NS04' || s.serviceCode === 'NS05');
    if (!needsApproval) continue;
    const current = data.approvals.some((a) => a.claimId === claim.id && isApprovalCurrent(a));
    if (!current) {
      const patient = data.patients.find((p) => p.id === claim.patientId);
      items.push({
        id: `cov-${claim.id}`,
        kind: 'coverage',
        severity: 'danger',
        title: `Coverage gap — ${patient?.name ?? claim.claimNumber}`,
        detail: `Active NS04/NS05 service with no current approval/PO (claim ${claim.claimNumber}).`,
      });
    }
  }

  const rank: Record<ActionItem['severity'], number> = { danger: 0, warn: 1 };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export interface DashboardMetrics {
  expiringApprovals: { approval: Approval; computed: ApprovalComputed }[];
  coverageGaps: number;
  funnel: BillingFunnel;
  aging: AgingBuckets;
  monthly: MonthlyPoint[];
  revenue: RevenuePoint[];
  ns04NearLimit: { approval: Approval; pct: number }[];
  ns05AnnualReview: { approval: Approval; computed: ApprovalComputed }[];
  ns06NearCap: { claimNumber: string; patientName: string; count: number }[];
  declineAvgTurnaround: number | null;
  openDeclinesByStage: Record<string, number>;
  complexDue: number;
  outstandingTotal: number;
}

export function dashboardMetrics(data: AppData): DashboardMetrics {
  const threshold = data.settings.expiryThresholdDays;

  const expiringApprovals = data.approvals
    .map((approval) => ({ approval, computed: computeApproval(approval, threshold) }))
    .filter((x) => x.computed.status !== 'Active')
    .sort((a, b) => a.computed.daysUntilExpiry - b.computed.daysUntilExpiry);

  // Coverage gaps count (distinct active claims with NS04/NS05 and no current approval).
  let coverageGaps = 0;
  for (const claim of data.claims) {
    if (claim.status !== 'active') continue;
    const lines = data.serviceLines.filter((s) => s.claimId === claim.id);
    const needsApproval = lines.some((s) => s.serviceCode === 'NS04' || s.serviceCode === 'NS05');
    if (!needsApproval) continue;
    const current = data.approvals.some((a) => a.claimId === claim.id && isApprovalCurrent(a));
    if (!current) coverageGaps += 1;
  }

  const ns04NearLimit = data.approvals
    .filter((a) => a.serviceCode === 'NS04' && a.approvedHoursOrConsults > 0 && a.consultsUsed != null)
    .map((approval) => ({
      approval,
      pct: (approval.consultsUsed! / approval.approvedHoursOrConsults) * 100,
    }))
    .filter((x) => x.pct >= 80)
    .sort((a, b) => b.pct - a.pct);

  const ns05AnnualReview = data.approvals
    .filter((a) => a.serviceCode === 'NS05')
    .map((approval) => ({ approval, computed: computeApproval(approval, threshold) }))
    .filter((x) => x.computed.status !== 'Active')
    .sort((a, b) => a.computed.daysUntilExpiry - b.computed.daysUntilExpiry);

  // NS06 near cap: count NS06 invoice lines per claim.
  const ns06Counts = new Map<string, { claimNumber: string; patientName: string; count: number }>();
  for (const inv of data.invoiceLines) {
    if (inv.serviceCode !== 'NS06') continue;
    const key = inv.claimNumber || inv.patientName;
    const existing = ns06Counts.get(key);
    if (existing) existing.count += 1;
    else ns06Counts.set(key, { claimNumber: inv.claimNumber, patientName: inv.patientName, count: 1 });
  }
  const ns06NearCap = Array.from(ns06Counts.values())
    .filter((x) => x.count >= 45)
    .sort((a, b) => b.count - a.count);

  // Decline turnaround: avg days from received to outcome (for resolved declines).
  const turnarounds: number[] = [];
  const openDeclinesByStage: Record<string, number> = {};
  for (const d of data.declines) {
    if ((d.status === 'Accepted' || d.status === 'Declined again') && d.dateOutcomeReceived) {
      turnarounds.push(daysBetween(d.declineReceivedDate, d.dateOutcomeReceived));
    } else {
      openDeclinesByStage[d.status] = (openDeclinesByStage[d.status] ?? 0) + 1;
    }
  }
  const declineAvgTurnaround =
    turnarounds.length > 0 ? Math.round(turnarounds.reduce((s, n) => s + n, 0) / turnarounds.length) : null;

  const complexDue = data.complexCases.filter(
    (c) => c.status !== 'Resolved' && c.nextReviewDate && daysUntil(c.nextReviewDate) <= 0,
  ).length;

  const aging = outstandingAging(data);

  return {
    expiringApprovals,
    coverageGaps,
    funnel: billingFunnel(data),
    aging,
    monthly: invoicedVsPaidByMonth(data),
    revenue: revenueByGroup(data),
    ns04NearLimit,
    ns05AnnualReview,
    ns06NearCap,
    declineAvgTurnaround,
    openDeclinesByStage,
    complexDue,
    outstandingTotal: aging.total,
  };
}
