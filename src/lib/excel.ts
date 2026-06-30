import ExcelJS from 'exceljs';
import type { AppData } from '../types';
import { computeApproval, yearSummary } from './analytics';
import { MONTH_NAMES } from './format';

// ============================================================================
// ExcelJS workbook export — reproduces the user's original toolkit workbook
// exactly (tab order, column labels, dropdowns, conditional formatting).
// Designed to open in Excel with no repair prompts.
// ============================================================================

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF2F4858' },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const GROUP_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A6B7E' } };

const SALMON = 'FFF4A39B';
const GREEN = 'FFCDEAC0';

const DATE_FMT = 'dd mmm yyyy';
const MONEY_FMT = '#,##0.00';

function isoToDate(iso?: string): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFB0BEC5' } },
    };
  });
  row.height = 26;
}

function setDateCell(cell: ExcelJS.Cell, iso?: string) {
  const d = isoToDate(iso);
  if (d) {
    cell.value = d;
    cell.numFmt = DATE_FMT;
  } else {
    cell.value = null;
  }
}

function setMoneyCell(cell: ExcelJS.Cell, value?: number) {
  if (value == null || Number.isNaN(value)) {
    cell.value = null;
  } else {
    cell.value = value;
    cell.numFmt = MONEY_FMT;
  }
}

