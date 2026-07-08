// ============================================================================
// P5-001 — synthetic ACC letter corpus (U-05: synthetic fixtures approved).
//
// Each entry is a fake NUR02 approval or NUR04VEN decline letter. The `.txt`
// files hold the *text layer* exactly as pdf.js / mammoth flatten it out of a
// real PDF or .docx, so the parser (`parseApprovalLetter` / `parseDeclineLetter`)
// can be regression-tested without shipping large binary blobs or generating
// PDFs offline (no heavy deps in prod).
//
// `format` records which container the text layer represents (pdf vs docx) so
// the corpus documents the intended PDF/.docx mix; the binary extraction path
// itself is covered separately by approval-template.pdf / .docx / decline-template.pdf.
//
// All names, NHIs, claim numbers, ACC45 numbers and PO numbers are INVENTED.
// No PHI. See README note in letterImport.test.ts for how the snapshots lock in.
// ============================================================================

import type { ApprovalServiceCode } from '../../../types';

export type CorpusFormat = 'pdf' | 'docx';

export interface LetterCorpusExpectation {
  kind: 'approval' | 'decline';
  claimNumber: string;
  nhi?: string;
  patientName?: string;
  /** Distinct NS04/NS05 service-row codes expected on the letter. */
  serviceRowCodes?: ApprovalServiceCode[];
  serviceRowCount?: number;
  /** Package (NS01–NS03) codes expected. */
  packageRowCodes?: string[];
  /** Regex source that the extracted decline reason must match. */
  reasonMatch?: string;
  /** Decline reason expected to be absent (parser could not extract one). */
  reasonMissing?: boolean;
  serviceRequested?: string;
  hasAlternateClaims?: boolean;
  /** Expect at least one hard blocker from scoring (e.g. missing PO). */
  expectBlockers?: boolean;
  /** Expect a body-vs-header name mismatch issue. */
  expectNameMismatch?: boolean;
}

export interface LetterCorpusEntry {
  id: string;
  /** File name inside src/lib/fixtures/letters/. */
  file: string;
  format: CorpusFormat;
  variant: string;
  expect: LetterCorpusExpectation;
}

export const LETTER_CORPUS: LetterCorpusEntry[] = [
  {
    id: 'approval-ns04-basic',
    file: 'approval-ns04-basic.txt',
    format: 'pdf',
    variant: 'Single NS04 approval',
    expect: {
      kind: 'approval',
      claimNumber: '10000000149',
      nhi: 'ABC1234',
      patientName: 'George Bellingham',
      serviceRowCodes: ['NS04'],
      serviceRowCount: 1,
    },
  },
  {
    id: 'approval-ns04-series',
    file: 'approval-ns04-series.txt',
    format: 'docx',
    variant: 'Multiple sequential NS04 rows (historical + current)',
    expect: {
      kind: 'approval',
      claimNumber: '10000221200',
      nhi: 'DEF5678',
      patientName: 'Harriet Windsor',
      serviceRowCodes: ['NS04'],
      serviceRowCount: 3,
    },
  },
  {
    id: 'approval-ns05-consults',
    file: 'approval-ns05-consults.txt',
    format: 'pdf',
    variant: 'NS05 consult rows',
    expect: {
      kind: 'approval',
      claimNumber: '10000334455',
      nhi: 'GHI9012',
      patientName: 'Ihaka Ngata',
      serviceRowCodes: ['NS05'],
      serviceRowCount: 2,
    },
  },
  {
    id: 'approval-mixed-package',
    file: 'approval-mixed-package.txt',
    format: 'docx',
    variant: 'Mixed NS04 + NS05 service rows with NS03 package row',
    expect: {
      kind: 'approval',
      claimNumber: '10000556677',
      nhi: 'JKL3456',
      patientName: 'Tanya Fisher',
      serviceRowCodes: ['NS04', 'NS05'],
      serviceRowCount: 2,
      packageRowCodes: ['NS03'],
    },
  },
  {
    id: 'approval-name-mismatch',
    file: 'approval-name-mismatch.txt',
    format: 'pdf',
    variant: 'Body name differs from client-details name',
    expect: {
      kind: 'approval',
      claimNumber: '10000778899',
      nhi: 'MNO7890',
      patientName: 'Margaret Chen',
      serviceRowCodes: ['NS04'],
      serviceRowCount: 1,
      expectNameMismatch: true,
    },
  },
  {
    id: 'approval-missing-po',
    file: 'approval-missing-po.txt',
    format: 'pdf',
    variant: 'Approval with no purchase order number (blocker)',
    expect: {
      kind: 'approval',
      claimNumber: '10000990011',
      nhi: 'PQR2345',
      patientName: 'Selina Roberts',
      serviceRowCodes: ['NS04'],
      serviceRowCount: 1,
      expectBlockers: true,
    },
  },
  {
    id: 'decline-standard',
    file: 'decline-standard.txt',
    format: 'pdf',
    variant: 'Standard decline with reason',
    expect: {
      kind: 'decline',
      claimNumber: '10000460000',
      nhi: 'XYZ9876',
      patientName: 'Mille Butter',
      serviceRequested: 'Extended Nursing',
      reasonMatch: 'missing nursing consultation notes',
    },
  },
  {
    id: 'decline-alt-claims',
    file: 'decline-alt-claims.txt',
    format: 'docx',
    variant: 'Decline referencing an alternate claim number',
    expect: {
      kind: 'decline',
      claimNumber: '10000512345',
      nhi: 'STU4567',
      patientName: 'Derek Pohatu',
      serviceRequested: 'Extended Nursing',
      reasonMatch: 'insufficient clinical evidence',
      hasAlternateClaims: true,
    },
  },
  {
    id: 'decline-missing-reason',
    file: 'decline-missing-reason.txt',
    format: 'pdf',
    variant: 'Decline where the reason could not be extracted',
    expect: {
      kind: 'decline',
      claimNumber: '10000633221',
      nhi: 'VWX8901',
      patientName: 'Aroha Wiremu',
      serviceRequested: 'Extended Nursing',
      reasonMissing: true,
    },
  },
  {
    id: 'decline-community-nursing',
    file: 'decline-community-nursing.txt',
    format: 'docx',
    variant: 'Decline for a service outside the approved package',
    expect: {
      kind: 'decline',
      claimNumber: '10000744556',
      nhi: 'YZA1234',
      patientName: 'Priya Naidu',
      serviceRequested: 'Extended Nursing',
      reasonMatch: 'outside the approved package',
    },
  },
];
