import { describe, it, expect } from 'vitest';
import type { AppData, InvoiceLine } from '../types';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../types';
import { runCompliance, claimBillingState, orphanFixIntents, COMPLIANCE_RULES_VERSION, FIX_INTENT_ROUTES } from './compliance';
import { sampleData } from './sampleData';
import { effectivePackageValue, determinePackage } from './calculator';
import { todayISO } from './format';

function shift(days: number): string {
  const ms = Date.parse(todayISO() + 'T00:00:00Z') + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function base(): AppData {
  return {
    schemaVersion: SCHEMA_VERSION,
    patients: [{ id: 'p1', name: 'Pat One', nhi: 'N1', dob: '1980-01-01', notes: '' }],
    claims: [],
    serviceLines: [],
    approvals: [],
    invoiceLines: [],
    complexCases: [],
    declines: [],
    settings: { ...DEFAULT_SETTINGS },
    documents: [],
  };
}

function invoice(partial: Partial<InvoiceLine>): Omit<InvoiceLine, 'id'> & { id: string } {
  return {
    id: `inv_${Math.random().toString(36).slice(2)}`,
    patientName: 'Pat One',
    nhi: 'N1',
    claimNumber: 'C1',
    poNumber: 'PO1',
    acc45Number: 'A1',
    serviceCode: 'NS01',
    invoiceSheet: 'SHEET1',
    invoiceDate: shift(-10),
    amountInvoiced: 100,
    datePaid: undefined,
    amountPaid: undefined,
    status: 'Billed',
    notes: '',
    ...partial,
  };
}

const ruleIds = (d: AppData) => runCompliance(d).map((f) => f.ruleId);

describe('runCompliance — no data', () => {
  it('returns no findings for an empty file', () => {
    expect(runCompliance(base())).toEqual([]);
  });
});

describe('runCompliance — violations', () => {
  it('flags NS04 with no approval on the claim', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-120) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS04', day1Date: shift(-120), consultCount: 5, interruptions: [] }];
    expect(ruleIds(d)).toContain('ns04-needs-approval');
  });

  it('does NOT flag NS04 when a current approval exists', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-120) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS04', day1Date: shift(-120), consultCount: 5, interruptions: [], approvalId: 'a1' }];
    d.approvals = [{ id: 'a1', patientId: 'p1', claimId: 'C1', serviceCode: 'NS04', approvalStartDate: shift(-30), approvalEndDate: shift(30), approvedHoursOrConsults: 10, consultsUsed: 5, poNumber: 'PO1', notes: '' }];
    expect(ruleIds(d)).not.toContain('ns04-needs-approval');
  });

  it('flags a package that exceeds the 25-consult cap without NS04', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS02', day1Date: shift(-90), consultCount: 30, interruptions: [] }];
    expect(ruleIds(d)).toContain('exceeds-25-cap');
  });

  it('flags a second package on a claim without a distinct PO', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: '', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = [
      invoice({ serviceCode: 'NS01', poNumber: '', invoiceDate: shift(-40) }),
      invoice({ serviceCode: 'NS01', poNumber: '', invoiceDate: shift(-5) }),
    ];
    expect(ruleIds(d)).toContain('one-package-per-claim');
  });

  it('flags more than 50 NS06 treatments on one claim', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = Array.from({ length: 51 }, (_, i) => invoice({ serviceCode: 'NS06', invoiceDate: shift(-80 + i) }));
    expect(ruleIds(d)).toContain('ns06-over-50');
  });

  it('flags travel billed with no eligible companion service', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = [invoice({ serviceCode: 'NSTD10' })];
    expect(ruleIds(d)).toContain('travel-needs-eligible');
  });

  it('does NOT flag travel when NS05 is present', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = [invoice({ serviceCode: 'NSTD10' }), invoice({ serviceCode: 'NS05', invoiceDate: shift(-9) })];
    expect(ruleIds(d)).not.toContain('travel-needs-eligible');
  });

  it('flags NS04 delivered beyond the approved number', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS04', day1Date: shift(-90), consultCount: 8, interruptions: [], approvalId: 'a1' }];
    d.approvals = [{ id: 'a1', patientId: 'p1', claimId: 'C1', serviceCode: 'NS04', approvalStartDate: shift(-30), approvalEndDate: shift(30), approvedHoursOrConsults: 5, consultsUsed: 8, poNumber: 'PO1', notes: '' }];
    expect(ruleIds(d)).toContain('ns04-beyond-approval');
  });

  it('stamps findings with the configured rules version', () => {
    const d = base();
    d.settings.complianceRulesVersion = '2025-03';
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = [invoice({ serviceCode: 'NSTD10' })];
    const findings = runCompliance(d);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.rulesVersion === '2025-03')).toBe(true);
  });

  it('excludes historical approvals from billing readiness (P6-008)', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-120) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS04', day1Date: shift(-120), consultCount: 5, interruptions: [] }];
    d.approvals = [{
      id: 'a1', patientId: 'p1', claimId: 'C1', serviceCode: 'NS04',
      approvalStartDate: shift(-30), approvalEndDate: shift(30),
      approvedHoursOrConsults: 10, poNumber: 'PO1', notes: '',
      recordStatus: 'historical',
    }];
    const state = claimBillingState(d.claims[0], d.serviceLines, d.approvals, []);
    expect(state.state).toBe('blocked-on-approval');
    expect(ruleIds(d)).toContain('ns04-needs-approval');
  });
});

