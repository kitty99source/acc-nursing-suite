// ============================================================================
// Invoice-schedule (monthly per-contract billing workbook) importer.
//
// Ported/adapted from ACC-RemittanceTracker's parseInvoiceScheduleCsv /
// parseInvoiceScheduleGrid, generalised off "ClaimNumber + amount" and
// extended to match the REAL header layout confirmed against the 4 sample
// workbooks on the user's Desktop (ONNMAR26.xlsx, EXNMAR26.xlsx,
// "ST MT LTNPMAR26.xlsx", SINMAR26.xlsx — read for shape only, no row values
// committed):
//
//   ProviderID, ClaimNumber, ApprovalNumber, AccidentDate, NHI,
//   ClaimantFirstName, ClaimantSecondName, ClaimantThirdName, ClaimantSurname,
//   ClaimantDOB, ServiceDate, FacilityCode, LoadingCode, ClaimedTotalAmount,
//   ClaimedHours, ClaimedMinutes, ClaimedDistance, ScheduleLineComment,
//   ACCServiceItemCode1..5, ServiceItemCode1..5, Units, VendorsOwnInvoice.
//
// DEVIATION FROM THE SOURCE PARSER (documented, not silently papered over):
// the source suite's samples had a single "Claimant Name" / "Client Name"
// column and a single generic "Service Code" column. The real ACC schedule
// exports instead split the name across 4 columns (First/Second/Third/
// Surname) and put the billed service code in "ACCServiceItemCode1" (with
// up to 4 more numbered fallbacks for multi-code lines, which this importer
// doesn't need since only the first billed code lines are ever non-blank in
// the samples seen). There is also no ACC45/PO-number column in this export
// at all — those are captured elsewhere (Approvals) in ACCAdminsuite, not
// from the invoice schedule, so they're deliberately left blank here rather
// than guessed. Both the real-shape columns and the source suite's generic
// aliases are tried, in that order, so a hand-written CSV export with the
// generic shape still imports correctly too.
//
// The invoice-schedule filename itself IS the "invoice sheet" label
// (Billing.tsx's `invoiceSheet` field already has the hint "e.g. EXTMAR26"),
// so the caller supplies it rather than trying to infer one from the grid.
// ============================================================================

import ExcelJS from 'exceljs';
import type { InvoiceLine, ServiceCode } from '../types';
import { csvTextToGrid, findColumn, parseAmount, parseDateISO } from './billingReconcile';

export type Grid = (string | number | Date | boolean | null | undefined)[][];

export interface ParsedInvoiceScheduleLine {
  patientName: string;
  nhi: string;
  claimNumber: string;
  serviceCode: string;
  serviceDate?: string;
  amountInvoiced: number;
  invoiceSheet: string;
}

export interface ParsedInvoiceSchedule {
  lines: ParsedInvoiceScheduleLine[];
  /** True when no header row with a claim-number column + an amount column could be found. */
  unrecognised: boolean;
  /** First "VendorsOwnInvoice" / invoice-reference value seen, if any (informational only). */
  invoiceReference?: string;
}

function cellStr(v: Grid[number][number]): string {
  if (v == null) return '';
  if (v instanceof Date) return parseDateISO(v) ?? '';
  return String(v).trim();
}

export function parseInvoiceScheduleCsv(text: string, invoiceSheet: string): ParsedInvoiceSchedule {
  return parseInvoiceScheduleGrid(csvTextToGrid(text), invoiceSheet);
}

