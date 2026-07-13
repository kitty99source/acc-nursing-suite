import { describe, expect, it } from 'vitest';
import { computeSidebarBadges, invoiceNeedsBillingAttention, pinAttentionFirst } from './sidebarBadges';
import type { Approval, InvoiceLine } from '../types';

describe('pinAttentionFirst', () => {
  it('pins attention rows first without scrambling relative order', () => {
    const rows = [
      { id: 'a', flag: false },
      { id: 'b', flag: true },
      { id: 'c', flag: false },
      { id: 'd', flag: true },
    ];
    expect(pinAttentionFirst(rows, (r) => r.flag).map((r) => r.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('returns a copy when nothing needs attention', () => {
    const rows = [{ id: 'a' }, { id: 'b' }];
    const pinned = pinAttentionFirst(rows, () => false);
    expect(pinned.map((r) => r.id)).toEqual(['a', 'b']);
    expect(pinned).not.toBe(rows);
  });
});

describe('invoiceNeedsBillingAttention', () => {
  it('flags Remittance / Awaiting Billing / needsReview', () => {
    expect(invoiceNeedsBillingAttention({ status: 'Billed', needsReview: false })).toBe(false);
    expect(invoiceNeedsBillingAttention({ status: 'Awaiting Billing' })).toBe(true);
    expect(invoiceNeedsBillingAttention({ status: 'Remittance' })).toBe(true);
    expect(invoiceNeedsBillingAttention({ status: 'Billed', needsReview: true })).toBe(true);
  });
});

describe('computeSidebarBadges', () => {
  it('labels review and billing as attention counts', () => {
    const badges = computeSidebarBadges({
      approvals: [] as Approval[],
      invoiceLines: [
        { status: 'Remittance', needsReview: true } as InvoiceLine,
        { status: 'Billed', needsReview: false } as InvoiceLine,
      ],
      declines: [],
      complexCases: [],
      expiryThresholdDays: 30,
      complianceAttention: 0,
      actionQueueCount: 2,
      reviewPendingCount: 4,
    });
    expect(badges.dashboard?.label).toBe('2 due');
    expect(badges.billing?.label).toBe('1 review');
    expect(badges.review?.label).toBe('4 queue');
  });
});
