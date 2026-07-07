import type { Approval } from '../types';
import { daysUntil } from './format';

/** Approvals that count for billing, expiry badges, and coverage (not archived history). */
export function isBillingApproval(approval: Approval): boolean {
  return approval.recordStatus !== 'historical';
}

export function isApprovalCurrent(approval: Approval): boolean {
  return daysUntil(approval.approvalEndDate) >= 0;
}
