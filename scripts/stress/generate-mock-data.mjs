#!/usr/bin/env node
// ============================================================================
// Configurable mock AppData generator for stress tests.
// Output goes to scripts/stress/fixtures/ (gitignored temp) — never sampleData.
// ============================================================================

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dir, 'fixtures');

const PRESETS = {
  small: { patients: 100, claimsPerPatient: 1.2, serviceLinesPerClaim: 1.5, approvalsPerClaim: 0.3, invoiceLines: 500, declines: 20, complexCases: 15, documents: 25, importHistory: 50 },
  medium: { patients: 500, claimsPerPatient: 1.5, serviceLinesPerClaim: 2, approvalsPerClaim: 0.4, invoiceLines: 3000, declines: 80, complexCases: 40, documents: 100, importHistory: 200 },
  large: { patients: 2000, claimsPerPatient: 1.8, serviceLinesPerClaim: 2.5, approvalsPerClaim: 0.5, invoiceLines: 12000, declines: 300, complexCases: 120, documents: 400, importHistory: 800 },
};

const SERVICE_CODES = ['NS01', 'NS02', 'NS03', 'NS04', 'NS05', 'NS06', 'NS07', 'NS10', 'NS20', 'NSTD10'];
const PACKAGE_CODES = ['NS01', 'NS02', 'NS03', 'NS04', 'NS05'];
const INVOICE_STATUSES = ['Awaiting Billing', 'Billed', 'Remittance'];
const DECLINE_STATUSES = [
  'Awaiting nursing docs for resubmission',
  'Awaiting response from ACC',
  'Accepted',
  'Declined again',
];
const COMPLEX_STATUSES = ['Open', 'Monitoring', 'Resolved'];

