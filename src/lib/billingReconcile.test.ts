import { describe, it, expect } from 'vitest';
import { buildInvoiceClaimIndex, claimKey, matchRemittanceToInvoice, parseAmount, parseDateISO, summariseInvoiceLines } from './billingReconcile';
import type { InvoiceLine } from '../types';

function line(overrides: Partial<InvoiceLine>): InvoiceLine {
  return {
    id: 'inv_1',
    patientName: 'Synthetic Patient',
    nhi: 'ABC1234',
    claimNumber: 'ZZ99999',
    poNumber: '',
    acc45Number: '',
    serviceCode: 'NS01',
    invoiceSheet: 'SHEET',
    invoiceDate: '2026-01-01',
    amountInvoiced: 50,
    status: 'Awaiting Billing',
    notes: '',
    ...overrides,
  };
}

describe('claimKey', () => {
  it('trims and uppercases; never derived from a name', () => {
    expect(claimKey(' nh48372 ')).toBe('NH48372');
    expect(claimKey(undefined)).toBe('');
  });
});

describe('parseAmount / parseDateISO', () => {
  it('parses currency-formatted strings and blanks', () => {
    expect(parseAmount('$1,234.50')).toBe(1234.5);
    expect(parseAmount('')).toBe(0);
    expect(parseAmount(undefined)).toBe(0);
  });

  it('parses dd/mm/yyyy, ISO text, Date objects and Excel serials', () => {
    expect(parseDateISO('05/03/2026')).toBe('2026-03-05');
    expect(parseDateISO('2026-03-05')).toBe('2026-03-05');
    expect(parseDateISO(new Date('2026-03-05T00:00:00.000Z'))).toBe('2026-03-05');
    expect(parseDateISO(45990)).toBeTruthy();
  });
});

describe('buildInvoiceClaimIndex / matchRemittanceToInvoice', () => {
  it('matches by claim number, ignoring any name disagreement between files', () => {
    const invoiceLines = [line({ id: 'inv_1', claimNumber: 'NH48372', patientName: 'David Belk', serviceCode: 'NS05' })];
    const index = buildInvoiceClaimIndex(invoiceLines);
    const matched = matchRemittanceToInvoice({ claimNumber: 'nh48372', serviceCode: 'NS05' }, index);
    expect(matched?.id).toBe('inv_1');
  });

  it('prefers the service-code match within a claim bucket over the first line', () => {
    const invoiceLines = [
      line({ id: 'inv_1', claimNumber: 'AA1', serviceCode: 'NS01', amountInvoiced: 10 }),
      line({ id: 'inv_2', claimNumber: 'AA1', serviceCode: 'NS04', amountInvoiced: 20 }),
    ];
    const index = buildInvoiceClaimIndex(invoiceLines);
    const matched = matchRemittanceToInvoice({ claimNumber: 'AA1', serviceCode: 'NS04' }, index);
    expect(matched?.id).toBe('inv_2');
  });

  it('returns undefined for a claim with no invoice line at all (surfaced by the caller as unmatched)', () => {
    const index = buildInvoiceClaimIndex([line({ claimNumber: 'BB2' })]);
    expect(matchRemittanceToInvoice({ claimNumber: 'NOT-THERE' }, index)).toBeUndefined();
  });
});

describe('summariseInvoiceLines', () => {
  it('totals invoiced/paid/outstanding and counts needs-review lines', () => {
    const lines = [
      line({ amountInvoiced: 100, amountPaid: 100 }),
      line({ amountInvoiced: 50, amountPaid: 0, needsReview: true }),
    ];
    const s = summariseInvoiceLines(lines);
    expect(s.invoicedTotal).toBe(150);
    expect(s.paidTotal).toBe(100);
    expect(s.outstandingTotal).toBe(50);
    expect(s.needsReviewCount).toBe(1);
  });
});
