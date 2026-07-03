import ExcelJS from 'exceljs';
import type {
  AppData,
  Approval,
  ApprovalServiceCode,
  Claim,
  ComplexCase,
  ComplexCaseStatus,
  CustomSheet,
  Decline,
  DeclineStatus,
  InvoiceLine,
  InvoiceStatus,
  Patient,
  ServiceCode,
} from '../types';
import { uid } from './format';

// ============================================================================
// Excel (.xlsx) importer — the round-trip companion to lib/excel.ts.
//
// Reads a workbook produced by the app (or the original toolkit) and converts
// it back into the app's JSON data model. It is deliberately tolerant:
//   * Header rows are DETECTED (not assumed) per sheet, so title/description
//     rows above the header don't matter.
//   * Any column that isn't a recognised field is preserved into a per-record
//     `customFields` bag so nothing is lost.
//   * Any sheet whose name isn't recognised is captured as a generic
//     `CustomSheet` (headers + rows).
//
// Everything here is pure/offline: it only touches ExcelJS and never the
// network. The merge step (`mergeImportIntoData`) is a pure function so it can
// be unit-tested and driven from the store.
// ============================================================================

export type ImportMode = 'merge' | 'replace';

export interface ImportSheetInfo {
  /** The worksheet name as it appeared in the file. */
  sheet: string;
  /** The canonical section it was recognised as, or null if unrecognised. */
  recognizedAs: string | null;
  /** Number of data rows parsed. */
  rows: number;
  /** Headers that weren't recognised fields (kept as custom fields / columns). */
  newColumns: string[];
}

export interface ImportSummary {
  counts: {
    patients: number;
    claims: number;
    invoiceLines: number;
    approvals: number;
    complexCases: number;
    declines: number;
    customSheets: number;
  };
  sheets: ImportSheetInfo[];
  /** Names of sheets imported as generic custom tables. */
  unrecognizedSheets: string[];
  /** Recognised sheet -> list of extra columns kept as custom fields. */
  newColumnsBySheet: Record<string, string[]>;
  /** Non-fatal problems encountered while parsing. */
  warnings: string[];
}

export interface ImportResult {
  patients: Patient[];
  claims: Claim[];
  invoiceLines: InvoiceLine[];
  approvals: Approval[];
  complexCases: ComplexCase[];
  declines: Decline[];
  customSheets: CustomSheet[];
  summary: ImportSummary;
}

// ---------------------------------------------------------------------------
// Cell value helpers
// ---------------------------------------------------------------------------

/** Normalise a header/label for tolerant matching: lowercase, alphanumerics only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Best-effort plain-text extraction from an ExcelJS cell value (any shape). */
function rawText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return excelDateToISO(value);
  if (typeof value === 'object') {
    const o = value as unknown as Record<string, unknown>;
    if (Array.isArray((o as { richText?: unknown }).richText)) {
      return (o as { richText: { text?: string }[] }).richText.map((t) => t.text ?? '').join('');
    }
    if ('result' in o) return rawText(o.result as ExcelJS.CellValue);
    if ('text' in o) return String(o.text ?? '');
    if ('hyperlink' in o) return String(o.text ?? o.hyperlink ?? '');
    if ('formula' in o) return String((o as { formula?: unknown }).formula ?? '');
  }
  return String(value);
}

function cellText(cell: ExcelJS.Cell): string {
  return rawText(cell.value).trim();
}

/**
 * Convert an ExcelJS Date to an ISO YYYY-MM-DD string, robust to the timezone
 * drift ExcelJS can introduce (dates are stored as tz-less serials). We round
 * to the nearest whole UTC day, which recovers the intended calendar day
 * whether the Date came back as UTC-midnight or local-midnight.
 */
function excelDateToISO(d: Date): string {
  const rounded = Math.round(d.getTime() / 86_400_000) * 86_400_000;
  return new Date(rounded).toISOString().slice(0, 10);
}

/** Parse a cell into an ISO date string, or '' when empty/invalid. */
function readDate(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null || v === '') return '';
  if (v instanceof Date) return excelDateToISO(v);
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (r instanceof Date) return excelDateToISO(r);
  }
  if (typeof v === 'number') {
    // Excel serial date (days since 1899-12-30). Only treat plausible ranges.
    if (v > 20_000 && v < 80_000) {
      const ms = Math.round((v - 25_569) * 86_400_000);
      return new Date(ms).toISOString().slice(0, 10);
    }
  }
  const s = rawText(v).trim();
  if (!s) return '';
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString().slice(0, 10);
  return '';
}

