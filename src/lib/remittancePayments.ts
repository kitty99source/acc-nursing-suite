// ============================================================================
// Remittance payment applications — batch remove + re-reconcile for Admin Billing.
// Each import creates a RemittanceImportBatch plus one RemittancePayment per matched line.
// Removing a batch drops those payments and recomputes invoice paid/status from what remains.
// ============================================================================

import type { InvoiceLine, InvoiceStatus } from '../types';

export interface RemittanceImportBatch {
  id: string;
  importedAt: number;
  sourceFileName: string;
  lineCount: number;
  matchedCount: number;
  unmatchedClaimNumbers: string[];
}

/** One matched remittance payment applied to an invoice line. */
export interface RemittancePayment {
  id: string;
  batchId: string;
  invoiceLineId: string;
  claimNumber: string;
  amountPaid: number;
  paymentDate?: string;
  reasonCode?: string;
  reasonText?: string;
  lineNeedsReview: boolean;
}

export interface RemittanceRemoveResult {
  ok: boolean;
  error?: string;
  batchId?: string;
  fileName?: string;
  removedLineCount?: number;
  affectedInvoiceCount?: number;
}

/** Recompute an invoice line's paid/status/review fields from remaining payment apps. */
export function recomputeInvoiceFromPayments(
  line: InvoiceLine,
  payments: RemittancePayment[],
): Pick<InvoiceLine, 'amountPaid' | 'datePaid' | 'status' | 'needsReview' | 'heldReasonCode' | 'heldReason'> {
  const mine = payments.filter((p) => p.invoiceLineId === line.id);
  if (mine.length === 0) {
    return {
      amountPaid: undefined,
      datePaid: undefined,
      status: 'Awaiting Billing' as InvoiceStatus,
      needsReview: false,
      heldReasonCode: undefined,
      heldReason: undefined,
    };
  }
  const totalPaid = mine.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
  const paidInFull = totalPaid + 0.005 >= line.amountInvoiced;
  const reviewPayment = [...mine].reverse().find((p) => p.lineNeedsReview && !paidInFull);
  const lastDate = [...mine].reverse().find((p) => p.paymentDate)?.paymentDate;
  return {
    amountPaid: totalPaid,
    datePaid: totalPaid > 0 ? lastDate : undefined,
    status: paidInFull ? 'Billed' : 'Remittance',
    needsReview: Boolean(reviewPayment),
    heldReasonCode: reviewPayment?.reasonCode,
    heldReason: reviewPayment?.reasonText,
  };
}
