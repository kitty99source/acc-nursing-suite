// ============================================================================
// Sidebar nav attention badges — action counts with short labels, NOT bare totals.
// ============================================================================

import { daysUntil } from './format';
import type { Approval, ComplexCase, Decline, InvoiceLine } from '../types';
import { computeApproval, isBillingApproval } from './analytics';
import type { ModuleId } from '../components/Sidebar';

export interface SidebarBadgeSpec {
  count: number;
  /** Short visible label (e.g. "3 review") — not a bare number alone. */
  label: string;
  /** Native tooltip explaining what the number means. */
  title: string;
  ariaLabel?: string;
}

/**
 * Stable partition: attention items first, then the rest, preserving relative order.
 */
export function pinAttentionFirst<T>(items: readonly T[], needsAttention: (item: T) => boolean): T[] {
  const attention: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    (needsAttention(item) ? attention : rest).push(item);
  }
  return [...attention, ...rest];
}

export function invoiceNeedsBillingAttention(inv: Pick<InvoiceLine, 'status' | 'needsReview'>): boolean {
  return inv.needsReview === true || inv.status === 'Awaiting Billing' || inv.status === 'Remittance';
}

export function computeSidebarBadges(input: {
  approvals: Approval[];
  invoiceLines: InvoiceLine[];
  declines: Decline[];
  complexCases: ComplexCase[];
  expiryThresholdDays: number;
  complianceAttention: number;
  actionQueueCount: number;
  reviewPendingCount: number;
}): Partial<Record<ModuleId, SidebarBadgeSpec>> {
  const result: Partial<Record<ModuleId, SidebarBadgeSpec>> = {};

  if (input.actionQueueCount) {
    const n = input.actionQueueCount;
    result.dashboard = {
      count: n,
      label: `${n} due`,
      title: `${n} action-queue item${n === 1 ? '' : 's'} need attention`,
      ariaLabel: `${n} dashboard actions due`,
    };
  }

  const approvalsAttention = input.approvals.filter(
    (a) => isBillingApproval(a) && computeApproval(a, input.expiryThresholdDays).status !== 'Active',
  ).length;
  if (approvalsAttention) {
    const n = approvalsAttention;
    result.approvals = {
      count: n,
      label: `${n} review`,
      title: `${n} approval${n === 1 ? '' : 's'} expiring or expired — not total approvals`,
      ariaLabel: `${n} approvals need review`,
    };
  }

  const billingAttention = input.invoiceLines.filter(invoiceNeedsBillingAttention).length;
  if (billingAttention) {
    const n = billingAttention;
    result.billing = {
      count: n,
      label: `${n} review`,
      title: `${n} invoice line${n === 1 ? '' : 's'} in Awaiting Billing / Remittance or flagged needs review — not every billed row`,
      ariaLabel: `${n} billing lines need review`,
    };
  }

  const declineAttention = input.declines.filter(
    (d) =>
      d.status === 'Awaiting nursing docs for resubmission' || d.status === 'Awaiting response from ACC',
  ).length;
  if (declineAttention) {
    const n = declineAttention;
    result.declines = {
      count: n,
      label: `${n} due`,
      title: `${n} decline${n === 1 ? '' : 's'} awaiting docs or ACC response`,
      ariaLabel: `${n} declines need follow-up`,
    };
  }

  const complexAttention = input.complexCases.filter(
    (c) => c.status !== 'Resolved' && c.nextReviewDate && daysUntil(c.nextReviewDate) <= 0,
  ).length;
  if (complexAttention) {
    const n = complexAttention;
    result.complex = {
      count: n,
      label: `${n} due`,
      title: `${n} complex case${n === 1 ? '' : 's'} with review due`,
      ariaLabel: `${n} complex cases due`,
    };
  }

  if (input.complianceAttention) {
    const n = input.complianceAttention;
    result.compliance = {
      count: n,
      label: `${n} flag`,
      title: `${n} compliance finding${n === 1 ? '' : 's'} (violations + warnings)`,
      ariaLabel: `${n} compliance flags`,
    };
  }

  if (input.reviewPendingCount) {
    const n = input.reviewPendingCount;
    result.review = {
      count: n,
      label: `${n} queue`,
      title: `${n} letter${n === 1 ? '' : 's'} pending in Review Queue`,
      ariaLabel: `${n} letters in Review Queue`,
    };
  }

  return result;
}