/** Parse a cell into a number, or undefined when empty/invalid. */
function readNumber(cell: ExcelJS.Cell): number | undefined {
  const v = cell.value;
  if (v == null || v === '') return undefined;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    if (typeof r === 'number') return r;
  }
  const s = rawText(v).replace(/[^0-9.\-]/g, '');
  if (!s) return undefined;
  const n = Number(s);
  return Number.isNaN(n) ? undefined : n;
}

/** Parse a cell into a trimmed string (large numbers/codes preserved as text). */
function readString(cell: ExcelJS.Cell): string {
  return cellText(cell);
}

/** A cell is "not a real header" if it's blank, very long, or contains '='. */
function isJunkHeader(text: string): boolean {
  if (!text) return true;
  if (text.length > 40) return true;
  if (text.includes('=')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Sheet field definitions
// ---------------------------------------------------------------------------

type FieldType = 'string' | 'number' | 'date';

interface FieldDef {
  /** Canonical label(s) that map to this field (matched normalised). */
  labels: string[];
  field: string;
  type: FieldType;
}

interface SheetDef {
  /** Canonical section id used in the summary. */
  section: string;
  /** Normalised worksheet-name aliases that select this definition. */
  nameAliases: string[];
  fields: FieldDef[];
  /** Recognised-but-ignored headers (computed columns) — not kept as custom. */
  ignore: string[];
}

const BILLING_DEF: SheetDef = {
  section: 'Billing Log',
  nameAliases: ['billinglog', 'billing'],
  fields: [
    { labels: ['Patient Name'], field: 'patientName', type: 'string' },
    { labels: ['Patient NHI', 'NHI'], field: 'nhi', type: 'string' },
    { labels: ['Claim Number'], field: 'claimNumber', type: 'string' },
    { labels: ['Purchase Order Number', 'PO Number'], field: 'poNumber', type: 'string' },
    { labels: ['ACC45 Number'], field: 'acc45Number', type: 'string' },
    { labels: ['Service Code'], field: 'serviceCode', type: 'string' },
    { labels: ['Invoice Sheet'], field: 'invoiceSheet', type: 'string' },
    { labels: ['Invoice Date'], field: 'invoiceDate', type: 'date' },
    { labels: ['Amount Invoiced'], field: 'amountInvoiced', type: 'number' },
    { labels: ['Date Paid'], field: 'datePaid', type: 'date' },
    { labels: ['Amount Paid'], field: 'amountPaid', type: 'number' },
    { labels: ['Status'], field: 'status', type: 'string' },
    { labels: ['Notes'], field: 'notes', type: 'string' },
  ],
  ignore: [],
};

const APPROVALS_DEF: SheetDef = {
  section: 'NS04-NS05 Approvals',
  nameAliases: ['ns04ns05approvals', 'approvals'],
  fields: [
    { labels: ['Patient Name'], field: 'patientName', type: 'string' },
    { labels: ['Patient NHI', 'NHI'], field: 'nhi', type: 'string' },
    { labels: ['Patient DOB', 'DOB'], field: 'dob', type: 'date' },
    { labels: ['Claim Number'], field: 'claimNumber', type: 'string' },
    { labels: ['ACC45 Number'], field: 'acc45Number', type: 'string' },
    { labels: ['Service Code'], field: 'serviceCode', type: 'string' },
    { labels: ['Approval Start Date'], field: 'approvalStartDate', type: 'date' },
    {
      labels: ['Approval End Date / PO Expiry', 'Approval End Date', 'PO Expiry'],
      field: 'approvalEndDate',
      type: 'date',
    },
    {
      labels: ['Approved Hours/Consults', 'Approved Hours', 'Approved Consults'],
      field: 'approvedHoursOrConsults',
      type: 'string',
    },
    { labels: ['ACC Emailed Renewal Date'], field: 'accEmailedRenewalDate', type: 'date' },
    { labels: ['PO Number'], field: 'poNumber', type: 'string' },
    { labels: ['Notes'], field: 'notes', type: 'string' },
  ],
  // The app recomputes these from the approval dates, so ignore them on import.
  ignore: ['Days Until Expiry', 'Status'],
};

const COMPLEX_DEF: SheetDef = {
  section: 'Complex Cases',
  nameAliases: ['complexcases', 'complex'],
  fields: [
    { labels: ['Patient Name'], field: 'patientName', type: 'string' },
    { labels: ['Claim Number'], field: 'claimNumber', type: 'string' },
    { labels: ['Date Logged'], field: 'dateLogged', type: 'date' },
    { labels: ["What's Unusual", 'Whats Unusual'], field: 'whatsUnusual', type: 'string' },
    { labels: ['Decision Made'], field: 'decisionMade', type: 'string' },
    { labels: ['Decided By'], field: 'decidedBy', type: 'string' },
    { labels: ['Date Decided'], field: 'dateDecided', type: 'date' },
    { labels: ['Follow-up Needed', 'Follow up Needed'], field: 'followUpNeeded', type: 'string' },
    { labels: ['Next Review Date'], field: 'nextReviewDate', type: 'date' },
    { labels: ['Status'], field: 'status', type: 'string' },
    { labels: ['Notes'], field: 'notes', type: 'string' },
  ],
  ignore: [],
};

const DECLINE_DEF: SheetDef = {
  section: 'Decline Tracker',
  nameAliases: ['declinetracker', 'declines', 'decline'],
  fields: [
    { labels: ['Patient Name'], field: 'patientName', type: 'string' },
    { labels: ['Claim Number'], field: 'claimNumber', type: 'string' },
    { labels: ['Decline Received Date'], field: 'declineReceivedDate', type: 'date' },
    { labels: ['Service/Period Declined', 'Service Period Declined'], field: 'servicePeriodDeclined', type: 'string' },
    { labels: ['Reason for Decline', 'Reason'], field: 'reason', type: 'string' },
    { labels: ['Date Nurse Emailed'], field: 'dateNurseEmailed', type: 'date' },
    { labels: ['Date Resubmission Requested'], field: 'dateResubmissionRequested', type: 'date' },
    { labels: ['Outcome'], field: 'outcome', type: 'string' },
    { labels: ['Date Outcome Received'], field: 'dateOutcomeReceived', type: 'date' },
    { labels: ['Status'], field: 'status', type: 'string' },
    { labels: ['Notes'], field: 'notes', type: 'string' },
  ],
  ignore: [],
};

const SHEET_DEFS = [BILLING_DEF, APPROVALS_DEF, COMPLEX_DEF, DECLINE_DEF];

// Sheets that are always skipped (cover page and computed summary).
const SKIP_SHEETS = new Set(['starthere', 'yearsummary']);

const INVOICE_STATUSES: InvoiceStatus[] = ['Awaiting Billing', 'Billed', 'Remittance'];
const COMPLEX_STATUSES: ComplexCaseStatus[] = ['Open', 'Monitoring', 'Resolved'];
const DECLINE_STATUSES: DeclineStatus[] = [
  'Awaiting nursing docs for resubmission',
  'Awaiting response from ACC',
  'Accepted',
  'Declined again',
];

function findSheetDef(worksheetName: string): SheetDef | null {
  const n = norm(worksheetName);
  for (const def of SHEET_DEFS) {
    if (def.nameAliases.some((a) => n === a || n.includes(a))) return def;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Header detection + column mapping
// ---------------------------------------------------------------------------

interface ColumnMapEntry {
  col: number;
  header: string; // original text
  kind: 'field' | 'ignore' | 'custom';
  field?: string;
  type?: FieldType;
}

/**
 * Scan the first ~8 rows and pick the one that best matches the sheet's
 * expected header labels. Returns the 1-based row index (defaults to 1).
 */
function detectHeaderRow(ws: ExcelJS.Worksheet, def: SheetDef): number {
  const expected = new Set<string>();
  for (const f of def.fields) for (const l of f.labels) expected.add(norm(l));
  for (const l of def.ignore) expected.add(norm(l));

  const maxScan = Math.min(8, ws.rowCount || 8);
  let bestRow = 1;
  let bestScore = -1;
  for (let r = 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    let score = 0;
    const colCount = Math.max(ws.columnCount, row.cellCount, 1);
    for (let c = 1; c <= colCount; c += 1) {
      const text = cellText(row.getCell(c));
      if (isJunkHeader(text)) continue;
      if (expected.has(norm(text))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
    }
  }
  return bestRow;
}

function buildColumnMap(ws: ExcelJS.Worksheet, def: SheetDef, headerRow: number): ColumnMapEntry[] {
  const byLabel = new Map<string, FieldDef>();
  for (const f of def.fields) for (const l of f.labels) byLabel.set(norm(l), f);
  const ignore = new Set(def.ignore.map(norm));

  const row = ws.getRow(headerRow);
  const colCount = Math.max(ws.columnCount, row.cellCount, 1);
  const map: ColumnMapEntry[] = [];
  const usedFields = new Set<string>();

  for (let c = 1; c <= colCount; c += 1) {
    const header = cellText(row.getCell(c));
    if (isJunkHeader(header)) continue; // instructional / blank cells aren't columns
    const key = norm(header);
    const field = byLabel.get(key);
    if (field && !usedFields.has(field.field)) {
      usedFields.add(field.field);
      map.push({ col: c, header, kind: 'field', field: field.field, type: field.type });
    } else if (ignore.has(key)) {
      map.push({ col: c, header, kind: 'ignore' });
    } else {
      map.push({ col: c, header, kind: 'custom' });
    }
  }
  return map;
}

interface ParsedRow {
  values: Record<string, string | number | undefined>;
  customFields: Record<string, string>;
  empty: boolean;
}

function parseRow(ws: ExcelJS.Worksheet, rowIdx: number, colMap: ColumnMapEntry[]): ParsedRow {
  const row = ws.getRow(rowIdx);
  const values: Record<string, string | number | undefined> = {};
  const customFields: Record<string, string> = {};
  let empty = true;

  for (const cm of colMap) {
    const cell = row.getCell(cm.col);
    if (cm.kind === 'ignore') continue;
    if (cm.kind === 'custom') {
      const s = readString(cell);
      if (s) {
        customFields[cm.header] = s;
        empty = false;
      }
      continue;
    }
    // recognised field
    if (cm.type === 'date') {
      const d = readDate(cell);
      values[cm.field!] = d;
      if (d) empty = false;
    } else if (cm.type === 'number') {
      const n = readNumber(cell);
      values[cm.field!] = n;
      if (n != null) empty = false;
    } else {
      const s = readString(cell);
      values[cm.field!] = s;
      if (s) empty = false;
    }
  }
  return { values, customFields, empty };
}

function str(v: string | number | undefined): string {
  if (v == null) return '';
  return String(v);
}

function withCustom<T extends object>(base: T, customFields: Record<string, string>): T {
  return Object.keys(customFields).length > 0 ? { ...base, customFields } : base;
}

// ---------------------------------------------------------------------------
// Intra-file relational reconciliation (patients + claims)
// ---------------------------------------------------------------------------

class EntityReconciler {
  patients: Patient[] = [];
  claims: Claim[] = [];
  private patientByNhi = new Map<string, Patient>();
  private patientByName = new Map<string, Patient>();
  private claimByNumber = new Map<string, Claim>();

  /** Upsert a patient by NHI (preferred) then name. Returns its id (or ''). */
  upsertPatient(name: string, nhi: string, dob?: string): string {
    const cleanName = name.trim();
    const cleanNhi = nhi.trim();
    if (!cleanName && !cleanNhi) return '';

    let patient: Patient | undefined;
    if (cleanNhi) patient = this.patientByNhi.get(norm(cleanNhi));
    if (!patient && cleanName) patient = this.patientByName.get(norm(cleanName));

    if (patient) {
      if (!patient.nhi && cleanNhi) patient.nhi = cleanNhi;
      if ((!patient.dob || patient.dob === '') && dob) patient.dob = dob;
      if (!patient.name && cleanName) patient.name = cleanName;
    } else {
      patient = { id: uid('p'), name: cleanName, nhi: cleanNhi, dob: dob ?? '', notes: '' };
      this.patients.push(patient);
    }
    if (cleanNhi) this.patientByNhi.set(norm(cleanNhi), patient);
    if (cleanName) this.patientByName.set(norm(cleanName), patient);
    return patient.id;
  }

  /** Upsert a claim by claim number, attaching relations. Returns its id (or ''). */
  upsertClaim(claimNumber: string, patientId: string, acc45?: string, poNumber?: string): string {
    const cn = claimNumber.trim();
    if (!cn) return '';
    let claim = this.claimByNumber.get(norm(cn));
    if (claim) {
      if (!claim.patientId && patientId) claim.patientId = patientId;
      if (!claim.acc45Number && acc45) claim.acc45Number = acc45;
      if (!claim.poNumber && poNumber) claim.poNumber = poNumber;
    } else {
      claim = {
        id: uid('c'),
        patientId,
        acc45Number: acc45 ?? '',
        claimNumber: cn,
        poNumber: poNumber ?? '',
        injuryDescription: '',
        type: 'original',
        status: 'active',
        day1Date: '',
      };
      this.claims.push(claim);
      this.claimByNumber.set(norm(cn), claim);
    }
    return claim.id;
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export async function parseWorkbook(buffer: ArrayBuffer | Uint8Array): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS accepts ArrayBuffer / Buffer for xlsx.load.
  await wb.xlsx.load(buffer as ArrayBuffer);

  const reconciler = new EntityReconciler();
  const invoiceLines: InvoiceLine[] = [];
  const approvals: Approval[] = [];
  const complexCases: ComplexCase[] = [];
  const declines: Decline[] = [];
  const customSheets: CustomSheet[] = [];

  const sheets: ImportSheetInfo[] = [];
  const unrecognizedSheets: string[] = [];
  const newColumnsBySheet: Record<string, string[]> = {};
  const warnings: string[] = [];

  for (const ws of wb.worksheets) {
    const name = ws.name ?? '';
    if (SKIP_SHEETS.has(norm(name))) continue;

    const def = findSheetDef(name);
    if (!def) {
      const custom = parseCustomSheet(ws);
      if (custom && custom.rows.length > 0) {
        customSheets.push(custom);
        unrecognizedSheets.push(name);
        sheets.push({ sheet: name, recognizedAs: null, rows: custom.rows.length, newColumns: custom.headers });
      }
      continue;
    }

    const headerRow = detectHeaderRow(ws, def);
    const colMap = buildColumnMap(ws, def, headerRow);
    const extraCols = colMap.filter((c) => c.kind === 'custom').map((c) => c.header);
    if (extraCols.length) newColumnsBySheet[def.section] = extraCols;

    let count = 0;
    const lastRow = ws.rowCount;
    for (let r = headerRow + 1; r <= lastRow; r += 1) {
      const parsed = parseRow(ws, r, colMap);
      if (parsed.empty) continue;
      const created = ingestRow(def, parsed, reconciler, {
        invoiceLines,
        approvals,
        complexCases,
        declines,
      });
      if (created) count += 1;
    }
    sheets.push({ sheet: name, recognizedAs: def.section, rows: count, newColumns: extraCols });
  }

  const result: ImportResult = {
    patients: reconciler.patients,
    claims: reconciler.claims,
    invoiceLines,
    approvals,
    complexCases,
    declines,
    customSheets,
    summary: {
      counts: {
        patients: reconciler.patients.length,
        claims: reconciler.claims.length,
        invoiceLines: invoiceLines.length,
        approvals: approvals.length,
        complexCases: complexCases.length,
        declines: declines.length,
        customSheets: customSheets.length,
      },
      sheets,
      unrecognizedSheets,
      newColumnsBySheet,
      warnings,
    },
  };
  return result;
}

interface RowSinks {
  invoiceLines: InvoiceLine[];
  approvals: Approval[];
  complexCases: ComplexCase[];
  declines: Decline[];
}

function ingestRow(
  def: SheetDef,
  parsed: ParsedRow,
  reconciler: EntityReconciler,
  sinks: RowSinks,
): boolean {
  const v = parsed.values;
  if (def.section === 'Billing Log') {
    const patientName = str(v.patientName);
    const nhi = str(v.nhi);
    // Populate the Patients module from billing rows too.
    reconciler.upsertPatient(patientName, nhi);
    const line: InvoiceLine = {
      id: uid('inv'),
      patientName,
      nhi,
      claimNumber: str(v.claimNumber),
      poNumber: str(v.poNumber),
      acc45Number: str(v.acc45Number),
      serviceCode: (str(v.serviceCode) || 'NS01') as ServiceCode,
      invoiceSheet: str(v.invoiceSheet),
      invoiceDate: str(v.invoiceDate),
      amountInvoiced: typeof v.amountInvoiced === 'number' ? v.amountInvoiced : 0,
      datePaid: str(v.datePaid) || undefined,
      amountPaid: typeof v.amountPaid === 'number' ? v.amountPaid : undefined,
      status: coerceEnum(str(v.status), INVOICE_STATUSES, 'Awaiting Billing'),
      notes: str(v.notes),
    };
    sinks.invoiceLines.push(withCustom(line, parsed.customFields));
    return true;
  }

  if (def.section === 'NS04-NS05 Approvals') {
    const patientName = str(v.patientName);
    const nhi = str(v.nhi);
    const dob = str(v.dob);
    const claimNumber = str(v.claimNumber);
    const acc45 = str(v.acc45Number);
    const poNumber = str(v.poNumber);
    const patientId = reconciler.upsertPatient(patientName, nhi, dob || undefined);
    const claimId = reconciler.upsertClaim(claimNumber, patientId, acc45 || undefined, poNumber || undefined);

    // "Approved Hours/Consults" may be free text ("6 hours p/month") or a
    // number. Keep the numeric part on the typed field (so dashboard maths
    // still works) and preserve the full text in customFields when it isn't
    // purely numeric, so nothing is lost.
    const rawApproved = str(v.approvedHoursOrConsults);
    const numeric = parseFloat(rawApproved.replace(/[^0-9.\-]/g, ''));
    const approvedHoursOrConsults = Number.isNaN(numeric) ? 0 : numeric;
    const customFields = { ...parsed.customFields };
    if (rawApproved && !/^\s*[0-9.]+\s*$/.test(rawApproved)) {
      customFields['Approved Hours/Consults'] = rawApproved;
    }

    const approval: Approval = {
      id: uid('ap'),
      patientId,
      claimId,
      serviceCode: coerceEnum(str(v.serviceCode), ['NS04', 'NS05'] as ApprovalServiceCode[], 'NS04'),
      approvalStartDate: str(v.approvalStartDate),
      approvalEndDate: str(v.approvalEndDate),
      approvedHoursOrConsults,
      accEmailedRenewalDate: str(v.accEmailedRenewalDate) || undefined,
      poNumber,
      notes: str(v.notes),
    };
    sinks.approvals.push(withCustom(approval, customFields));
    return true;
  }

  if (def.section === 'Complex Cases') {
    const c: ComplexCase = {
      id: uid('cx'),
      patientName: str(v.patientName),
      claimNumber: str(v.claimNumber),
      dateLogged: str(v.dateLogged),
      whatsUnusual: str(v.whatsUnusual),
      decisionMade: str(v.decisionMade),
      decidedBy: str(v.decidedBy),
      dateDecided: str(v.dateDecided),
      followUpNeeded: str(v.followUpNeeded),
      nextReviewDate: str(v.nextReviewDate),
      status: coerceEnum(str(v.status), COMPLEX_STATUSES, 'Open'),
      notes: str(v.notes),
    };
    sinks.complexCases.push(withCustom(c, parsed.customFields));
    return true;
  }

  if (def.section === 'Decline Tracker') {
    const d: Decline = {
      id: uid('dc'),
      patientName: str(v.patientName),
      claimNumber: str(v.claimNumber),
      declineReceivedDate: str(v.declineReceivedDate),
      servicePeriodDeclined: str(v.servicePeriodDeclined),
      reason: str(v.reason),
      dateNurseEmailed: str(v.dateNurseEmailed) || undefined,
      dateResubmissionRequested: str(v.dateResubmissionRequested) || undefined,
      outcome: str(v.outcome) || undefined,
      dateOutcomeReceived: str(v.dateOutcomeReceived) || undefined,
      status: coerceEnum(str(v.status), DECLINE_STATUSES, 'Awaiting nursing docs for resubmission'),
      notes: str(v.notes),
    };
    sinks.declines.push(withCustom(d, parsed.customFields));
    return true;
  }

  return false;
}

function coerceEnum<T extends string>(value: string, allowed: T[], fallback: T): T {
  const found = allowed.find((a) => norm(a) === norm(value));
  return found ?? fallback;
}

// ---------------------------------------------------------------------------
// Generic (unrecognised) sheet capture
// ---------------------------------------------------------------------------

function parseCustomSheet(ws: ExcelJS.Worksheet): CustomSheet | null {
  const rowCount = ws.rowCount;
  if (!rowCount) return null;

  // Pick the first row (within the first 8) that has >= 2 non-empty cells as
  // the header; fall back to the first non-empty row.
  const maxScan = Math.min(8, rowCount);
  let headerRow = 0;
  for (let r = 1; r <= maxScan; r += 1) {
    const row = ws.getRow(r);
    let filled = 0;
    const colCount = Math.max(ws.columnCount, row.cellCount, 1);
    for (let c = 1; c <= colCount; c += 1) if (cellText(row.getCell(c))) filled += 1;
    if (filled >= 2) {
      headerRow = r;
      break;
    }
    if (headerRow === 0 && filled >= 1) headerRow = r;
  }
  if (headerRow === 0) return null;

  const colCount = Math.max(ws.columnCount, ws.getRow(headerRow).cellCount, 1);
  // Determine the last column that actually holds data anywhere.
  let lastCol = 0;
  for (let r = headerRow; r <= rowCount; r += 1) {
    const row = ws.getRow(r);
    for (let c = 1; c <= colCount; c += 1) {
      if (cellText(row.getCell(c))) lastCol = Math.max(lastCol, c);
    }
  }
  if (lastCol === 0) return null;

  const headers: string[] = [];
  const seen = new Set<string>();
  const hRow = ws.getRow(headerRow);
  for (let c = 1; c <= lastCol; c += 1) {
    let h = cellText(hRow.getCell(c)) || `Column ${c}`;
    let unique = h;
    let i = 2;
    while (seen.has(unique)) unique = `${h} (${i++})`;
    seen.add(unique);
    headers.push(unique);
  }

  const rows: Record<string, string>[] = [];
  for (let r = headerRow + 1; r <= rowCount; r += 1) {
    const row = ws.getRow(r);
    const rec: Record<string, string> = {};
    let any = false;
    for (let c = 1; c <= lastCol; c += 1) {
      const val = readString(row.getCell(c));
      if (val) {
        rec[headers[c - 1]] = val;
        any = true;
      }
    }
    if (any) rows.push(rec);
  }

  return { name: ws.name, headers, rows };
}

// ---------------------------------------------------------------------------
// Merge into AppData (pure, testable)
// ---------------------------------------------------------------------------

function invoiceKey(i: InvoiceLine): string {
  return [
    norm(i.patientName),
    norm(i.claimNumber),
    norm(i.serviceCode),
    norm(i.invoiceSheet),
    i.invoiceDate,
    String(i.amountInvoiced ?? ''),
  ].join('|');
}

function complexKey(c: ComplexCase): string {
  return [norm(c.patientName), norm(c.claimNumber), c.dateLogged, norm(c.whatsUnusual.slice(0, 40))].join('|');
}

function declineKey(d: Decline): string {
  return [norm(d.patientName), norm(d.claimNumber), d.declineReceivedDate].join('|');
}

function approvalKey(
  a: Approval,
  patientsById: Map<string, Patient>,
  claimsById: Map<string, Claim>,
): string {
  const p = patientsById.get(a.patientId);
  const c = claimsById.get(a.claimId);
  const who = p ? norm(p.nhi || p.name) : a.patientId;
  const claimNo = c ? norm(c.claimNumber) : a.claimId;
  return [who, claimNo, norm(a.serviceCode), a.approvalStartDate, a.approvalEndDate].join('|');
}

/**
 * Merge (or replace) an ImportResult into existing AppData. Pure — returns a
 * new AppData and never mutates the input. Settings are always preserved.
 */
export function mergeImportIntoData(data: AppData, result: ImportResult, mode: ImportMode): AppData {
  if (mode === 'replace') {
    return {
      ...data,
      patients: result.patients,
      claims: result.claims,
      // serviceLines reference claim ids that no longer exist after a replace.
      serviceLines: [],
      approvals: result.approvals,
      invoiceLines: result.invoiceLines,
      complexCases: result.complexCases,
      declines: result.declines,
      customSheets: result.customSheets.length ? result.customSheets : data.customSheets,
      settings: data.settings,
    };
  }

  // --- merge ---
  const patients = [...data.patients];
  const claims = [...data.claims];

  const patientByNhi = new Map<string, Patient>();
  const patientByName = new Map<string, Patient>();
  for (const p of patients) {
    if (p.nhi) patientByNhi.set(norm(p.nhi), p);
    if (p.name) patientByName.set(norm(p.name), p);
  }
  const claimByNumber = new Map<string, Claim>();
  for (const c of claims) if (c.claimNumber) claimByNumber.set(norm(c.claimNumber), c);

  // Map imported (candidate) ids -> resolved existing/new ids.
  const patientIdMap = new Map<string, string>();
  for (const imp of result.patients) {
    let existing: Patient | undefined;
    if (imp.nhi) existing = patientByNhi.get(norm(imp.nhi));
    if (!existing && imp.name) existing = patientByName.get(norm(imp.name));
    if (existing) {
      if (!existing.dob && imp.dob) existing.dob = imp.dob;
      if (!existing.nhi && imp.nhi) existing.nhi = imp.nhi;
      patientIdMap.set(imp.id, existing.id);
    } else {
      const copy: Patient = { ...imp };
      patients.push(copy);
      if (copy.nhi) patientByNhi.set(norm(copy.nhi), copy);
      if (copy.name) patientByName.set(norm(copy.name), copy);
      patientIdMap.set(imp.id, copy.id);
    }
  }

  const claimIdMap = new Map<string, string>();
  for (const imp of result.claims) {
    const existing = imp.claimNumber ? claimByNumber.get(norm(imp.claimNumber)) : undefined;
    const resolvedPatientId = patientIdMap.get(imp.patientId) ?? imp.patientId;
    if (existing) {
      if (!existing.patientId && resolvedPatientId) existing.patientId = resolvedPatientId;
      if (!existing.acc45Number && imp.acc45Number) existing.acc45Number = imp.acc45Number;
      if (!existing.poNumber && imp.poNumber) existing.poNumber = imp.poNumber;
      claimIdMap.set(imp.id, existing.id);
    } else {
      const copy: Claim = { ...imp, patientId: resolvedPatientId };
      claims.push(copy);
      if (copy.claimNumber) claimByNumber.set(norm(copy.claimNumber), copy);
      claimIdMap.set(imp.id, copy.id);
    }
  }

  // Approvals: remap relations, skip duplicates.
  const patientsById = new Map(patients.map((p) => [p.id, p]));
  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const approvals = [...data.approvals];
  const approvalKeys = new Set(approvals.map((a) => approvalKey(a, patientsById, claimsById)));
  for (const imp of result.approvals) {
    const remapped: Approval = {
      ...imp,
      patientId: patientIdMap.get(imp.patientId) ?? imp.patientId,
      claimId: claimIdMap.get(imp.claimId) ?? imp.claimId,
    };
    const key = approvalKey(remapped, patientsById, claimsById);
    if (approvalKeys.has(key)) continue;
    approvalKeys.add(key);
    approvals.push(remapped);
  }

  // Denormalised sections: append, skipping exact duplicates.
  const invoiceLines = dedupAppend(data.invoiceLines, result.invoiceLines, invoiceKey);
  const complexCases = dedupAppend(data.complexCases, result.complexCases, complexKey);
  const declines = dedupAppend(data.declines, result.declines, declineKey);

  // Custom sheets: merge by name, appending non-identical rows.
  const customSheets = mergeCustomSheets(data.customSheets ?? [], result.customSheets);

  return {
    ...data,
    patients,
    claims,
    approvals,
    invoiceLines,
    complexCases,
    declines,
    customSheets: customSheets.length ? customSheets : data.customSheets,
    settings: data.settings,
  };
}

function dedupAppend<T>(existing: T[], incoming: T[], keyOf: (x: T) => string): T[] {
  const out = [...existing];
  const keys = new Set(existing.map(keyOf));
  for (const item of incoming) {
    const k = keyOf(item);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(item);
  }
  return out;
}

function mergeCustomSheets(existing: CustomSheet[], incoming: CustomSheet[]): CustomSheet[] {
  const out = existing.map((s) => ({ ...s, headers: [...s.headers], rows: [...s.rows] }));
  const byName = new Map(out.map((s) => [norm(s.name), s]));
  for (const inc of incoming) {
    const match = byName.get(norm(inc.name));
    if (!match) {
      const copy = { ...inc, headers: [...inc.headers], rows: [...inc.rows] };
      out.push(copy);
      byName.set(norm(inc.name), copy);
      continue;
    }
    // Union headers (keep existing order, append new ones).
    for (const h of inc.headers) if (!match.headers.includes(h)) match.headers.push(h);
    const seen = new Set(match.rows.map((r) => JSON.stringify(r)));
    for (const row of inc.rows) {
      const sig = JSON.stringify(row);
      if (seen.has(sig)) continue;
      seen.add(sig);
      match.rows.push(row);
    }
  }
  return out;
}
