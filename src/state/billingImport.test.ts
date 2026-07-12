import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store';
import { emptyData } from '../lib/sampleData';
import { parseInvoiceScheduleGrid, toInvoiceLineCandidate } from '../lib/invoiceScheduleImport';
import { parseRemittanceGrid } from '../lib/remittanceImport';

// End-to-end (synthetic-fixture) coverage of the store actions that back the
// Billing module's "Import invoice schedule" / "Import remittance" buttons.
describe('importInvoiceSchedule + importRemittanceBatch (store)', () => {
  beforeEach(() => {
    useStore.setState({ ready: true, data: emptyData() });
  });

  it('bulk-creates invoice lines from a parsed invoice schedule', () => {
    const parsed = parseInvoiceScheduleGrid(
      [
        ['ClaimNumber', 'NHI', 'ClaimantFirstName', 'ClaimantSurname', 'ServiceDate', 'ClaimedTotalAmount', 'ACCServiceItemCode1'],
        ['NH00001', 'ABC1234', 'JANE', 'DOE', '2026-03-09', '42.50', 'NS05'],
        ['NH00002', 'DEF5678', 'JOHN', 'SMITH', '2026-03-10', '18.00', 'NS01'],
      ],
      'EXTMAR26',
    );
    expect(parsed.unrecognised).toBe(false);
    const rows = parsed.lines.map(toInvoiceLineCandidate);
    const result = useStore.getState().importInvoiceSchedule(rows);
    expect(result).toEqual({ created: 2, updated: 0 });

    const invoiceLines = useStore.getState().data.invoiceLines;
    expect(invoiceLines).toHaveLength(2);
    const l1 = invoiceLines.find((l) => l.claimNumber === 'NH00001');
    expect(l1?.status).toBe('Awaiting Billing');
    expect(l1?.amountInvoiced).toBe(42.5);
    expect(l1?.invoiceSheet).toBe('EXTMAR26');
  });

  it('re-importing the same claim/code/sheet updates in place instead of duplicating', () => {
    const rows = [
      toInvoiceLineCandidate({
        patientName: 'Jane Doe',
        nhi: 'ABC1234',
        claimNumber: 'NH00001',
        serviceCode: 'NS05',
        serviceDate: '2026-03-09',
        amountInvoiced: 42.5,
        invoiceSheet: 'EXTMAR26',
      }),
    ];
    useStore.getState().importInvoiceSchedule(rows);
    const second = useStore.getState().importInvoiceSchedule([{ ...rows[0], amountInvoiced: 45 }]);
    expect(second).toEqual({ created: 0, updated: 1 });
    expect(useStore.getState().data.invoiceLines).toHaveLength(1);
    expect(useStore.getState().data.invoiceLines[0].amountInvoiced).toBe(45);
  });

  it('matches remittance lines by claim number (ACC45 key) and never by patient name', () => {
    useStore.getState().addInvoiceLine({
      patientName: 'David Belk',
      nhi: 'ARA0568',
      claimNumber: 'NH48372',
      poNumber: '',
      acc45Number: '',
      serviceCode: 'NS05',
      invoiceSheet: 'ONNMAR26',
      invoiceDate: '2026-03-09',
      amountInvoiced: 42.5,
      status: 'Awaiting Billing',
      notes: '',
    });

    const parsed = parseRemittanceGrid([
      ['ACC45 Ref', 'ACC Claim Number', 'Client Name', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      // Deliberately a different-looking name for the same claim — matching must ignore this.
      ['NH48372', '10035566973', 'D. Belk (as spelled on remittance)', '42.50', '42.50', ''],
    ]);
    const summary = useStore.getState().importRemittanceBatch(parsed.lines);
    expect(summary.matchedCount).toBe(1);
    expect(summary.paidInFullCount).toBe(1);
    expect(summary.heldCount).toBe(0);
    expect(summary.unmatchedCount).toBe(0);

    const updated = useStore.getState().data.invoiceLines[0];
    expect(updated.status).toBe('Billed');
    expect(updated.amountPaid).toBe(42.5);
    expect(updated.needsReview).toBeFalsy();
  });

  it('flags a short-paid/held line with needsReview + the ACC reason-code lookup', () => {
    useStore.getState().addInvoiceLine({
      patientName: 'Synthetic Patient',
      nhi: 'XYZ1234',
      claimNumber: 'AA11111',
      poNumber: '',
      acc45Number: '',
      serviceCode: 'NS01',
      invoiceSheet: 'SHEET',
      invoiceDate: '2026-03-01',
      amountInvoiced: 100,
      status: 'Awaiting Billing',
      notes: '',
    });

    const parsed = parseRemittanceGrid([
      ['ACC45 Ref', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['AA11111', '100.00', '0.00', 'NAF - not an ACC claim'],
    ]);
    const summary = useStore.getState().importRemittanceBatch(parsed.lines);
    expect(summary.heldCount).toBe(1);
    expect(summary.paidInFullCount).toBe(0);

    const updated = useStore.getState().data.invoiceLines[0];
    expect(updated.status).toBe('Remittance');
    expect(updated.needsReview).toBe(true);
    expect(updated.heldReasonCode).toBe('NAF');
    expect(updated.heldReason).toContain('not an ACC claim');
  });

  it('surfaces an unmatched remittance line instead of silently dropping it', () => {
    useStore.getState().addInvoiceLine({
      patientName: 'Someone Else',
      nhi: '',
      claimNumber: 'BB22222',
      poNumber: '',
      acc45Number: '',
      serviceCode: 'NS01',
      invoiceSheet: 'SHEET',
      invoiceDate: '2026-03-01',
      amountInvoiced: 10,
      status: 'Awaiting Billing',
      notes: '',
    });

    const parsed = parseRemittanceGrid([
      ['ACC45 Ref', 'Client Name', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['NOT-ON-FILE', 'A Stranger', '30.00', '30.00', ''],
    ]);
    const summary = useStore.getState().importRemittanceBatch(parsed.lines);
    expect(summary.matchedCount).toBe(0);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.unmatched).toEqual([{ claimNumber: 'NOT-ON-FILE', clientName: 'A Stranger', amountPaid: 30 }]);

    // The existing (unrelated) invoice line must be untouched.
    expect(useStore.getState().data.invoiceLines[0].status).toBe('Awaiting Billing');
  });
});
