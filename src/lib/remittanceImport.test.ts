import { describe, it, expect } from 'vitest';
import { parseRemittanceCsv, parseRemittanceGrid } from './remittanceImport';

describe('parseRemittanceGrid — ACC45 Ref vs ACC Claim Number', () => {
  it('matches on the ACC45 Ref column, not the adjacent long numeric ACC Claim Number', () => {
    const rows = [
      ['Invoice Number', 'ACC45 Ref', 'ACC Claim Number', 'Client Name', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['INV1', 'NH48372', '10035566973', 'Synthetic Name', '18.89', '18.89', ''],
    ];
    const result = parseRemittanceGrid(rows);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].claimNumber).toBe('NH48372');
    expect(result.lines[0].accClaimNumber).toBe('10035566973');
  });

  it('falls back to a generic claim column when no ACC45 Ref column exists', () => {
    const rows = [
      ['Claim Number', 'Amount Invoiced', 'Amount Paid', 'Reason'],
      ['EE55555', '20.00', '20.00', ''],
    ];
    const result = parseRemittanceGrid(rows);
    expect(result.lines[0].claimNumber).toBe('EE55555');
  });
});

describe('parseRemittanceGrid — held/short-paid lines and reason codes', () => {
  it('flags a short-paid line as needing review and extracts a documented reason code', () => {
    const rows = [
      ['ACC45 Ref', 'Client Name', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['FF66666', 'Synthetic Client', '50.00', '0.00', 'NAF - not an ACC claim'],
    ];
    const result = parseRemittanceGrid(rows);
    const line = result.lines[0];
    expect(line.lineNeedsReview).toBe(true);
    expect(line.reasonCode).toBe('NAF');
    expect(line.reasonText).toBe('NAF - not an ACC claim');
  });

  it('flags a fully-paid line as not needing review', () => {
    const rows = [
      ['ACC45 Ref', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['GG77777', '10.00', '10.00', ''],
    ];
    const result = parseRemittanceGrid(rows);
    expect(result.lines[0].lineNeedsReview).toBe(false);
  });

  it('does not misdetect a data row whose free-text comment mentions "claim" and "paid" as a new header', () => {
    const rows = [
      ['ACC45 Ref', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['HH88888', '30.00', '30.00', 'Line paid but use amended claim no. for future billing please check'],
      ['II99999', '15.00', '0.00', 'RATE mismatch'],
    ];
    const result = parseRemittanceGrid(rows);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[1].claimNumber).toBe('II99999');
    expect(result.lines[1].reasonCode).toBe('RATE');
  });

  it('parses the same shape from CSV text', () => {
    const csv = [
      'ACC45 Ref,Amount Invoiced,Paid (GST incl.),Comments/Reason',
      'JJ10000,40.00,0.00,AP prior approval needed',
    ].join('\n');
    const result = parseRemittanceCsv(csv);
    expect(result.lines[0].claimNumber).toBe('JJ10000');
    expect(result.lines[0].reasonCode).toBe('AP');
    expect(result.lines[0].lineNeedsReview).toBe(true);
  });
});

describe('parseRemittanceGrid — coarse summary blocks', () => {
  it('counts a genuinely blank row inside a detail block as a summary line, not a bogus claim', () => {
    const rows = [
      ['ACC45 Ref', 'Client Name', 'Amount Invoiced', 'Paid (GST incl.)', 'Comments/Reason'],
      ['KK11111', 'Foo', '25.00', '25.00', ''],
      ['', '', '', '0.00', ''],
    ];
    const result = parseRemittanceGrid(rows);
    expect(result.summaryOnlyLineCount).toBe(1);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].claimNumber).toBe('KK11111');
  });
});

describe('parseRemittanceGrid — unrecognised input', () => {
  it('reports unrecognised when nothing claim/paid shaped is found', () => {
    const rows = [
      ['Just', 'Some', 'Notes'],
      ['a', 'b', 'c'],
    ];
    expect(parseRemittanceGrid(rows).unrecognised).toBe(true);
  });
});
