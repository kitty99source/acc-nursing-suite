import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseInvoiceScheduleCsv,
  parseInvoiceScheduleGrid,
  parseInvoiceScheduleXlsx,
  toInvoiceLineCandidate,
} from './invoiceScheduleImport';

// Real-shape header confirmed against the 4 sample workbooks on the user's
// Desktop (ONNMAR26.xlsx / EXNMAR26.xlsx / "ST MT LTNPMAR26.xlsx" /
// SINMAR26.xlsx) — read for shape only; these values are synthetic.
const REAL_SHAPE_HEADERS = [
  'ProviderID',
  'ClaimNumber',
  'ApprovalNumber',
  'AccidentDate',
  'NHI',
  'ClaimantFirstName',
  'ClaimantSecondName',
  'ClaimantThirdName',
  'ClaimantSurname',
  'ClaimantDOB',
  'ServiceDate',
  'FacilityCode',
  'LoadingCode',
  'ClaimedTotalAmount',
  'ClaimedHours',
  'ClaimedMinutes',
  'ClaimedDistance',
  'ScheduleLineComment',
  'ACCServiceItemCode1',
  'ACCServiceItemCode2',
];

describe('parseInvoiceScheduleGrid — real ACC schedule shape', () => {
  it('maps the split name columns, NHI, service date and ACCServiceItemCode1', () => {
    const rows = [
      REAL_SHAPE_HEADERS,
      [
        'K11111',
        'ZZ99999',
        '',
        new Date('2020-01-01T00:00:00Z'),
        'ABC1234',
        'JANE',
        'MARIE',
        '',
        'DOE',
        new Date('1970-01-01T00:00:00Z'),
        new Date('2026-03-09T00:00:00Z'),
        '',
        '',
        42.5,
        '',
        '',
        '',
        '',
        'NS05',
        '',
      ],
    ];
    const result = parseInvoiceScheduleGrid(rows, 'EXTMAR26');
    expect(result.unrecognised).toBe(false);
    expect(result.lines).toHaveLength(1);
    const line = result.lines[0];
    expect(line.claimNumber).toBe('ZZ99999');
    expect(line.nhi).toBe('ABC1234');
    expect(line.patientName).toBe('JANE MARIE DOE');
    expect(line.serviceCode).toBe('NS05');
    expect(line.serviceDate).toBe('2026-03-09');
    expect(line.amountInvoiced).toBe(42.5);
    expect(line.invoiceSheet).toBe('EXTMAR26');
  });

  it('skips rows with no claim number', () => {
    const rows = [REAL_SHAPE_HEADERS, ['K1', '', '', '', 'X', 'A', '', '', 'B', '', '', '', '', 10, '', '', '', '', 'NS01', '']];
    const result = parseInvoiceScheduleGrid(rows, 'SHEET');
    expect(result.lines).toHaveLength(0);
  });

  it('reads the same shape from a CSV export', () => {
    const csv = [
      REAL_SHAPE_HEADERS.join(','),
      'K1,AA11111,,,QRS4567,JOHN,,,SMITH,,2026-02-01,,,55.00,,,,,NS01,',
    ].join('\n');
    const result = parseInvoiceScheduleCsv(csv, 'ONNMAR26');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].claimNumber).toBe('AA11111');
    expect(result.lines[0].amountInvoiced).toBe(55);
  });
});

describe('parseInvoiceScheduleGrid — generic alias shape', () => {
  it('falls back to a single Name column and generic Amount/ServiceCode headers', () => {
    const rows = [
      ['ClaimNumber', 'ClientName', 'ServiceCode', 'Amount'],
      ['BB22222', 'Alex Example', 'NS04', '18.00'],
    ];
    const result = parseInvoiceScheduleGrid(rows, 'SHEETX');
    expect(result.unrecognised).toBe(false);
    expect(result.lines[0].patientName).toBe('Alex Example');
    expect(result.lines[0].serviceCode).toBe('NS04');
    expect(result.lines[0].amountInvoiced).toBe(18);
  });

  it('is unrecognised when there is no claim-number or amount column', () => {
    const rows = [
      ['Name', 'Notes'],
      ['Alex', 'nothing useful'],
    ];
    expect(parseInvoiceScheduleGrid(rows, 'S').unrecognised).toBe(true);
  });
});

describe('parseInvoiceScheduleXlsx', () => {
  it('parses a real-shape .xlsx workbook via ExcelJS', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ACC District Nursing NS04 Price');
    ws.addRow(REAL_SHAPE_HEADERS);
    const row = ws.addRow([
      'K1',
      'CC33333',
      '',
      new Date('2020-01-01'),
      'TUV7890',
      'PAT',
      '',
      '',
      'TEST',
      new Date('1980-01-01'),
      new Date('2026-03-15'),
      '',
      '',
      126.14,
      '',
      '',
      '',
      '',
      'NS04',
      '',
    ]);
    row.commit();
    const buffer = await wb.xlsx.writeBuffer();
    const result = await parseInvoiceScheduleXlsx(buffer as ArrayBuffer, 'EXNMAR26');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].claimNumber).toBe('CC33333');
    expect(result.lines[0].serviceDate).toBe('2026-03-15');
    expect(result.lines[0].amountInvoiced).toBeCloseTo(126.14);
  });
});

describe('toInvoiceLineCandidate', () => {
  it('maps to InvoiceLine fields with ACC45/PO left blank and status omitted', () => {
    const candidate = toInvoiceLineCandidate({
      patientName: 'Pat Test',
      nhi: 'ABC1234',
      claimNumber: 'DD44444',
      serviceCode: 'NS01',
      serviceDate: '2026-01-05',
      amountInvoiced: 10,
      invoiceSheet: 'SHEET',
    });
    expect(candidate.claimNumber).toBe('DD44444');
    expect(candidate.acc45Number).toBe('');
    expect(candidate.poNumber).toBe('');
    expect(candidate.invoiceDate).toBe('2026-01-05');
    expect('status' in candidate).toBe(false);
  });
});
