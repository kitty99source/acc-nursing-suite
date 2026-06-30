import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbookBuffer } from './excel';
import { sampleData } from './sampleData';

describe('Excel export', () => {
  it('produces a structurally valid workbook with the exact tab order', async () => {
    const buf = await buildWorkbookBuffer(sampleData());

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);

    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      'Start Here',
      'Billing Log',
      'Year Summary',
      'NS04-NS05 Approvals',
      'Complex Cases',
      'Decline Tracker',
    ]);
  });

  it('writes the exact Billing Log column headers', async () => {
    const buf = await buildWorkbookBuffer(sampleData());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('Billing Log')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
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
    ]);
  });

  it('writes the exact Approvals column headers', async () => {
    const buf = await buildWorkbookBuffer(sampleData());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet('NS04-NS05 Approvals')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
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
    ]);
  });
});
