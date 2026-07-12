// ============================================================================
// Shared CSV/grid parsing helpers + claim-matching logic for the Billing
// module's invoice-schedule and remittance importers.
//
// Ported from ACC-RemittanceTracker's src/lib/csvImport.ts + src/lib/reconcile.ts
// and adapted to ACCAdminsuite's single-user `InvoiceLine` model (no
// Contract/TeamMember ownership layer — see .cursor/rules/rescoping-playbook.mdc
// case study #2 for why that layer was skipped entirely).
//
// CRITICAL, ACC-DOCUMENTED FINDING (kept from the source): an ACC remittance's
// claim-matching column is the short alphanumeric "ACC45 Ref" (e.g. "NH48372"),
// NOT the long numeric "ACC Claim Number" that sits next to it in the same
// export. ACCAdminsuite's `InvoiceLine.claimNumber` is that same short ACC45-
// style value (confirmed against the real monthly invoice-schedule workbooks
// on the user's Desktop — see invoiceScheduleImport.ts's header comment), so
// matching is always claim-number-to-claim-number, never by patient name:
// the two files can legitimately disagree on how a name is spelled/ordered
// for the exact same claim.
// ============================================================================

import type { InvoiceLine } from '../types';

// ---------------------------------------------------------------------------
// Low-level CSV -> grid
// ---------------------------------------------------------------------------

/** Split a single CSV line into fields, honouring double-quoted fields + "" escapes. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function splitRows(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd());
}

/** Turn raw CSV text into a `string[][]` grid (one array of cells per non-blank row). */
export function csvTextToGrid(text: string): string[][] {
  return splitRows(text)
    .filter((r) => r.trim() !== '')
    .map(parseCsvLine);
}

/** Normalise a header/label for tolerant matching: lowercase, alphanumerics only. */
export function normHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Find the first header index whose normalised name matches ANY of the given predicates in order. */
export function findColumn(headers: string[], predicates: ((h: string) => boolean)[]): number {
  const normd = headers.map(normHeader);
  for (const pred of predicates) {
    const idx = normd.findIndex((h) => pred(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Parse a money-ish string ("$1,234.50", "70.82", "") to a number; blank/invalid -> 0. */
export function parseAmount(raw: string | number | undefined): number {
  if (raw == null) return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Convert an Excel/1900-date-system serial day number (e.g. 45678) to an ISO date. Excel's epoch is
 * 1899-12-30 (it includes Lotus 1-2-3's fictitious 1900-02-29 leap-day bug, which every spreadsheet
 * app still replicates), so day 1 = 1900-01-01 in the UI but the correct anchor to compute from is
 * 1899-12-30 in UTC millis.
 */
export function excelSerialToISO(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial <= 0) return undefined;
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = days between 1899-12-30 and 1970-01-01
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/**
 * Normalise a date cell to ISO (YYYY-MM-DD). Accepts a JS `Date` (ExcelJS already resolves typed
 * date cells to these), dd/mm/yyyy (NZ), ISO text, and a bare Excel date serial number. Day-first is
 * assumed for slash dates because every ACC/NZ sample uses dd/mm/yyyy.
 */
export function parseDateISO(raw: string | number | Date | undefined): string | undefined {
  if (raw == null) return undefined;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return undefined;
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number') {
    return raw >= 20000 && raw <= 80000 ? excelSerialToISO(raw) : undefined;
  }
  const s = raw.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/.exec(s);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    const dd = d.padStart(2, '0');
    const mm = mo.padStart(2, '0');
    const iso = `${y}-${mm}-${dd}`;
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : undefined;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n >= 20000 && n <= 80000) return excelSerialToISO(n);
  }
  return undefined;
}

/** Canonical claim-number key for matching (trim + upper-case). Never derived from a patient name. */
export function claimKey(claim: string | undefined): string {
  return (claim ?? '').trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Invoice <-> remittance matching (pure — unit-testable with synthetic fixtures)
// ---------------------------------------------------------------------------

/** Group invoice lines by their canonical claim key for fast remittance matching. */
export function buildInvoiceClaimIndex(lines: InvoiceLine[]): Map<string, InvoiceLine[]> {
  const index = new Map<string, InvoiceLine[]>();
  for (const line of lines) {
    const key = claimKey(line.claimNumber);
    if (!key) continue;
    const bucket = index.get(key);
    if (bucket) bucket.push(line);
    else index.set(key, [line]);
  }
  return index;
}

/**
 * Resolve which invoice line a remittance line belongs to. Prefers an invoice line whose service
 * code also matches (when both carry one) and, among those, one that isn't already fully paid —
 * so a second remittance batch for the same claim doesn't keep re-matching an already-settled line
 * when there's an outstanding one for the same claim/code. Falls back to the first line for that
 * claim when nothing else discriminates. Never matches by name.
 */
export function matchRemittanceToInvoice(
  rem: { claimNumber: string; serviceCode?: string },
  index: Map<string, InvoiceLine[]>,
): InvoiceLine | undefined {
  const bucket = index.get(claimKey(rem.claimNumber));
  if (!bucket || bucket.length === 0) return undefined;
  const candidates = rem.serviceCode
    ? bucket.filter((l) => l.serviceCode.trim().toUpperCase() === rem.serviceCode!.trim().toUpperCase())
    : bucket;
  const pool = candidates.length > 0 ? candidates : bucket;
  const outstanding = pool.find((l) => (l.amountPaid ?? 0) + 0.005 < l.amountInvoiced);
  return outstanding ?? pool[0];
}

// ---------------------------------------------------------------------------
// Dashboard-facing aggregation
// ---------------------------------------------------------------------------

export interface RemittanceImportSummary {
  /** Remittance lines that matched an existing invoice line. */
  matchedCount: number;
  /** Matched lines that are now paid in full (status moved to 'Billed'). */
  paidInFullCount: number;
  /** Matched lines that are short-paid, unpaid or carry a held/decline comment. */
  heldCount: number;
  /** Remittance lines whose claim number didn't match ANY existing invoice line — surfaced, never dropped. */
  unmatchedCount: number;
  /** The unmatched lines themselves, so the UI can show exactly which claims need a manual look. */
  unmatched: { claimNumber: string; clientName?: string; amountPaid: number }[];
}

export interface BillingReconcileSummary {
  invoicedTotal: number;
  paidTotal: number;
  outstandingTotal: number;
  needsReviewCount: number;
}

/** Whole-ledger totals for stat cards (Billing module + optionally the Dashboard). */
export function summariseInvoiceLines(lines: InvoiceLine[]): BillingReconcileSummary {
  let invoicedTotal = 0;
  let paidTotal = 0;
  let needsReviewCount = 0;
  for (const l of lines) {
    invoicedTotal += l.amountInvoiced || 0;
    paidTotal += l.amountPaid || 0;
    if (l.needsReview) needsReviewCount += 1;
  }
  return { invoicedTotal, paidTotal, outstandingTotal: invoicedTotal - paidTotal, needsReviewCount };
}