// ---------------------------------------------------------------------------
// Start Here
// ---------------------------------------------------------------------------
function buildStartHere(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet('Start Here', { properties: { tabColor: { argb: 'FF2F8F83' } } });
  ws.columns = [{ width: 28 }, { width: 90 }];
  ws.mergeCells('A1:B1');
  const title = ws.getCell('A1');
  title.value = 'ACC Nursing Services Toolkit';
  title.font = { bold: true, size: 18, color: { argb: 'FF2F4858' } };
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:B2');
  const subtitle = ws.getCell('A2');
  subtitle.value =
    'Manual billing, approvals, complex cases and declines tracker for ACC District Nursing Services. Exported from the ACC District Nursing Admin Suite.';
  subtitle.font = { italic: true, size: 11, color: { argb: 'FF607D8B' } };
  subtitle.alignment = { wrapText: true };
  ws.getRow(2).height = 34;

  const headerRow = ws.addRow(['Tab', "What it's for"]);
  styleHeaderRow(headerRow);

  const index: [string, string][] = [
    ['Billing Log', 'The core ledger — every invoice line with status (Awaiting Billing / Billed / Remittance).'],
    ['Year Summary', 'Monthly invoiced vs paid by service group (Packages NS01-03, NS04, NS05, NS06).'],
    ['NS04-NS05 Approvals', 'Approval tracking with days until expiry and status; salmon highlight when expiring/expired.'],
    ['Complex Cases', 'Structured log of unusual cases, decisions and review dates.'],
    ['Decline Tracker', 'Decline receipt → resubmission → outcome workflow.'],
  ];
  for (const [tab, desc] of index) {
    const r = ws.addRow([tab, desc]);
    r.getCell(1).font = { bold: true };
    r.getCell(2).alignment = { wrapText: true };
  }
  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// Billing Log
// ---------------------------------------------------------------------------
function buildBillingLog(wb: ExcelJS.Workbook, data: AppData) {
  const ws = wb.addWorksheet('Billing Log');
  const headers = [
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
  ];
  ws.columns = [
    { width: 24 }, { width: 12 }, { width: 16 }, { width: 22 }, { width: 14 },
    { width: 12 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 14 },
    { width: 14 }, { width: 20 }, { width: 36 },
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  for (const inv of data.invoiceLines) {
    const row = ws.addRow([
      inv.patientName,
      inv.nhi,
      inv.claimNumber,
      inv.poNumber,
      inv.acc45Number,
      inv.serviceCode,
      inv.invoiceSheet,
      null,
      null,
      null,
      null,
      inv.status,
      inv.notes,
    ]);
    setDateCell(row.getCell(8), inv.invoiceDate);
    setMoneyCell(row.getCell(9), inv.amountInvoiced);
    setDateCell(row.getCell(10), inv.datePaid);
    setMoneyCell(row.getCell(11), inv.amountPaid);
  }

  const lastRow = Math.max(ws.rowCount, 2);

  // Data validation dropdown on Status (column L) for a generous range.
  const validationLast = Math.max(lastRow, 500);
  for (let r = 2; r <= validationLast; r += 1) {
    ws.getCell(`L${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Awaiting Billing,Billed,Remittance"'],
      showErrorMessage: true,
      errorStyle: 'warning',
      error: 'Choose Awaiting Billing, Billed or Remittance.',
    };
  }

  // Conditional formatting: salmon for Awaiting Billing / Remittance, green for Billed.
  ws.addConditionalFormatting({
    ref: `A2:M${lastRow}`,
    rules: [
      {
        type: 'expression',
        formulae: ['$L2="Awaiting Billing"'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SALMON } } },
      },
      {
        type: 'expression',
        formulae: ['$L2="Remittance"'],
        priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SALMON } } },
      },
      {
        type: 'expression',
        formulae: ['$L2="Billed"'],
        priority: 3,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } } },
      },
    ],
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:M1';
}

// ---------------------------------------------------------------------------
// Year Summary
// ---------------------------------------------------------------------------
function buildYearSummary(wb: ExcelJS.Workbook, data: AppData) {
  const ws = wb.addWorksheet('Year Summary');
  ws.columns = [
    { width: 10 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  const year = new Date().getFullYear();
  ws.mergeCells('A1:I1');
  const titleCell = ws.getCell('A1');
  titleCell.value = `Year Summary — ${year}`;
  titleCell.font = { bold: true, size: 14, color: { argb: 'FF2F4858' } };
  ws.getRow(1).height = 24;

  // Group header (row 2) + sub header (row 3).
  ws.mergeCells('A2:A3');
  ws.getCell('A2').value = 'Month';
  ws.mergeCells('B2:C2');
  ws.getCell('B2').value = 'Packages (NS01-03)';
  ws.mergeCells('D2:E2');
  ws.getCell('D2').value = 'NS04';
  ws.mergeCells('F2:G2');
  ws.getCell('F2').value = 'NS05';
  ws.mergeCells('H2:I2');
  ws.getCell('H2').value = 'NS06';

  const subRow = ws.getRow(3);
  subRow.getCell(2).value = 'Invoiced';
  subRow.getCell(3).value = 'Paid';
  subRow.getCell(4).value = 'Invoiced';
  subRow.getCell(5).value = 'Paid';
  subRow.getCell(6).value = 'Invoiced';
  subRow.getCell(7).value = 'Paid';
  subRow.getCell(8).value = 'Invoiced';
  subRow.getCell(9).value = 'Paid';

  styleHeaderRow(ws.getRow(2));
  styleHeaderRow(subRow);
  for (let c = 2; c <= 9; c += 1) ws.getRow(2).getCell(c).fill = GROUP_FILL;
  ws.getCell('A2').fill = HEADER_FILL;

  const rows = yearSummary(data, year);
  const totals = { pi: 0, pp: 0, n4i: 0, n4p: 0, n5i: 0, n5p: 0, n6i: 0, n6p: 0 };
  rows.forEach((r, idx) => {
    const row = ws.addRow([
      MONTH_NAMES[idx],
      r.packagesInvoiced,
      r.packagesPaid,
      r.ns04Invoiced,
      r.ns04Paid,
      r.ns05Invoiced,
      r.ns05Paid,
      r.ns06Invoiced,
      r.ns06Paid,
    ]);
    for (let c = 2; c <= 9; c += 1) row.getCell(c).numFmt = MONEY_FMT;
    totals.pi += r.packagesInvoiced;
    totals.pp += r.packagesPaid;
    totals.n4i += r.ns04Invoiced;
    totals.n4p += r.ns04Paid;
    totals.n5i += r.ns05Invoiced;
    totals.n5p += r.ns05Paid;
    totals.n6i += r.ns06Invoiced;
    totals.n6p += r.ns06Paid;
  });

  const totalRow = ws.addRow([
    'Total', totals.pi, totals.pp, totals.n4i, totals.n4p, totals.n5i, totals.n5p, totals.n6i, totals.n6p,
  ]);
  totalRow.eachCell((cell, col) => {
    cell.font = { bold: true };
    if (col >= 2) cell.numFmt = MONEY_FMT;
    cell.border = { top: { style: 'thin', color: { argb: 'FF90A4AE' } } };
  });

  ws.views = [{ state: 'frozen', ySplit: 3 }];
}

// ---------------------------------------------------------------------------
// NS04-NS05 Approvals
// ---------------------------------------------------------------------------
function buildApprovals(wb: ExcelJS.Workbook, data: AppData) {
  const ws = wb.addWorksheet('NS04-NS05 Approvals');
  const headers = [
    'Patient Name',
    'Patient NHI',
    'Patient DOB',
    'Claim Number',
    'ACC45 Number',
    'Service Code',
    'Approval Start Date',
    'Approval End Date / PO Expiry',
    'Approved Hours/Consults',
    'Days Until Expiry',
    'Status',
    'ACC Emailed Renewal Date',
    'PO Number',
    'Notes',
  ];
  ws.columns = [
    { width: 24 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 14 },
    { width: 12 }, { width: 18 }, { width: 26 }, { width: 22 }, { width: 16 },
    { width: 22 }, { width: 22 }, { width: 14 }, { width: 36 },
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  const threshold = data.settings.expiryThresholdDays;
  for (const a of data.approvals) {
    const patient = data.patients.find((p) => p.id === a.patientId);
    const claim = data.claims.find((c) => c.id === a.claimId);
    const { daysUntilExpiry, status } = computeApproval(a, threshold);
    const row = ws.addRow([
      patient?.name ?? '',
      patient?.nhi ?? '',
      null,
      claim?.claimNumber ?? '',
      claim?.acc45Number ?? a.poNumber,
      a.serviceCode,
      null,
      null,
      a.approvedHoursOrConsults,
      daysUntilExpiry,
      status,
      null,
      a.poNumber,
      a.notes,
    ]);
    setDateCell(row.getCell(3), patient?.dob);
    setDateCell(row.getCell(7), a.approvalStartDate);
    setDateCell(row.getCell(8), a.approvalEndDate);
    setDateCell(row.getCell(12), a.accEmailedRenewalDate);
  }

  const lastRow = Math.max(ws.rowCount, 2);

  const validationLast = Math.max(lastRow, 500);
  for (let r = 2; r <= validationLast; r += 1) {
    ws.getCell(`K${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"Active,Expiring Soon (<30 days),EXPIRED"'],
      showErrorMessage: false,
    };
  }

  // Salmon highlight when within threshold or expired (Status K).
  ws.addConditionalFormatting({
    ref: `A2:N${lastRow}`,
    rules: [
      {
        type: 'expression',
        formulae: ['$K2="EXPIRED"'],
        priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SALMON } } },
      },
      {
        type: 'expression',
        formulae: ['$K2="Expiring Soon (<30 days)"'],
        priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: SALMON } } },
      },
    ],
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:N1';
}

