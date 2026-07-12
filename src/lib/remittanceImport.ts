// ============================================================================
// ACC remittance importer — cross-checks a remittance export against the
// existing Billing ledger.
//
// Ported from ACC-RemittanceTracker's src/lib/csvImport.ts
// (parseRemittanceCsv/parseRemittanceGrid), which itself documents two real
// bugs found by cross-checking real ACC exports against each other (both
// preserved here, unchanged, since they're genuine quirks of ACC's own export
// format, not specific to the source suite):
//
//   1. The claim-matching column is the short "ACC45 Ref" (e.g. "NH48372"),
//      NOT the adjacent long-numeric "ACC Claim Number" column. The ACC45-Ref
//      -style column is tried first; the generic claim column is a fallback.
//   2. A remittance line's free-text Comments/Reason cell can itself contain
//      words like "claim" and "paid" (e.g. "line paid but use amended claim
//      no. for future billing…"), which can be misdetected as a new block
//      header if only header-name heuristics are used. Header rows are
//      further disqualified by containing a long free-text cell or a literal
//      date/amount, since a genuine header cell never does.
// ============================================================================

import ExcelJS from 'exceljs';
import { parseReason } from './reasonCodes';
import { csvTextToGrid, findColumn, normHeader, parseAmount, parseDateISO } from './billingReconcile';

export interface ParsedRemittanceLine {
  claimNumber: string;
  accClaimNumber?: string;
  clientName?: string;
  serviceDate?: string;
  serviceCode?: string;
  amountInvoiced?: number;
  amountPaid: number;
  reasonCode?: string;
  reasonText?: string;
  /** Not paid in full: $0 paid, paid < invoiced, or a reason/comment was present. */
  lineNeedsReview: boolean;
}

export interface ParsedRemittanceSheet {
  lines: ParsedRemittanceLine[];
  /** Rows in a block with no claim-number column (coarse summary block) — counted, not matched. */
  summaryOnlyLineCount: number;
  unrecognised: boolean;
}

type Cell = string | number | boolean | Date | null | undefined;
type Grid = Cell[][];

function cellStr(v: Cell): string {
  if (v == null) return '';
  if (v instanceof Date) return parseDateISO(v) ?? '';
  return String(v).trim();
}

/**
 * A row is a "header row" if it names at least two of the columns we key a detail block on, and
 * doesn't itself look like a data row (a long free-text cell, or a literal date/amount cell).
 */
function looksLikeDetailHeader(cols: string[]): boolean {
  const hasLongFreeTextCell = cols.some((c) => c.trim().length > 40);
  const hasDateOrAmountCell = cols.some((c) => {
    const s = c.trim();
    if (!s) return false;
    return /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(s) || /^\$?-?[\d,]*\.\d{2}$/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s);
  });
  if (hasLongFreeTextCell || hasDateOrAmountCell) return false;

  const normd = cols.map(normHeader);
  const hasClaim = normd.some((h) => h.includes('acc45') || h.includes('claim'));
  const hasPaid = normd.some((h) => h.includes('paid') || h.includes('remit'));
  const hasReason = normd.some((h) => h.includes('comment') || h.includes('reason'));
  const hasInvoiced = normd.some((h) => h.includes('amountinvoiced') || h.includes('invoiced'));
  const score = [hasClaim, hasPaid, hasReason, hasInvoiced].filter(Boolean).length;
  return hasClaim && score >= 2;
}

/** Detect the ACC45-Ref-style claim column FIRST, then fall back to a generic claim column. */
function resolveClaimColumn(headers: string[]): { claimIdx: number; accClaimIdx: number } {
  const acc45Idx = findColumn(headers, [
    (h) => h.includes('acc45ref'),
    (h) => h.includes('acc45'),
    (h) => h.includes('45ref'),
  ]);
  const accClaimIdx = findColumn(headers, [(h) => h.includes('accclaimnumber'), (h) => h === 'accclaim']);
  if (acc45Idx >= 0) return { claimIdx: acc45Idx, accClaimIdx };
  const genericClaim = findColumn(headers, [
    (h) => h.includes('claimnumber'),
    (h) => h.includes('claimno'),
    (h) => h === 'claim',
    (h) => h.includes('claim'),
  ]);
  return { claimIdx: genericClaim, accClaimIdx: genericClaim === accClaimIdx ? -1 : accClaimIdx };
}

export function parseRemittanceCsv(text: string): ParsedRemittanceSheet {
  return parseRemittanceGrid(csvTextToGrid(text));
}

