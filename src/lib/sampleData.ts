import type { AppData } from '../types';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../types';
import { todayISO } from './format';

// ============================================================================
// Obviously-fake sample data so the app is explorable on first run.
// Cleared via Settings → "Clear sample data" or "Start a fresh empty file".
// ============================================================================

function shift(days: number): string {
  const ms = Date.parse(todayISO() + 'T00:00:00Z') + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function emptyData(): AppData {
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
  };
}

export function sampleData(): AppData {
  const base = emptyData();

  base.patients = [
    { id: 'p_sample_1', name: 'SAMPLE — Aroha Brown', nhi: 'ZZZ0001', dob: '1958-04-12', notes: 'Sample patient. Diabetic foot wound.' },
    { id: 'p_sample_2', name: 'SAMPLE — John Smith', nhi: 'ZZZ0002', dob: '1971-11-02', notes: 'Sample patient. Post-surgical wound care.' },
    { id: 'p_sample_3', name: 'SAMPLE — Mere Tane', nhi: 'ZZZ0003', dob: '1949-07-21', notes: 'Sample patient. Complex ongoing nursing needs.' },
  ];

  base.claims = [
    {
      id: 'c_sample_1', patientId: 'p_sample_1', acc45Number: 'A100001', claimNumber: 'CLM-1001',
      poNumber: 'PO-5001', injuryDescription: 'Laceration left lower leg', type: 'original',
      status: 'active', day1Date: shift(-40),
    },
    {
      id: 'c_sample_2', patientId: 'p_sample_2', acc45Number: 'A100002', claimNumber: 'CLM-1002',
      poNumber: 'PO-5002', injuryDescription: 'Post-op abdominal wound', type: 'original',
      status: 'active', day1Date: shift(-120),
    },
    {
      id: 'c_sample_3', patientId: 'p_sample_3', acc45Number: 'A100003', claimNumber: 'CLM-1003',
      poNumber: 'PO-5003', injuryDescription: 'Pressure injury, sacrum', type: 'original',
      status: 'active', day1Date: shift(-300),
    },
  ];

  base.serviceLines = [
    {
      id: 'sl_sample_1', claimId: 'c_sample_1', serviceCode: 'NS02', day1Date: shift(-40),
      lastConsultDate: shift(-2), consultCount: 8, interruptions: [],
    },
    {
      id: 'sl_sample_2', claimId: 'c_sample_2', serviceCode: 'NS03', day1Date: shift(-120),
      lastConsultDate: shift(-1), consultCount: 16, interruptions: [],
    },
    {
      id: 'sl_sample_3', claimId: 'c_sample_3', serviceCode: 'NS05', day1Date: shift(-300),
      lastConsultDate: shift(-3), consultCount: 40, interruptions: [],
    },
  ];

  base.approvals = [
    {
      id: 'ap_sample_1', patientId: 'p_sample_2', claimId: 'c_sample_2', serviceCode: 'NS04',
      approvalStartDate: shift(-30), approvalEndDate: shift(20), approvedHoursOrConsults: 12,
      consultsUsed: 10, accEmailedRenewalDate: undefined, poNumber: 'PO-5002',
      notes: 'Extended nursing approved for wound complications.',
    },
    {
      id: 'ap_sample_2', patientId: 'p_sample_3', claimId: 'c_sample_3', serviceCode: 'NS05',
      approvalStartDate: shift(-200), approvalEndDate: shift(-5), approvedHoursOrConsults: 48,
      consultsUsed: 46, accEmailedRenewalDate: shift(-12), poNumber: 'PO-5003',
      notes: 'Annual review / renewal in progress — EXPIRED, chase ACC.',
    },
  ];

  base.invoiceLines = [
    {
      id: 'inv_sample_1', patientName: 'SAMPLE — John Smith', nhi: 'ZZZ0002', claimNumber: 'CLM-1002',
      poNumber: 'PO-5002', acc45Number: 'A100002', serviceCode: 'NS03', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-15), amountInvoiced: 2275.42, datePaid: shift(-3), amountPaid: 2275.42,
      status: 'Billed', notes: '',
    },
    {
      id: 'inv_sample_2', patientName: 'SAMPLE — John Smith', nhi: 'ZZZ0002', claimNumber: 'CLM-1002',
      poNumber: 'PO-5002', acc45Number: 'A100002', serviceCode: 'NS04', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-10), amountInvoiced: 1096.90, datePaid: undefined, amountPaid: undefined,
      status: 'Remittance', notes: '10 x NS04 consults; awaiting remittance.',
    },
    {
      id: 'inv_sample_3', patientName: 'SAMPLE — Aroha Brown', nhi: 'ZZZ0001', claimNumber: 'CLM-1001',
      poNumber: 'PO-5001', acc45Number: 'A100001', serviceCode: 'NS02', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-1), amountInvoiced: 1173.13, datePaid: undefined, amountPaid: undefined,
      status: 'Awaiting Billing', notes: 'Package not yet complete — hold until discharge.',
    },
    {
      id: 'inv_sample_4', patientName: 'SAMPLE — Mere Tane', nhi: 'ZZZ0003', claimNumber: 'CLM-1003',
      poNumber: 'PO-5003', acc45Number: 'A100003', serviceCode: 'NS05', invoiceSheet: 'EXTFEB26',
      invoiceDate: shift(-65), amountInvoiced: 1971.60, datePaid: undefined, amountPaid: undefined,
      status: 'Remittance', notes: '20 hrs NS05; 65 days outstanding.',
    },
    {
      id: 'inv_sample_5', patientName: 'SAMPLE — Mere Tane', nhi: 'ZZZ0003', claimNumber: 'CLM-1003',
      poNumber: 'PO-5003', acc45Number: 'A100003', serviceCode: 'NS06', invoiceSheet: 'EXTFEB26',
      invoiceDate: shift(-50), amountInvoiced: 371.60, datePaid: shift(-20), amountPaid: 371.60,
      status: 'Billed', notes: '',
    },
  ];

  base.complexCases = [
    {
      id: 'cx_sample_1', patientName: 'SAMPLE — Mere Tane', claimNumber: 'CLM-1003',
      dateLogged: shift(-60), whatsUnusual: 'Multiple overlapping injuries; subsequent injury may become primary.',
      decisionMade: 'Hold reassessment until original wound healed; new Day 1 at reassessment.',
      decidedBy: 'Recovery Team / Nurse Lead', dateDecided: shift(-55),
      followUpNeeded: 'Confirm reassessment date and re-run package calculator.',
      nextReviewDate: shift(-2), status: 'Monitoring', notes: 'Review date has passed — follow up.',
    },
  ];

  base.declines = [
    {
      id: 'dc_sample_1', patientName: 'SAMPLE — Aroha Brown', claimNumber: 'CLM-1001',
      declineReceivedDate: shift(-25), servicePeriodDeclined: 'NS02 package, Feb 2026',
      reason: 'Insufficient clinical documentation supplied with claim.',
      dateNurseEmailed: shift(-22), dateResubmissionRequested: shift(-10),
      outcome: undefined, dateOutcomeReceived: undefined,
      status: 'Awaiting response from ACC', notes: 'Nurse supplied updated notes; resubmitted.',
    },
  ];

  return base;
}

export function isSampleData(data: AppData): boolean {
  return data.patients.some((p) => p.id.startsWith('p_sample_'));
}