// ---------------------------------------------------------------------------
// Complex Cases
// ---------------------------------------------------------------------------
function buildComplexCases(wb: ExcelJS.Workbook, data: AppData) {
  const ws = wb.addWorksheet('Complex Cases');
  const headers = [
    'Patient Name',
    'Claim Number',
    'Date Logged',
    "What's Unusual",
    'Decision Made',
    'Decided By',
    'Date Decided',
    'Follow-up Needed',
    'Next Review Date',
    'Status',
    'Notes',
  ];
  ws.columns = [
    { width: 24 }, { width: 16 }, { width: 14 }, { width: 40 }, { width: 40 },
    { width: 18 }, { width: 14 }, { width: 30 }, { width: 16 }, { width: 14 }, { width: 30 },
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  for (const c of data.complexCases) {
    const row = ws.addRow([
      c.patientName,
      c.claimNumber,
      null,
      c.whatsUnusual,
      c.decisionMade,
      c.decidedBy,
      null,
      c.followUpNeeded,
      null,
      c.status,
      c.notes,
    ]);
    setDateCell(row.getCell(3), c.dateLogged);
    setDateCell(row.getCell(7), c.dateDecided);
    setDateCell(row.getCell(9), c.nextReviewDate);
    [4, 5, 8, 11].forEach((col) => {
      row.getCell(col).alignment = { wrapText: true, vertical: 'top' };
    });
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:K1';
}

// ---------------------------------------------------------------------------
// Decline Tracker
// ---------------------------------------------------------------------------
function buildDeclines(wb: ExcelJS.Workbook, data: AppData) {
  const ws = wb.addWorksheet('Decline Tracker');
  const headers = [
    'Patient Name',
    'Claim Number',
    'Decline Received Date',
    'Service/Period Declined',
    'Reason for Decline',
    'Date Nurse Emailed',
    'Date Resubmission Requested',
    'Outcome',
    'Date Outcome Received',
    'Status',
    'Notes',
  ];
  ws.columns = [
    { width: 24 }, { width: 16 }, { width: 20 }, { width: 26 }, { width: 36 },
    { width: 18 }, { width: 24 }, { width: 20 }, { width: 20 }, { width: 32 }, { width: 30 },
  ];
  const headerRow = ws.addRow(headers);
  styleHeaderRow(headerRow);

  for (const d of data.declines) {
    const row = ws.addRow([
      d.patientName,
      d.claimNumber,
      null,
      d.servicePeriodDeclined,
      d.reason,
      null,
      null,
      d.outcome ?? '',
      null,
      d.status,
      d.notes,
    ]);
    setDateCell(row.getCell(3), d.declineReceivedDate);
    setDateCell(row.getCell(6), d.dateNurseEmailed);
    setDateCell(row.getCell(7), d.dateResubmissionRequested);
    setDateCell(row.getCell(9), d.dateOutcomeReceived);
    [5, 11].forEach((col) => {
      row.getCell(col).alignment = { wrapText: true, vertical: 'top' };
    });
  }

  const lastRow = Math.max(ws.rowCount, 2);
  const validationLast = Math.max(lastRow, 500);
  for (let r = 2; r <= validationLast; r += 1) {
    ws.getCell(`J${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [
        '"Awaiting nursing docs for resubmission,Awaiting response from ACC,Accepted,Declined again"',
      ],
      showErrorMessage: false,
    };
  }

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = 'A1:K1';
}

export async function buildWorkbookBuffer(data: AppData): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ACC District Nursing Admin Suite';
  wb.created = new Date();
  wb.modified = new Date();

  buildStartHere(wb);
  buildBillingLog(wb, data);
  buildYearSummary(wb, data);
  buildApprovals(wb, data);
  buildComplexCases(wb, data);
  buildDeclines(wb, data);

  return wb.xlsx.writeBuffer();
}

export async function buildWorkbookBlob(data: AppData): Promise<Blob> {
  const buffer = await buildWorkbookBuffer(data);
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
