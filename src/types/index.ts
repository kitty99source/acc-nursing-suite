// ============================================================================
// Core domain types for the ACC District Nursing Admin Suite.
// All dates are stored as ISO date strings ("YYYY-MM-DD") unless noted.
// ============================================================================

// Value import used only to seed DEFAULT_SETTINGS below. serviceCodes.ts imports
// this module with `import type` only, so this is a one-way runtime dependency
// (no import cycle at runtime).
import { ALL_SERVICE_CODES, DEFAULT_RATES } from '../lib/serviceCodes';

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
  // For approval-based codes (NS04/NS05) the line links to an Approval record
  // instead of being driven by the package date fields above.
  approvalId?: string;
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
  /** Local assignee for renewal follow-up (P6-005). */
  renewalAssignee?: string;
  notes: string;
  /** Latest period for billing/expiry; older imported rows are historical. */
  recordStatus?: 'current' | 'historical';
  /** IndexedDB document id when imported from a letter PDF. */
  sourceDocumentId?: string;
  // Unrecognised columns absorbed during Excel import, preserved for round-trip.
  customFields?: Record<string, string>;
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
  // Unrecognised columns absorbed during Excel import, preserved for round-trip.
  customFields?: Record<string, string>;
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
  // Unrecognised columns absorbed during Excel import, preserved for round-trip.
  customFields?: Record<string, string>;
}

export type DeclineStatus =
  | 'Awaiting nursing docs for resubmission'
  | 'Awaiting response from ACC'
  | 'Accepted'
  | 'Declined again';

export interface Decline {
  id: string;
  patientId?: string;
  claimId?: string;
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
  sourceDocumentId?: string;
  // Unrecognised columns absorbed during Excel import, preserved for round-trip.
  customFields?: Record<string, string>;
}

// A worksheet imported from Excel whose name/shape isn't part of the core
// schema. Preserved verbatim so imports are lossless and can be re-exported.
export interface CustomSheet {
  name: string;
  headers: string[];
  rows: Record<string, string>[];
}

// What a stored document represents.
export type DocumentKind = 'acc-approval-letter' | 'acc-decline-letter' | 'approval-request' | 'other';

// Metadata for a file attached to a claim. The actual file bytes are NOT stored
// here — they live in a separate IndexedDB object store keyed by `id`, so the
// main data blob (and every autosave) stays small regardless of how many files
// are attached. See src/lib/idb.ts.
export interface ClaimDocument {
  id: string; // also the IndexedDB blob key
  claimId: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  addedDate: string; // ISO date
  notes?: string;
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
  /** Production config — disables letter auto-commit and dev-only recovery paths. */
  productionMode: boolean;
  /** Dev-only: allow 100% confidence letters to auto-file (requires productionMode false). */
  letterImportAutoCommit: boolean;
  /** Days without a .accdata export before backup reminder modal (U-14 default 7). */
  backupReminderDays: number;
  /** Days in Remittance before surfacing in action queue (P6-004). */
  remittanceStaleDays: number;
  /** ACC contract-compliance rule set version tag (P6-001). */
  complianceRulesVersion: string;
  /** Local display name for audit trail (P4-002). */
  userDisplayName: string;
  /** Hold folder watch / inbox automation (P8-005). */
  automationPaused: boolean;
  /** ACC Inbox sender allowlist fragments (P8-018). */
  accInboxSenderAllowlist: string[];
  /** ACC Inbox subject regex patterns as strings (P8-018). */
  accInboxSubjectPatterns: string[];
  /** Dismiss dashboard letter-import discoverability card (P5-014). */
  dismissLetterDiscoverCard: boolean;
  // Defaults to every code; lets an office hide the ones they never use.
  enabledServiceCodes: ServiceCode[];
  // Editable per-contract rates (dollars excl GST) keyed by service code.
  // Seeded from the current ACC schedule but fully editable — ACC updates
  // its prices, so there is no fixed "default" to reset to.
  serviceRates: Record<ServiceCode, number>;
}

/** Local-only log of recent ACC letter imports (not exported separately). */
export interface ImportHistoryEntry {
  id: string;
  fileName: string;
  kind: 'approval' | 'decline' | 'document-only';
  patientId?: string;
  claimId?: string;
  importedAt: number;
  sizeBytes?: number;
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
  // Generic tables absorbed from Excel sheets that aren't part of the schema.
  customSheets?: CustomSheet[];
  // Metadata for files attached to claims (ACC approval letters, requests we
  // sent, etc.). File bytes live in IndexedDB, not here.
  documents: ClaimDocument[];
  importHistory?: ImportHistoryEntry[];
}

export const SCHEMA_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = {
  theme: 'clinical-light',
  accentColor: '#2f8f83',
  densityMode: 'comfortable',
  fontScale: 1,
  expiryThresholdDays: 30,
  idleLockMinutes: 15,
  encryptionEnabled: false,
  quickPasteInEnabled: true,
  productionMode: true,
  letterImportAutoCommit: false,
  backupReminderDays: 7,
  remittanceStaleDays: 60,
  complianceRulesVersion: '2025-03',
  userDisplayName: '',
  automationPaused: false,
  accInboxSenderAllowlist: [
    'Bec.Williams@acc.co.nz',
    'John.Bentley@acc.co.nz',
    'Becky.Tunnell@acc.co.nz',
    'nursing@acc.co.nz',
    'acc.co.nz',
    'acc.govt.nz',
  ],
  accInboxSubjectPatterns: [
    'approv',
    'declin',
    'nur0[245]',
    'purchase order',
    'PO\\s*number',
    'ACC\\s+letter',
  ],
  dismissLetterDiscoverCard: false,
  enabledServiceCodes: [...ALL_SERVICE_CODES],
  serviceRates: { ...DEFAULT_RATES },
};
