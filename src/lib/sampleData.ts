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
    documents: [],
  };
}

export function sampleData(): AppData {
  const base = emptyData();

  base.patients = [
    { id: 'p_sample_1', name: 'SAMPLE — Aroha Brown', nhi: 'ZZZ0001', dob: '1958-04-12', notes: 'Sample patient. Diabetic foot wound.' },
    { id: 'p_sample_2', name: 'SAMPLE — John Smith', nhi: 'ZZZ0002', dob: '1971-11-02', notes: 'Sample patient. Post-surgical wound care.' },
    { id: 'p_sample_3', name: 'SAMPLE — Mere Tane', nhi: 'ZZZ0003', dob: '1949-07-21', notes: 'Sample patient. Complex ongoing nursing needs.' },
    { id: 'p_sample_4', name: 'SAMPLE — Wiremu Kaha', nhi: 'ZZZ0004', dob: '1965-02-09', notes: 'Sample patient. High-frequency subsequent-injury treatments.' },
    { id: 'p_sample_5', name: 'SAMPLE — Grace Lee', nhi: 'ZZZ0005', dob: '1980-06-30', notes: 'Sample patient. Discharged, billing on hold.' },
    { id: 'p_sample_6', name: 'SAMPLE — Tui Ngata', nhi: 'ZZZ0006', dob: '1972-09-15', notes: 'Sample patient. Package in progress — early-warning demo.' },
    { id: 'p_sample_george', name: 'SAMPLE — George Bellingham', nhi: 'ABC1234', dob: '1945-03-12', notes: 'Demo patient for ACC approval letter import (matches approval fixture).' },
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
    // Compliance demo — trips "over 50 NS06 on one claim" (Schedule 6.1.2).
    {
      id: 'c_sample_4', patientId: 'p_sample_4', acc45Number: 'A100004', claimNumber: 'CLM-1004',
      poNumber: 'PO-5004', injuryDescription: 'Recurrent cellulitis, right leg', type: 'original',
      status: 'active', day1Date: shift(-95),
    },
    // Compliance demo — discharged, NS04 with no approval on file, not yet billed.
    {
      id: 'c_sample_5', patientId: 'p_sample_5', acc45Number: 'A100005', claimNumber: 'CLM-1005',
      poNumber: '', injuryDescription: 'Complex wound, extended care', type: 'original',
      status: 'discharged', day1Date: shift(-130),
    },
    // Compliance demo — exceeds the 25-consult package cap without NS04.
    {
      id: 'c_sample_6', patientId: 'p_sample_5', acc45Number: 'A100006', claimNumber: 'CLM-1006',
      poNumber: 'PO-5006', injuryDescription: 'Long-running package, high consults', type: 'original',
      status: 'active', day1Date: shift(-90),
    },
    // Compliance demo — two packages billed on one claim with no distinct PO.
    {
      id: 'c_sample_7', patientId: 'p_sample_4', acc45Number: 'A100007', claimNumber: 'CLM-1007',
      poNumber: '', injuryDescription: 'Two episodes billed, missing second PO', type: 'original',
      status: 'active', day1Date: shift(-70),
    },
    // Compliance demo — predictive heads-ups (approaching the 25-consult cap; first NS07 used).
    {
      id: 'c_sample_8', patientId: 'p_sample_6', acc45Number: 'A100008', claimNumber: 'CLM-1008',
      poNumber: 'PO-5008', injuryDescription: 'Ongoing wound care, nearing cap', type: 'original',
      status: 'active', day1Date: shift(-55),
    },
    // Compliance demo — travel billed with no NS05/NS07/NS20 to justify it.
    {
      id: 'c_sample_9', patientId: 'p_sample_6', acc45Number: 'A100009', claimNumber: 'CLM-1009',
      poNumber: 'PO-5009', injuryDescription: 'Rural visit, travel billed alone', type: 'original',
      status: 'active', day1Date: shift(-30),
    },
    {
      id: 'c_sample_george', patientId: 'p_sample_george', acc45Number: 'YN65488', claimNumber: '10000000149',
      poNumber: '', injuryDescription: 'Demo claim for letter import', type: 'original',
      status: 'active', day1Date: '2024-02-19',
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
      lastConsultDate: shift(-3), consultCount: 40, interruptions: [], approvalId: 'ap_sample_2',
    },
    // Discharged NS04 with no linked approval → coverage/compliance flag.
    {
      id: 'sl_sample_5', claimId: 'c_sample_5', serviceCode: 'NS04', day1Date: shift(-130),
      lastConsultDate: undefined, consultCount: 8, interruptions: [],
    },
    // Ongoing package well past the 25-consult cap with no NS04.
    {
      id: 'sl_sample_6', claimId: 'c_sample_6', serviceCode: 'NS02', day1Date: shift(-90),
      lastConsultDate: undefined, consultCount: 30, interruptions: [],
    },
    // Ongoing package approaching the 25-consult cap → predictive heads-up.
    {
      id: 'sl_sample_8', claimId: 'c_sample_8', serviceCode: 'NS03', day1Date: shift(-55),
      lastConsultDate: undefined, consultCount: 23, interruptions: [],
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
    // Two packages billed on CLM-1007 with no distinct PO → needs an ACC179.
    {
      id: 'inv_sample_6', patientName: 'SAMPLE — Wiremu Kaha', nhi: 'ZZZ0004', claimNumber: 'CLM-1007',
      poNumber: '', acc45Number: 'A100007', serviceCode: 'NS01', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-40), amountInvoiced: 600, datePaid: undefined, amountPaid: undefined,
      status: 'Billed', notes: 'First package.',
    },
    {
      id: 'inv_sample_7', patientName: 'SAMPLE — Wiremu Kaha', nhi: 'ZZZ0004', claimNumber: 'CLM-1007',
      poNumber: '', acc45Number: 'A100007', serviceCode: 'NS01', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-8), amountInvoiced: 600, datePaid: undefined, amountPaid: undefined,
      status: 'Billed', notes: 'Second package — missing its own PO.',
    },
    // First NS07 used on CLM-1008 → predictive "next one needs approval".
    {
      id: 'inv_sample_8', patientName: 'SAMPLE — Tui Ngata', nhi: 'ZZZ0006', claimNumber: 'CLM-1008',
      poNumber: 'PO-5008', acc45Number: 'A100008', serviceCode: 'NS07', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-12), amountInvoiced: 156.20, datePaid: undefined, amountPaid: undefined,
      status: 'Awaiting Billing', notes: 'First oversight consultation.',
    },
    // Travel billed alone on CLM-1009 → violation (no eligible companion service).
    {
      id: 'inv_sample_9', patientName: 'SAMPLE — Tui Ngata', nhi: 'ZZZ0006', claimNumber: 'CLM-1009',
      poNumber: 'PO-5009', acc45Number: 'A100009', serviceCode: 'NSTD10', invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-9), amountInvoiced: 74.30, datePaid: undefined, amountPaid: undefined,
      status: 'Awaiting Billing', notes: 'Travel over 10km — needs an eligible service on the claim.',
    },
  ];

  // Compliance demo — 52 NS06 treatments on CLM-1004 trips the 50-cap rule
  // (Schedule 6.1.2). Distinct dates so they are not flagged as duplicates.
  for (let i = 0; i < 52; i++) {
    base.invoiceLines.push({
      id: `inv_ns06_${i}`,
      patientName: 'SAMPLE — Wiremu Kaha',
      nhi: 'ZZZ0004',
      claimNumber: 'CLM-1004',
      poNumber: 'PO-5004',
      acc45Number: 'A100004',
      serviceCode: 'NS06',
      invoiceSheet: 'EXTMAR26',
      invoiceDate: shift(-90 + i),
      amountInvoiced: 92.9,
      datePaid: undefined,
      amountPaid: undefined,
      status: 'Billed',
      notes: '',
    });
  }

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
