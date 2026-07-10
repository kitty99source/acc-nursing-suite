import { describe, it, expect } from 'vitest';
import type { AppData, InvoiceLine } from '../types';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../types';
import { billingFunnel, staleRemittanceLines, managementSummaryMetrics, memoStats } from './analytics';
import { sampleData } from './sampleData';
import { todayISO } from './format';

function emptyData(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    patients: [],
    claims: [],
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: { ...DEFAULT_SETTINGS },
    documents: [],
    memos: [],
  };
}

function line(partial: Partial<InvoiceLine> & Pick<InvoiceLine, 'id' | 'status'>): InvoiceLine {
  return {
    patientName: 'Pat',
    nhi: 'ZZZ0016',
    claimNumber: 'C1',
    poNumber: 'PO1',
    acc45Number: 'A1',
    serviceCode: 'NS01',
    invoiceSheet: 'S1',
    invoiceDate: '2026-01-15',
    amountInvoiced: 100,
    notes: '',
    ...partial,
  };
}

/** Manual SQL-style aggregation for funnel parity checks (P6-003). */
function manualFunnel(invoices: InvoiceLine[]) {
  const f = {
    awaitingBilling: { count: 0, amount: 0 },
    billed: { count: 0, amount: 0 },
    remittance: { count: 0, amount: 0 },
  };
  for (const inv of invoices) {
    const amt = inv.amountInvoiced || 0;
    if (inv.status === 'Awaiting Billing') {
      f.awaitingBilling.count += 1;
      f.awaitingBilling.amount += amt;
    } else if (inv.status === 'Billed') {
      f.billed.count += 1;
      f.billed.amount += amt;
    } else if (inv.status === 'Remittance') {
      f.remittance.count += 1;
      f.remittance.amount += amt;
    }
  }
  return f;
}

describe('billingFunnel', () => {
  it('matches manual aggregation on synthetic lines', () => {
    const data = emptyData();
    data.invoiceLines = [
      line({ id: '1', status: 'Awaiting Billing', amountInvoiced: 50 }),
      line({ id: '2', status: 'Awaiting Billing', amountInvoiced: 75 }),
      line({ id: '3', status: 'Billed', amountInvoiced: 200, amountPaid: 200 }),
      line({ id: '4', status: 'Remittance', amountInvoiced: 120 }),
      line({ id: '5', status: 'Remittance', amountInvoiced: 30 }),
    ];
    expect(billingFunnel(data)).toEqual(manualFunnel(data.invoiceLines));
  });

  it('matches manual aggregation on sample data', () => {
    const data = sampleData();
    expect(billingFunnel(data)).toEqual(manualFunnel(data.invoiceLines));
  });

  it('handles 2k invoice lines without drift', () => {
    const data = emptyData();
    const statuses: InvoiceLine['status'][] = ['Awaiting Billing', 'Billed', 'Remittance'];
    data.invoiceLines = Array.from({ length: 2000 }, (_, i) =>
      line({
        id: `inv_${i}`,
        status: statuses[i % 3],
        amountInvoiced: (i % 50) + 1,
        serviceCode: i % 2 === 0 ? 'NS01' : 'NS06',
      }),
    );
    expect(billingFunnel(data)).toEqual(manualFunnel(data.invoiceLines));
  });
});

describe('staleRemittanceLines', () => {
  it('returns remittance lines older than threshold days', () => {
    const shift = (days: number) => {
      const ms = Date.parse(todayISO() + 'T00:00:00Z') + days * 86400000;
      return new Date(ms).toISOString().slice(0, 10);
    };
    const data = emptyData();
    data.settings.remittanceStaleDays = 30;
    data.invoiceLines = [
      line({ id: 'fresh', status: 'Remittance', invoiceDate: shift(-10) }),
      line({ id: 'stale', status: 'Remittance', invoiceDate: shift(-45) }),
      line({ id: 'billed', status: 'Billed', invoiceDate: shift(-45) }),
    ];
    const stale = staleRemittanceLines(data);
    expect(stale.map((x) => x.id)).toEqual(['stale']);
  });
});

describe('managementSummaryMetrics', () => {
  it('includes funnel and decline counts from sample data', () => {
    const data = sampleData();
    const m = managementSummaryMetrics(data);
    expect(m.funnel).toEqual(billingFunnel(data));
    expect(m.violations).toBeGreaterThanOrEqual(0);
    expect(typeof m.openDeclines).toBe('number');
  });
});

describe('memoStats', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('returns zeros for no memos', () => {
    const data = emptyData();
    expect(memoStats(data)).toEqual({ total: 0, unresolved: 0, sentThisWeek: 0 });
  });

  it('counts total, unresolved, and memos sent within the last 7 days', () => {
    const now = Date.parse('2026-06-15T00:00:00.000Z');
    const data = emptyData();
    data.memos = [
      { id: 'm1', patientId: 'p1', text: 'a', createdAt: now - 1 * DAY, resolved: false },
      { id: 'm2', patientId: 'p1', text: 'b', createdAt: now - 2 * DAY, resolved: true, resolvedAt: now },
      { id: 'm3', patientId: 'p2', text: 'c', createdAt: now - 40 * DAY, resolved: false },
    ];
    expect(memoStats(data, now)).toEqual({ total: 3, unresolved: 2, sentThisWeek: 2 });
  });

  it('treats memos with resolved undefined as unresolved', () => {
    const now = Date.now();
    const data = emptyData();
    data.memos = [{ id: 'm1', patientId: 'p1', text: 'a', createdAt: now }];
    expect(memoStats(data, now).unresolved).toBe(1);
  });
});
