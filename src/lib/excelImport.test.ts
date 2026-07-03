import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseWorkbook, mergeImportIntoData, type ImportResult } from './excelImport';
import { emptyData } from './sampleData';
import type { InvoiceLine } from '../types';

// Build an in-memory workbook that exercises: title-row offset header
// detection, an extra/unknown column, computed columns to ignore, and an
// unknown sheet — then assert the parser handles all of it.
async function buildFixtureWorkbook(): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();

  // Cover page — must be skipped entirely.
  const start = wb.addWorksheet('Start Here');
  start.addRow(['ACC Nursing Services Toolkit']);
  start.addRow(['Some description']);

  // Billing Log: header on ROW 1, plus a 14th instructional cell containing
  // '=' (not a real column) and an extra recognised-as-custom "Region" column.
  const billing = wb.addWorksheet('Billing Log');
  billing.addRow([
    'Patient Name',
    'Patient NHI',
    'Claim Number',
    'Purchase Order Number',
    'ACC45 Number',
    'Service Code',
    'Invoice Sheet',
    'Invoice Date',
    'Amount Invoiced',
    'Date Paid',
    'Amount Paid',
    'Status',
    'Notes',
    'Region', // unknown -> custom field
    'Tip: type =SUM(...) to total this column yourself', // long + '=' -> ignored
  ]);
  const bRow = billing.addRow([
    'Jane Doe',
    'ABC1234',
    '100200300', // large number as claim -> must stay a string
    'PO-9',
    'A55',
    'NS03',
    'EXTMAR26',
    new Date(Date.UTC(2026, 2, 15)), // 2026-03-15
    2275.42,
    null,
    null,
    'Billed',
    'note here',
    'Northland', // custom value
    'ignored',
  ]);
  // Force the claim number to be stored as a number in the cell.
  bRow.getCell(3).value = 100200300;

  // Approvals: title rows 1-2, blank row 3, header ROW 4, data ROW 5.
  const appr = wb.addWorksheet('NS04-NS05 Approvals');
  appr.addRow(['NS04 / NS05 Approvals']);
  appr.addRow(['Track approval periods and PO expiry.']);
  appr.addRow([]);
  appr.addRow([
    'Patient Name',
    'Patient NHI',
    'Patient DOB',
    'Claim Number',
    'ACC45 Number',
    'Service Code',
    'Approval Start Date',
    'Approval End Date / PO Expiry',
    'Approved Hours/Consults',
    'Days Until Expiry', // computed -> ignore
    'Status', // computed -> ignore
    'ACC Emailed Renewal Date',
    'PO Number',
    'Notes',
  ]);
  appr.addRow([
    'Jane Doe',
    'ABC1234',
    new Date(Date.UTC(1970, 0, 2)), // 1970-01-02
    '100200300',
    'A55',
    'NS05',
    new Date(Date.UTC(2026, 0, 1)),
    new Date(Date.UTC(2026, 11, 31)),
    '6 hours p/month', // free text -> keep in customFields, numeric part 6
    999, // Days Until Expiry (ignored)
    'EXPIRED', // Status (ignored)
    null,
    'PO-9',
    'annual review',
  ]);

  // An unknown sheet -> captured as a generic custom table.
  const mystery = wb.addWorksheet('Travel Log');
  mystery.addRow(['Date', 'Kilometres', 'Destination']);
  mystery.addRow([new Date(Date.UTC(2026, 2, 3)), 42, 'Whangarei']);
  mystery.addRow([new Date(Date.UTC(2026, 2, 4)), 12, 'Kerikeri']);

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

