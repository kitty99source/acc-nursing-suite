// ============================================================================
// Shared letter commit helper — used by LetterImportModal and the Review
// final-patient-form panel so both paths create patient + claim identically.
// ============================================================================

import type { Claim, Patient } from '../types';
import type { LetterImportCommitResult } from '../state/store';
import type {
  ParsedApprovalLetter,
  ParsedDeclineLetter,
  ParsedLetter,
  ParsedPackageRow,
  ParsedServiceRow,
} from './letterImport';
import { assignRecordStatus } from './letterImport';
import {
  isStagingParsedPreview,
  previewToFile,
  type StagingParsedPreview,
} from './hrqBatch';
import type { StagingItem } from './staging';

export interface LetterCommitFormFields {
  patientName: string;
  nhi: string;
  dob: string;
  claimNumber: string;
  acc45: string;
  poNumber: string;
  injury: string;
  day1: string;
  declineReason: string;
  servicePeriodDeclined: string;
  letterDate: string;
  rows: ParsedServiceRow[];
  selectedPatientId: string;
  selectedClaimId: string;
}

export interface LetterCommitDeps {
  commitParsedApproval: (
    parsed: ParsedApprovalLetter,
    file: File,
    opts: {
      patientId?: string;
      claimId?: string;
      patientPatch?: Partial<Patient>;
      claimPatch?: Partial<Claim>;
      rows: ParsedServiceRow[];
      historicRows?: ParsedPackageRow[];
    },
  ) => Promise<LetterImportCommitResult>;
  commitParsedDecline: (
    parsed: ParsedDeclineLetter,
    file: File,
    opts: {
      patientName?: string;
      claimNumber?: string;
      reason?: string;
      servicePeriodDeclined?: string;
      declineReceivedDate?: string;
      patientId?: string;
      claimId?: string;
    },
  ) => Promise<LetterImportCommitResult>;
}

export function emptyLetterCommitForm(): LetterCommitFormFields {
  return {
    patientName: '',
    nhi: '',
    dob: '',
    claimNumber: '',
    acc45: '',
    poNumber: '',
    injury: '',
    day1: '',
    declineReason: '',
    servicePeriodDeclined: '',
    letterDate: '',
    rows: [],
    selectedPatientId: '',
    selectedClaimId: '',
  };
}

/** Prefill editable form fields from a staging parsedPreview (when present). */
export function formFieldsFromPreview(preview: StagingParsedPreview): LetterCommitFormFields {
  const patient = preview.patientPatch ?? {};
  const claim = preview.claimPatch ?? {};
  return {
    patientName: patient.name?.trim() || preview.patientName || '',
    nhi: patient.nhi ?? '',
    dob: patient.dob ?? '',
    claimNumber: claim.claimNumber ?? preview.claimNumber ?? '',
    acc45: claim.acc45Number ?? '',
    poNumber: claim.poNumber ?? '',
    injury: claim.injuryDescription ?? '',
    day1: claim.day1Date ?? '',
    declineReason: preview.reason ?? '',
    servicePeriodDeclined: preview.servicePeriodDeclined ?? '',
    letterDate: preview.parsed.letterDate ?? '',
    rows:
      preview.kind === 'approval'
        ? (preview.rows?.length
            ? preview.rows.map((r) => ({ ...r }))
            : preview.parsed.kind === 'approval'
              ? assignRecordStatus(preview.parsed.serviceRows)
              : [])
        : [],
    selectedPatientId: preview.patientId ?? '',
    selectedClaimId: preview.claimId ?? '',
  };
}

/** Prefill editable form fields from a live LetterParseResult.parsed. */
export function formFieldsFromParsed(
  parsed: ParsedLetter,
  match?: { patientId?: string; claimId?: string; patientName?: string },
): LetterCommitFormFields {
  return {
    patientName: match?.patientName?.trim() || parsed.patient.name || '',
    nhi: parsed.patient.nhi ?? '',
    dob: parsed.patient.dob ?? '',
    claimNumber: parsed.claim.claimNumber ?? '',
    acc45: parsed.claim.acc45Number ?? '',
    poNumber: parsed.claim.poNumber ?? '',
    injury: parsed.claim.injuryDescription ?? '',
    day1: parsed.claim.dateOfInjury ?? '',
    declineReason: parsed.kind === 'decline' ? parsed.reason ?? '' : '',
    servicePeriodDeclined:
      parsed.kind === 'decline' ? parsed.serviceRequested ?? 'Extended Nursing' : '',
    letterDate: parsed.letterDate ?? '',
    rows: parsed.kind === 'approval' ? assignRecordStatus(parsed.serviceRows) : [],
    selectedPatientId: match?.patientId ?? '',
    selectedClaimId: match?.claimId ?? '',
  };
}

/**
 * Commit an edited letter form to live AppData (creates/updates patient + claim).
 * Identical behavior to LetterImportModal.saveAll's commit branch.
 */
export async function commitLetterForm(
  parsed: ParsedLetter,
  file: File,
  fields: LetterCommitFormFields,
  deps: LetterCommitDeps,
): Promise<LetterImportCommitResult> {
  if (!fields.patientName.trim()) {
    throw new Error('Patient name is required before accepting.');
  }
  if (parsed.kind === 'approval') {
    if (!fields.claimNumber.trim()) {
      throw new Error('Claim number is required before accepting an approval letter.');
    }
    const rows =
      fields.rows.length > 0 ? fields.rows : assignRecordStatus(parsed.serviceRows);
    return deps.commitParsedApproval(parsed, file, {
      patientId: fields.selectedPatientId || undefined,
      claimId: fields.selectedClaimId || undefined,
      patientPatch: {
        name: fields.patientName.trim(),
        nhi: fields.nhi,
        dob: fields.dob,
      },
      claimPatch: {
        claimNumber: fields.claimNumber.trim(),
        acc45Number: fields.acc45,
        poNumber: fields.poNumber,
        injuryDescription: fields.injury,
        day1Date: fields.day1,
      },
      rows,
      historicRows: parsed.packageRows,
    });
  }

  return deps.commitParsedDecline(parsed, file, {
    patientName: fields.patientName.trim(),
    claimNumber: fields.claimNumber.trim() || undefined,
    reason: fields.declineReason,
    servicePeriodDeclined: fields.servicePeriodDeclined,
    declineReceivedDate: fields.letterDate || undefined,
    patientId: fields.selectedPatientId || undefined,
    claimId: fields.selectedClaimId || undefined,
  });
}

/** Resolve a File for a staging item: prefer preview bytes, else caller-supplied file. */
export function fileFromStagingPreview(item: StagingItem): File | undefined {
  if (!isStagingParsedPreview(item.parsedPreview)) return undefined;
  return previewToFile(item.parsedPreview);
}

export function stagingPreviewOf(item: StagingItem): StagingParsedPreview | undefined {
  return isStagingParsedPreview(item.parsedPreview) ? item.parsedPreview : undefined;
}