export function parseInvoiceScheduleGrid(rows: Grid, invoiceSheet: string): ParsedInvoiceSchedule {
  if (rows.length < 2) return { lines: [], unrecognised: true };

  const headers = rows[0].map(cellStr);
  const claimIdx = findColumn(headers, [
    (h) => h === 'claimnumber',
    (h) => h.includes('claimnumber'),
    (h) => h.includes('claimno'),
    (h) => h === 'claim',
    (h) => h.includes('claim'),
  ]);
  const amountIdx = findColumn(headers, [
    (h) => h.includes('claimedtotalamount'),
    (h) => h.includes('claimedtotal'),
    (h) => h.includes('totalamount'),
    (h) => h === 'total',
    (h) => h.includes('amount'),
  ]);
  if (claimIdx < 0 || amountIdx < 0) return { lines: [], unrecognised: true };

  const nhiIdx = findColumn(headers, [(h) => h === 'nhi', (h) => h.includes('nhi')]);
  const firstNameIdx = findColumn(headers, [(h) => h.includes('claimantfirstname'), (h) => h === 'firstname']);
  const secondNameIdx = findColumn(headers, [(h) => h.includes('claimantsecondname')]);
  const thirdNameIdx = findColumn(headers, [(h) => h.includes('claimantthirdname')]);
  const surnameIdx = findColumn(headers, [(h) => h.includes('claimantsurname'), (h) => h === 'surname']);
  const singleNameIdx = findColumn(headers, [
    (h) => h.includes('claimantname'),
    (h) => h.includes('clientname'),
    (h) => h.includes('patientname'),
    (h) => h === 'name',
    (h) => h.includes('name'),
  ]);
  const serviceDateIdx = findColumn(headers, [
    (h) => h.includes('servicedate'),
    (h) => h.includes('dateofservice'),
    (h) => h.includes('servicestart'),
  ]);
  const serviceCodeIdx = findColumn(headers, [
    (h) => h.includes('accserviceitemcode1'),
    (h) => h.includes('serviceitemcode1'),
    (h) => h.includes('servicecode'),
    (h) => h.includes('itemcode'),
  ]);
  const invoiceRefIdx = findColumn(headers, [
    (h) => h.includes('vendorsowninvoice'),
    (h) => h.includes('invoicenumber'),
    (h) => h.includes('invoicereference'),
    (h) => h.includes('invoiceref'),
  ]);

  const lines: ParsedInvoiceScheduleLine[] = [];
  let invoiceReference: string | undefined;
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const claimNumber = cellStr(cols[claimIdx]);
    if (!claimNumber) continue;
    if (invoiceRefIdx >= 0 && !invoiceReference) {
      const ref = cellStr(cols[invoiceRefIdx]);
      if (ref) invoiceReference = ref;
    }
    const nameParts = [firstNameIdx, secondNameIdx, thirdNameIdx, surnameIdx]
      .map((idx) => (idx >= 0 ? cellStr(cols[idx]) : ''))
      .filter(Boolean);
    const patientName = nameParts.length > 0 ? nameParts.join(' ') : singleNameIdx >= 0 ? cellStr(cols[singleNameIdx]) : '';

    lines.push({
      patientName,
      nhi: nhiIdx >= 0 ? cellStr(cols[nhiIdx]) : '',
      claimNumber,
      serviceCode: serviceCodeIdx >= 0 ? cellStr(cols[serviceCodeIdx]) : '',
      serviceDate: serviceDateIdx >= 0 ? parseDateISO(cols[serviceDateIdx] as string | number | Date) : undefined,
      amountInvoiced: parseAmount(cols[amountIdx] as string | number),
      invoiceSheet,
    });
  }
  return { lines, invoiceReference, unrecognised: lines.length === 0 };
}

/** Read an .xlsx buffer's first (or only-data) worksheet into a raw grid, preserving Date/number cells. */
export async function xlsxToGrid(buffer: ArrayBuffer | Uint8Array): Promise<Grid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = wb.worksheets.find((s) => s.rowCount > 1) ?? wb.worksheets[0];
  if (!ws) return [];
  const grid: Grid = [];
  const colCount = ws.columnCount;
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: Grid[number] = [];
    for (let c = 1; c <= colCount; c++) {
      const v = row.getCell(c).value as unknown;
      if (v == null) out.push('');
      else if (v instanceof Date) out.push(v);
      else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out.push(v);
      else if (typeof v === 'object' && 'result' in (v as Record<string, unknown>)) out.push((v as { result: unknown }).result as string | number);
      else out.push(String(v));
    }
    if (out.some((c) => c !== '' && c != null)) grid.push(out);
  }
  return grid;
}

export async function parseInvoiceScheduleXlsx(
  buffer: ArrayBuffer | Uint8Array,
  invoiceSheet: string,
): Promise<ParsedInvoiceSchedule> {
  const grid = await xlsxToGrid(buffer);
  return parseInvoiceScheduleGrid(grid, invoiceSheet);
}

/**
 * Map a parsed line to an `InvoiceLine` candidate ready for the store's upsert. ACC45/PO number are
 * left blank — the invoice schedule export doesn't carry them (see header comment above); they're
 * filled in separately from Approvals when relevant.
 */
export function toInvoiceLineCandidate(line: ParsedInvoiceScheduleLine): Omit<InvoiceLine, 'id' | 'status'> {
  return {
    patientName: line.patientName,
    nhi: line.nhi,
    claimNumber: line.claimNumber,
    poNumber: '',
    acc45Number: '',
    serviceCode: (line.serviceCode || 'NS01') as ServiceCode,
    invoiceSheet: line.invoiceSheet,
    invoiceDate: line.serviceDate ?? '',
    amountInvoiced: line.amountInvoiced,
    notes: '',
  };
}
