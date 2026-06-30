// ============================================================================
// Core domain types for the ACC District Nursing Admin Suite.
// All dates are stored as ISO date strings ("YYYY-MM-DD") unless noted.
// ============================================================================

export type ServiceCode =
  | 'NS01'
  | 'NS02'
  | 'NS03'
  | 'NS04'
  | 'NS05'
  | 'NS06'
  | 'NS07'
  | 'NS10'
  | 'NS20'
  | 'NS20T'
  | 'NSTD10'
  | 'NSTT1'
  | 'NSTT1D'
  | 'NSAC';

export interface Patient {
  id: string;
  name: string;
  nhi: string;
  dob: string; // ISO date
  notes: string;
}

export type ClaimType = 'original' | 'subsequent';
export type ClaimStatus = 'active' | 'discharged';

export interface Claim {
  id: string;
  patientId: string;
  acc45Number: string;
  claimNumber: string;
  poNumber: string;
  injuryDescription: string;
  type: ClaimType;
  parentClaimId?: string;
  status: ClaimStatus;
  day1Date: string; // ISO date
}

export interface Interruption {
  start: string; // ISO date
  end: string; // ISO date
}

export interface ServiceLine {
  id: string;
  claimId: string;
  serviceCode: ServiceCode;
  day1Date: string; // ISO date
  lastConsultDate?: string; // ISO date; undefined => ongoing
  consultCount: number;
  interruptions: Interruption[];
  // recommendedPackage is computed on demand by the calculator engine and
  // stored here as a cached snapshot of the most recent determination.
  recommendedPackage?: string;
  overridePackage?: ServiceCode;
  overrideReason?: string;
}

export type ApprovalServiceCode = 'NS04' | 'NS05';
export type ApprovalStatus = 'Active' | 'Expiring Soon (<30 days)' | 'EXPIRED';

export interface Approval {
  id: string;
  patientId: string;
  claimId: string;
  serviceCode: ApprovalServiceCode;
  approvalStartDate: string; // ISO date
  approvalEndDate: string; // ISO date (PO expiry)
  approvedHoursOrConsults: number;
  consultsUsed?: number;
  accEmailedRenewalDate?: string; // ISO date
  poNumber: string;
  notes: string;
}

export type InvoiceStatus = 'Awaiting Billing' | 'Billed' | 'Remittance';

export interface InvoiceLine {
  id: string;
  patientName: string;
  nhi: string;
  claimNumber: string;
  poNumber: string;
  acc45Number: string;
  serviceCode: ServiceCode;
  invoiceSheet: string; // e.g. "EXTMAR26"
  invoiceDate: string; // ISO date
  amountInvoiced: number;
  datePaid?: string; // ISO date
  amountPaid?: number;
  status: InvoiceStatus;
  notes: string;
}

export type ComplexCaseStatus = 'Open' | 'Monitoring' | 'Resolved';

export interface ComplexCase {
  id: string;
  patientName: string;
  claimNumber: string;
  dateLogged: string; // ISO date
  whatsUnusual: string;
  decisionMade: string;
  decidedBy: string;
  dateDecided: string; // ISO date
  followUpNeeded: string;
  nextReviewDate: string; // ISO date
  status: ComplexCaseStatus;
  notes: string;
}

export type DeclineStatus =
  | 'Awaiting nursing docs for resubmission'
  | 'Awaiting response from ACC'
  | 'Accepted'
  | 'Declined again';

export interface Decline {
  id: string;
  patientName: string;
  claimNumber: string;
  declineReceivedDate: string; // ISO date
  servicePeriodDeclined: string;
  reason: string;
  dateNurseEmailed?: string; // ISO date
  dateResubmissionRequested?: string; // ISO date
  outcome?: string;
  dateOutcomeReceived?: string; // ISO date
  status: DeclineStatus;
  notes: string;
}

export type ThemeName = 'clinical-light' | 'warm-light' | 'dark' | 'high-contrast';
export type DensityMode = 'comfortable' | 'compact';

export interface Settings {
  theme: ThemeName;
  accentColor: string; // hex
  densityMode: DensityMode;
  fontScale: number; // 0.85 - 1.3
  expiryThresholdDays: number; // default 30
  idleLockMinutes: number; // default 15
  encryptionEnabled: boolean;
  quickPasteInEnabled: boolean; // default true
}

export interface AppData {
  schemaVersion: number;
  patients: Patient[];
  claims: Claim[];
  serviceLines: ServiceLine[];
  approvals: Approval[];
  invoiceLines: InvoiceLine[];
  complexCases: ComplexCase[];
  declines: Decline[];
  settings: Settings;
}

export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'clinical-light',
  accentColor: '#2f8f83',
  densityMode: 'comfortable',
  fontScale: 1,
  expiryThresholdDays: 30,
  idleLockMinutes: 15,
  encryptionEnabled: false,
  quickPasteInEnabled: true,
};