export function parseRemittanceGrid(allRows: Grid): ParsedRemittanceSheet {
  const lines: ParsedRemittanceLine[] = [];
  let summaryOnlyLineCount = 0;
  let sawAnyDetailBlock = false;

  let i = 0;
  while (i < allRows.length) {
    const cols = allRows[i].map(cellStr);
    if (cols.length === 0 || cols.every((c) => c === '')) {
      i++;
      continue;
    }
    if (looksLikeDetailHeader(cols)) {
      sawAnyDetailBlock = true;
      const headers = cols;
      const { claimIdx, accClaimIdx } = resolveClaimColumn(headers);
      const clientNameIdx = findColumn(headers, [(h) => h.includes('clientname'), (h) => h === 'client', (h) => h.includes('name')]);
      const serviceDateIdx = findColumn(headers, [(h) => h.includes('servicedate')]);
      const serviceCodeIdx = findColumn(headers, [(h) => h.includes('servicecode'), (h) => h.includes('itemcode')]);
      const amountInvoicedIdx = findColumn(headers, [(h) => h.includes('amountinvoiced'), (h) => h.includes('invoiced')]);
      const paidIdx = findColumn(headers, [
        (h) => h.includes('paidgst'),
        (h) => h.includes('paid'),
        (h) => h.includes('remit'),
        (h) => h.includes('amountpaid'),
      ]);
      const reasonIdx = findColumn(headers, [(h) => h.includes('comment'), (h) => h.includes('reason')]);

      i++;
      const hasClaimColumn = claimIdx >= 0;
      const minPlausibleCols = Math.max(2, headers.length - 2);
      while (i < allRows.length) {
        const dataColsRaw = allRows[i];
        const dataCols = dataColsRaw.map(cellStr);
        if (dataCols.length === 0 || dataCols.every((c) => c === '')) break;
        if (looksLikeDetailHeader(dataCols)) break; // next block starts
        i++;

        if (dataCols.length < minPlausibleCols) continue; // trailing free-text footnote, not a real row

        if (!hasClaimColumn) {
          summaryOnlyLineCount++;
          continue;
        }
        const claimNumber = dataCols[claimIdx] ?? '';
        const amountPaid = paidIdx >= 0 ? parseAmount(dataCols[paidIdx]) : 0;
        const amountInvoiced = amountInvoicedIdx >= 0 ? parseAmount(dataCols[amountInvoicedIdx]) : undefined;
        const { reasonCode, reasonText } = parseReason(reasonIdx >= 0 ? dataCols[reasonIdx] : undefined);
        if (!claimNumber) {
          const clientName = clientNameIdx >= 0 ? dataCols[clientNameIdx] : '';
          if (!reasonText && !clientName && amountPaid <= 0 && !amountInvoiced) {
            summaryOnlyLineCount++;
            continue;
          }
        }
        const shortPaid = amountInvoiced != null && amountInvoiced > 0 ? amountPaid + 0.005 < amountInvoiced : amountPaid <= 0;
        const lineNeedsReview = shortPaid || amountPaid <= 0 || !!reasonText;
        lines.push({
          claimNumber,
          accClaimNumber: accClaimIdx >= 0 ? dataCols[accClaimIdx] || undefined : undefined,
          clientName: clientNameIdx >= 0 ? dataCols[clientNameIdx] || undefined : undefined,
          serviceDate: serviceDateIdx >= 0 ? parseDateISO(dataColsRaw[serviceDateIdx] as string | number | Date) : undefined,
          serviceCode: serviceCodeIdx >= 0 ? dataCols[serviceCodeIdx] || undefined : undefined,
          amountInvoiced,
          amountPaid,
          reasonCode,
          reasonText,
          lineNeedsReview,
        });
      }
      continue;
    }
    i++;
  }

  if (lines.length === 0 && summaryOnlyLineCount === 0 && !sawAnyDetailBlock) {
    const flat = parseFlatRemittanceGrid(allRows);
    if (flat) return { lines: flat, summaryOnlyLineCount: 0, unrecognised: flat.length === 0 };
  }

  return { lines, summaryOnlyLineCount, unrecognised: lines.length === 0 && summaryOnlyLineCount === 0 };
}

function parseFlatRemittanceGrid(rows: Grid): ParsedRemittanceLine[] | null {
  if (rows.length < 2) return null;
  const headers = rows[0].map(cellStr);
  const { claimIdx, accClaimIdx } = resolveClaimColumn(headers);
  const paidIdx = findColumn(headers, [(h) => h.includes('paid'), (h) => h.includes('remit'), (h) => h.includes('amountpaid')]);
  if (claimIdx < 0 || paidIdx < 0) return null;

  const amountInvoicedIdx = findColumn(headers, [(h) => h.includes('amountinvoiced'), (h) => h.includes('invoiced')]);
  const reasonIdx = findColumn(headers, [(h) => h.includes('comment'), (h) => h.includes('reason')]);
  const clientNameIdx = findColumn(headers, [(h) => h.includes('clientname'), (h) => h.includes('name')]);

  const lines: ParsedRemittanceLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].map(cellStr);
    const claimNumber = cols[claimIdx] ?? '';
    if (!claimNumber) continue;
    const amountPaid = parseAmount(cols[paidIdx]);
    const amountInvoiced = amountInvoicedIdx >= 0 ? parseAmount(cols[amountInvoicedIdx]) : undefined;
    const { reasonCode, reasonText } = parseReason(reasonIdx >= 0 ? cols[reasonIdx] : undefined);
    const shortPaid = amountInvoiced != null && amountInvoiced > 0 ? amountPaid + 0.005 < amountInvoiced : amountPaid <= 0;
    lines.push({
      claimNumber,
      accClaimNumber: accClaimIdx >= 0 ? cols[accClaimIdx] || undefined : undefined,
      clientName: clientNameIdx >= 0 ? cols[clientNameIdx] || undefined : undefined,
      amountInvoiced,
      amountPaid,
      reasonCode,
      reasonText,
      lineNeedsReview: shortPaid || amountPaid <= 0 || !!reasonText,
    });
  }
  return lines;
}

/** Read an .xlsx buffer's first worksheet into a grid (reuses the same cell-shape ExcelJS already gives us). */
export async function xlsxToRemittanceGrid(buffer: ArrayBuffer | Uint8Array): Promise<Grid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const ws = wb.worksheets[0];
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
      else out.push(String(v));
    }
    grid.push(out);
  }
  return grid;
}

export async function parseRemittanceXlsx(buffer: ArrayBuffer | Uint8Array): Promise<ParsedRemittanceSheet> {
  const grid = await xlsxToRemittanceGrid(buffer);
  return parseRemittanceGrid(grid);
}