describe('Excel import parser', () => {
  it('detects header rows (with title offsets) and maps fields', async () => {
    const result = await parseWorkbook(await buildFixtureWorkbook());

    expect(result.invoiceLines).toHaveLength(1);
    expect(result.approvals).toHaveLength(1);

    const inv = result.invoiceLines[0];
    expect(inv.patientName).toBe('Jane Doe');
    expect(inv.serviceCode).toBe('NS03');
    expect(inv.status).toBe('Billed');
    // Large claim number preserved as a string.
    expect(inv.claimNumber).toBe('100200300');
    expect(typeof inv.claimNumber).toBe('string');
    // Number parsed as a number.
    expect(inv.amountInvoiced).toBe(2275.42);
    // Date converted to ISO YYYY-MM-DD.
    expect(inv.invoiceDate).toBe('2026-03-15');
  });

  it('keeps unknown columns as customFields and ignores computed/long cells', async () => {
    const result = await parseWorkbook(await buildFixtureWorkbook());
    const inv = result.invoiceLines[0];
    expect(inv.customFields).toBeDefined();
    expect(inv.customFields?.Region).toBe('Northland');
    // The long instructional '=' cell must NOT become a custom field.
    const keys = Object.keys(inv.customFields ?? {});
    expect(keys.some((k) => k.includes('='))).toBe(false);
    expect(keys).toEqual(['Region']);

    // Approvals: computed columns ignored, free-text hours preserved.
    const ap = result.approvals[0];
    expect(ap.serviceCode).toBe('NS05');
    expect(ap.approvedHoursOrConsults).toBe(6); // numeric part of free text
    expect(ap.customFields?.['Approved Hours/Consults']).toBe('6 hours p/month');
    expect(ap.approvalStartDate).toBe('2026-01-01');
    expect(ap.approvalEndDate).toBe('2026-12-31');
  });

  it('reconciles patients/claims from approvals + billing without duplicates', async () => {
    const result = await parseWorkbook(await buildFixtureWorkbook());
    // Billing + approval both reference Jane Doe / claim 100200300 -> one each.
    expect(result.patients).toHaveLength(1);
    expect(result.patients[0].name).toBe('Jane Doe');
    expect(result.patients[0].dob).toBe('1970-01-02');
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0].claimNumber).toBe('100200300');
    // Approval is linked to the reconciled patient/claim.
    expect(result.approvals[0].patientId).toBe(result.patients[0].id);
    expect(result.approvals[0].claimId).toBe(result.claims[0].id);
  });

  it('captures unknown sheets as custom tables and skips Start Here', async () => {
    const result = await parseWorkbook(await buildFixtureWorkbook());
    expect(result.customSheets).toHaveLength(1);
    const sheet = result.customSheets[0];
    expect(sheet.name).toBe('Travel Log');
    expect(sheet.headers).toEqual(['Date', 'Kilometres', 'Destination']);
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[0].Destination).toBe('Whangarei');
    expect(sheet.rows[0].Kilometres).toBe('42');

    expect(result.summary.unrecognizedSheets).toEqual(['Travel Log']);
    expect(result.summary.newColumnsBySheet['Billing Log']).toEqual(['Region']);
    // Start Here / Year Summary never appear in the summary sheet list.
    expect(result.summary.sheets.some((s) => s.sheet === 'Start Here')).toBe(false);
  });
});

describe('Excel import merge', () => {
  function makeInvoice(over: Partial<InvoiceLine>): InvoiceLine {
    return {
      id: over.id ?? 'x',
      patientName: 'Jane Doe',
      nhi: 'ABC1234',
      claimNumber: 'CLM1',
      poNumber: 'PO1',
      acc45Number: 'A1',
      serviceCode: 'NS03',
      invoiceSheet: 'EXTMAR26',
      invoiceDate: '2026-03-15',
      amountInvoiced: 100,
      status: 'Billed',
      notes: '',
      ...over,
    };
  }

  function emptyResult(over: Partial<ImportResult>): ImportResult {
    return {
      patients: [],
      claims: [],
      invoiceLines: [],
      approvals: [],
      complexCases: [],
      declines: [],
      customSheets: [],
      summary: {
        counts: {
          patients: 0,
          claims: 0,
          invoiceLines: 0,
          approvals: 0,
          complexCases: 0,
          declines: 0,
          customSheets: 0,
        },
        sheets: [],
        unrecognizedSheets: [],
        newColumnsBySheet: {},
        warnings: [],
      },
      ...over,
    };
  }

  it('skips exact-duplicate invoice lines but appends new ones (merge)', () => {
    const base = emptyData();
    base.invoiceLines = [makeInvoice({ id: 'existing' })];

    const result = emptyResult({
      invoiceLines: [
        makeInvoice({ id: 'dup' }), // same natural key -> skipped
        makeInvoice({ id: 'new', invoiceSheet: 'EXTAPR26' }), // different -> kept
      ],
    });

    const merged = mergeImportIntoData(base, result, 'merge');
    expect(merged.invoiceLines).toHaveLength(2);
    expect(merged.invoiceLines.map((i) => i.invoiceSheet).sort()).toEqual(['EXTAPR26', 'EXTMAR26']);
    // Settings preserved.
    expect(merged.settings).toEqual(base.settings);
  });

  it('replace swaps the sections and keeps settings', () => {
    const base = emptyData();
    base.invoiceLines = [makeInvoice({ id: 'old' })];
    base.settings = { ...base.settings, expiryThresholdDays: 45 };

    const result = emptyResult({ invoiceLines: [makeInvoice({ id: 'fresh', patientName: 'New Person' })] });
    const replaced = mergeImportIntoData(base, result, 'replace');
    expect(replaced.invoiceLines).toHaveLength(1);
    expect(replaced.invoiceLines[0].patientName).toBe('New Person');
    expect(replaced.settings.expiryThresholdDays).toBe(45);
  });

  it('merges custom sheets by name, skipping identical rows', () => {
    const base = emptyData();
    base.customSheets = [
      { name: 'Travel Log', headers: ['Date', 'Km'], rows: [{ Date: '2026-03-03', Km: '42' }] },
    ];
    const result = emptyResult({
      customSheets: [
        {
          name: 'Travel Log',
          headers: ['Date', 'Km'],
          rows: [
            { Date: '2026-03-03', Km: '42' }, // identical -> skipped
            { Date: '2026-03-04', Km: '12' }, // new -> kept
          ],
        },
      ],
    });
    const merged = mergeImportIntoData(base, result, 'merge');
    expect(merged.customSheets).toHaveLength(1);
    expect(merged.customSheets![0].rows).toHaveLength(2);
  });
});
