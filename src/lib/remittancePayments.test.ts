import { describe, expect, it } from 'vitest';
import { recomputeInvoiceFromPayments, type RemittancePayment } from './remittancePayments';
import type { InvoiceLine } from '../types';

function line(partial: Partial<InvoiceLine> & Pick<InvoiceLine, 'id' | 'amountInvoiced'>): InvoiceLine {
  return {
    patientName: 'Test',
    nhi: '',
    claimNumber: 'C1',
    poNumber: '',
    acc45Number: '',
    serviceCode: 'NS01',
    invoiceSheet: 'SHEET',
    invoiceDate: '2026-01-01',
    status: 'Awaiting Billing',
    notes: '',
    ...partial,
  };
}

describe('recomputeInvoiceFromPayments', () => {
  it('clears paid state when no payments remain', () => {
    const inv = line({
      id: 'inv1',
      amountInvoiced: 40,
      amountPaid: 40,
      status: 'Billed',
      needsReview: true,
    });
    expect(recomputeInvoiceFromPayments(inv, [])).toEqual({
      amountPaid: undefined,
      datePaid: undefined,
      status: 'Awaiting Billing',
      needsReview: false,
      heldReasonCode: undefined,
      heldReason: undefined,
    });
  });

  it('marks billed when remaining payments cover the invoice', () => {
    const inv = line({ id: 'inv1', amountInvoiced: 40 });
    const payments: RemittancePayment[] = [
      {
        id: 'p1',
        batchId: 'b1',
        invoiceLineId: 'inv1',
        claimNumber: 'C1',
        amountPaid: 40,
        lineNeedsReview: false,
      },
    ];
    const out = recomputeInvoiceFromPayments(inv, payments);
    expect(out.status).toBe('Billed');
    expect(out.amountPaid).toBe(40);
    expect(out.needsReview).toBe(false);
  });

  it('keeps Remittance + needsReview when a held payment remains', () => {
    const inv = line({ id: 'inv1', amountInvoiced: 100 });
    const payments: RemittancePayment[] = [
      {
        id: 'p1',
        batchId: 'b1',
        invoiceLineId: 'inv1',
        claimNumber: 'C1',
        amountPaid: 0,
        lineNeedsReview: true,
        reasonCode: 'NAF',
        reasonText: 'not an ACC claim',
      },
    ];
    const out = recomputeInvoiceFromPayments(inv, payments);
    expect(out.status).toBe('Remittance');
    expect(out.needsReview).toBe(true);
    expect(out.heldReasonCode).toBe('NAF');
  });
});