describe('runCompliance — discharge & billing state', () => {
  it('flags a discharged, unbilled NS04 claim and reports blocked-on-approval', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: '', injuryDescription: '', type: 'original', status: 'discharged', day1Date: shift(-130) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS04', day1Date: shift(-130), consultCount: 6, interruptions: [] }];
    expect(ruleIds(d)).toContain('discharged-awaiting-billing');
    const state = claimBillingState(d.claims[0], d.serviceLines, d.approvals, []);
    expect(state.state).toBe('blocked-on-approval');
  });

  it('reports ready when the episode is complete and no approval is needed', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'discharged', day1Date: shift(-60) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS02', day1Date: shift(-60), lastConsultDate: shift(-2), consultCount: 8, interruptions: [] }];
    const state = claimBillingState(d.claims[0], d.serviceLines, d.approvals, []);
    expect(state.state).toBe('ready');
  });
});

describe('runCompliance — predictive', () => {
  it('warns when approaching the 25-consult cap', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-60) }];
    d.serviceLines = [{ id: 's1', claimId: 'C1', serviceCode: 'NS03', day1Date: shift(-60), consultCount: 22, interruptions: [] }];
    expect(ruleIds(d)).toContain('near-25-consults');
  });
});

describe('fix intent routing (P6-002)', () => {
  it('has no orphan fix intents on sample data', () => {
    const findings = runCompliance(sampleData());
    expect(orphanFixIntents(findings)).toEqual([]);
  });

  it('covers every fix action used in findings', () => {
    const findings = runCompliance(sampleData());
    const actions = new Set(findings.filter((f) => f.fix).map((f) => f.fix!.action));
    for (const action of actions) {
      expect(FIX_INTENT_ROUTES[action]).toBeDefined();
    }
  });

  it('flags possible double billing (same code/date/sheet)', () => {
    const d = base();
    d.claims = [{ id: 'C1', patientId: 'p1', acc45Number: 'A1', claimNumber: 'C1', poNumber: 'PO1', injuryDescription: '', type: 'original', status: 'active', day1Date: shift(-90) }];
    d.invoiceLines = [
      invoice({ serviceCode: 'NS06', invoiceDate: shift(-10), invoiceSheet: 'S1' }),
      invoice({ serviceCode: 'NS06', invoiceDate: shift(-10), invoiceSheet: 'S1' }),
    ];
    expect(ruleIds(d)).toContain('double-billing');
  });
});

describe('COMPLIANCE_RULES_VERSION', () => {
  it('defaults to March 2025 schedule', () => {
    expect(COMPLIANCE_RULES_VERSION).toBe('2025-03');
  });
});

describe('effectivePackageValue', () => {
  it('returns the calculator total when there is no override', () => {
    const det = determinePackage({ day1: shift(-40), lastConsult: shift(-2), consultCount: 8, interruptions: [] });
    expect(effectivePackageValue(det, undefined, 8)).toBe(det.totalValue);
  });

  it('scales per-consult codes (NS04) by the consult count under an override', () => {
    const det = determinePackage({ day1: shift(-40), lastConsult: shift(-2), consultCount: 8, interruptions: [] });
    const value = effectivePackageValue(det, 'NS04', 4);
    expect(value).toBeGreaterThan(0);
    expect(value).toBe(effectivePackageValue(det, 'NS04', 1) * 4);
  });
});