const DEFAULT_SETTINGS = {
  theme: 'clinical-light',
  accentColor: '#2f8f83',
  densityMode: 'comfortable',
  fontScale: 1,
  expiryThresholdDays: 30,
  idleLockMinutes: 15,
  encryptionEnabled: false,
  enabledServiceCodes: SERVICE_CODES,
  serviceRates: Object.fromEntries(SERVICE_CODES.map((c) => [c, 100 + SERVICE_CODES.indexOf(c) * 50])),
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function shift(days) {
  const ms = Date.parse(todayISO() + 'T00:00:00Z') + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const opts = { scale: 'medium', out: undefined };
  for (const arg of argv) {
    if (arg.startsWith('--scale=')) opts.scale = arg.slice(8);
    else if (arg.startsWith('--patients=')) opts.patients = Number(arg.slice(11));
    else if (arg.startsWith('--claims=')) opts.claims = Number(arg.slice(9));
    else if (arg.startsWith('--invoice-lines=')) opts.invoiceLines = Number(arg.slice(16));
    else if (arg.startsWith('--approvals=')) opts.approvals = Number(arg.slice(12));
    else if (arg.startsWith('--declines=')) opts.declines = Number(arg.slice(11));
    else if (arg.startsWith('--documents=')) opts.documents = Number(arg.slice(12));
    else if (arg.startsWith('--import-history=')) opts.importHistory = Number(arg.slice(17));
    else if (arg.startsWith('--out=')) opts.out = arg.slice(6);
  }
  opts.out ??= `generated-${opts.scale}.json`;
  const preset = PRESETS[opts.scale];
  if (preset) {
    opts.patients ??= preset.patients;
    opts.claimsPerPatient ??= preset.claimsPerPatient;
    opts.serviceLinesPerClaim ??= preset.serviceLinesPerClaim;
    opts.approvalsPerClaim ??= preset.approvalsPerClaim;
    opts.invoiceLines ??= preset.invoiceLines;
    opts.declines ??= preset.declines;
    opts.complexCases ??= preset.complexCases;
    opts.documents ??= preset.documents;
    opts.importHistory ??= preset.importHistory;
  }
  opts.patients ??= 500;
  opts.claimsPerPatient ??= 1.5;
  opts.serviceLinesPerClaim ??= 2;
  opts.approvalsPerClaim ??= 0.4;
  opts.invoiceLines ??= 3000;
  opts.declines ??= 80;
  opts.complexCases ??= 40;
  opts.documents ??= 100;
  opts.importHistory ??= 200;
  return opts;
}

function pick(arr, i) {
  return arr[i % arr.length];
}

export function generateMockData(opts) {
  const patients = [];
  const claims = [];
  const serviceLines = [];
  const approvals = [];
  const invoiceLines = [];
  const declines = [];
  const complexCases = [];
  const documents = [];
  const importHistory = [];

  const claimTarget = opts.claims ?? Math.round(opts.patients * opts.claimsPerPatient);

  for (let i = 0; i < opts.patients; i++) {
    patients.push({
      id: `stress_p_${i}`,
      name: `STRESS Patient ${String(i).padStart(5, '0')}`,
      nhi: `ZZS${String(i).padStart(4, '0')}`,
      dob: shift(-(1950 + (i % 50)) * 365 - (i % 365)),
      notes: i % 7 === 0 ? 'High-complexity wound care notes for search stress.' : '',
    });
  }

  for (let i = 0; i < claimTarget; i++) {
    const patient = patients[i % patients.length];
    const code = pick(PACKAGE_CODES, i);
    const needsApproval = code === 'NS04' || code === 'NS05';
    const claimId = `stress_c_${i}`;
    claims.push({
      id: claimId,
      patientId: patient.id,
      acc45Number: `A${900000 + i}`,
      claimNumber: `CLM-STRESS-${String(i).padStart(6, '0')}`,
      poNumber: i % 5 === 0 ? '' : `PO-${8000 + i}`,
      injuryDescription: `Stress injury ${i}`,
      type: i % 11 === 0 ? 'subsequent' : 'original',
      parentClaimId: i % 11 === 0 ? `stress_c_${i - 1}` : undefined,
      status: i % 13 === 0 ? 'discharged' : 'active',
      day1Date: shift(-(30 + (i % 400))),
    });

    const slCount = Math.max(1, Math.round(opts.serviceLinesPerClaim + (i % 3) * 0.5));
    for (let s = 0; s < slCount; s++) {
      const slCode = s === 0 ? code : pick(SERVICE_CODES, i + s);
      const consultCount = slCode === 'NS06' ? 10 + (i % 55) : 3 + (i % 22);
      serviceLines.push({
        id: `stress_sl_${i}_${s}`,
        claimId,
        serviceCode: slCode,
        day1Date: shift(-(60 + i % 200)),
        lastConsultDate: i % 13 === 0 ? undefined : shift(-(i % 14)),
        consultCount,
        interruptions: i % 17 === 0 ? [{ start: shift(-20), end: shift(-15) }] : [],
        approvalId: needsApproval && s === 0 && i % 4 !== 0 ? `stress_ap_${i}` : undefined,
      });
    }

    if (needsApproval && i % 4 !== 0) {
      approvals.push({
        id: `stress_ap_${i}`,
        patientId: patient.id,
        claimId,
        serviceCode: code,
        approvalStartDate: shift(-120),
        approvalEndDate: shift(30 + (i % 60)),
        approvedHoursOrConsults: code === 'NS04' ? 25 : 12,
        consultsUsed: 5 + (i % 20),
        poNumber: `PO-${8000 + i}`,
        notes: '',
        recordStatus: 'current',
      });
    } else if (needsApproval && i % 4 === 0) {
      // Intentional coverage gap for compliance stress
    }
  }

  for (let i = 0; i < opts.invoiceLines; i++) {
    const patient = patients[i % patients.length];
    const claim = claims[i % claims.length];
    const status = pick(INVOICE_STATUSES, i);
    invoiceLines.push({
      id: `stress_inv_${i}`,
      patientName: patient.name,
      nhi: patient.nhi,
      claimNumber: claim.claimNumber,
      poNumber: claim.poNumber,
      acc45Number: claim.acc45Number,
      serviceCode: pick(SERVICE_CODES, i),
      invoiceSheet: `EXT${String(i % 12 + 1).padStart(2, '0')}26`,
      invoiceDate: shift(-(i % 365)),
      amountInvoiced: 80 + (i % 400),
      datePaid: status === 'Remittance' ? shift(-(i % 30)) : undefined,
      amountPaid: status === 'Remittance' ? 80 + (i % 400) : undefined,
      status,
      notes: '',
    });
  }

  for (let i = 0; i < opts.declines; i++) {
    const patient = patients[i % patients.length];
    const claim = claims[i % claims.length];
    declines.push({
      id: `stress_dec_${i}`,
      patientId: patient.id,
      claimId: claim.id,
      patientName: patient.name,
      claimNumber: claim.claimNumber,
      declineReceivedDate: shift(-(10 + i % 90)),
      servicePeriodDeclined: 'Jan–Mar 2026',
      reason: `Stress decline reason ${i}`,
      status: pick(DECLINE_STATUSES, i),
      notes: '',
    });
  }

  for (let i = 0; i < opts.complexCases; i++) {
    const patient = patients[i % patients.length];
    const claim = claims[i % claims.length];
    complexCases.push({
      id: `stress_cx_${i}`,
      patientName: patient.name,
      claimNumber: claim.claimNumber,
      dateLogged: shift(-60),
      whatsUnusual: 'Stress complex case',
      decisionMade: 'Monitor',
      decidedBy: 'Coordinator',
      dateDecided: shift(-30),
      followUpNeeded: 'Review billing',
      nextReviewDate: shift(-(i % 5)),
      status: pick(COMPLEX_STATUSES, i),
      notes: '',
    });
  }

  for (let i = 0; i < opts.documents; i++) {
    const claim = claims[i % claims.length];
    documents.push({
      id: `stress_doc_${i}`,
      claimId: claim.id,
      kind: i % 3 === 0 ? 'acc-decline-letter' : 'acc-approval-letter',
      fileName: `stress-letter-${i}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 12000 + (i % 5000),
      addedDate: shift(-(i % 180)),
    });
  }

  const kinds = ['approval', 'decline', 'document-only'];
  for (let i = 0; i < opts.importHistory; i++) {
    const patient = patients[i % patients.length];
    const claim = claims[i % claims.length];
    importHistory.push({
      id: `stress_ih_${i}`,
      fileName: `import-${i}.pdf`,
      kind: pick(kinds, i),
      patientId: patient.id,
      claimId: claim.id,
      importedAt: Date.now() - i * 3600000,
      sizeBytes: 8000 + (i % 3000),
    });
  }

  return {
    schemaVersion: 1,
    patients,
    claims,
    serviceLines,
    approvals,
    invoiceLines,
    complexCases,
    declines,
    settings: { ...DEFAULT_SETTINGS },
    documents,
    importHistory,
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const data = generateMockData(opts);
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const outPath = join(FIXTURES_DIR, opts.out);
  writeFileSync(outPath, JSON.stringify(data));
  const manifest = {
    generatedAt: new Date().toISOString(),
    scale: opts.scale,
    outFile: opts.out,
    counts: {
      patients: data.patients.length,
      claims: data.claims.length,
      serviceLines: data.serviceLines.length,
      approvals: data.approvals.length,
      invoiceLines: data.invoiceLines.length,
      declines: data.declines.length,
      complexCases: data.complexCases.length,
      documents: data.documents.length,
      importHistory: data.importHistory.length,
    },
    bytes: JSON.stringify(data).length,
  };
  writeFileSync(join(FIXTURES_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Generated ${outPath} (${manifest.bytes.toLocaleString()} bytes)`);
  console.log(JSON.stringify(manifest.counts, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
