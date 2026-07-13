// ============================================================================
// Mail Reference Sheet — generic ACC form routing table.
//
// Seeded verbatim from "Mail Reference Sheet 2024.pdf" under
// I:\ACC\1 Team\Team Processes (extracted via Get-TeamProcessesReport.ps1).
// Editable in Settings/module UI so addresses can be corrected without a code change.
// Surfaced via MailReferenceBanner as an assumption (the sheet may have aged).
// ============================================================================

export interface MailReferenceEntry {
  id: string;
  /** Form code or short key, e.g. "ACC45", "ARTP". */
  formCode: string;
  /** Human label (often same as formCode, or a longer name for non-code items). */
  label: string;
  /** What to do with this form (save/lodge/hand off). */
  instructions: string;
  /** Primary email destination, when the sheet specifies one. */
  email?: string;
  /** CC address, when the sheet specifies one. */
  ccEmail?: string;
}

/**
 * Default rows from Mail Reference Sheet 2024.pdf. Entries with no email are
 * internal handoffs (Give to Amy May / Amy G / Paige).
 */
export const DEFAULT_MAIL_REFERENCE_ENTRIES: MailReferenceEntry[] = [
  {
    id: 'mailref_acc45',
    formCode: 'ACC45',
    label: 'ACC45 Injury Claim',
    instructions: 'Lodge on eLodgement and save to I-Drive',
  },
  {
    id: 'mailref_acc2152',
    formCode: 'ACC2152',
    label: 'ACC2152 Treatment Injury Claim',
    instructions: 'Save on I-Drive and send to release.patientinfo; CC Amy May',
    email: 'release.patientinfo@midcentraldhb.govt.nz',
    ccEmail: 'amy.may@midcentraldhb.govt.nz',
  },
  {
    id: 'mailref_acc42',
    formCode: 'ACC42',
    label: 'ACC42',
    instructions: 'Scan and save on I-Drive. Send to hamilton.registration',
    email: 'hamilton.registration@acc.co.nz',
  },
  {
    id: 'mailref_acc18',
    formCode: 'ACC18',
    label: 'ACC18 Medical Certificate',
    instructions: 'Scan and save to I-Drive. Send to providerhelp',
    email: 'providerhelp@acc.co.nz',
  },
  {
    id: 'mailref_acc705',
    formCode: 'ACC705',
    label: 'ACC705',
    instructions: 'Scan and save to I-Drive. Send on to claimsdocs if no note on form saying "emailed"',
    email: 'claimsdocs@acc.co.nz',
  },
  {
    id: 'mailref_acc7988',
    formCode: 'ACC7988',
    label: 'ACC7988 (Concussion)',
    instructions: 'Scan and save to I-Drive. Send on to claims if no note on form saying "emailed"',
    email: 'claims@acc.co.nz',
  },
  {
    id: 'mailref_acc7422',
    formCode: 'ACC7422',
    label: 'ACC7422 (Early cover Application)',
    instructions: 'Scan and save on I-drive. Email on to earlycover if no note on form saying "emailed"',
    email: 'earlycover@acc.co.nz',
  },
  {
    id: 'mailref_artp',
    formCode: 'ARTP',
    label: 'ARTP',
    instructions: 'Give to Amy May',
  },
  {
    id: 'mailref_dn_notes',
    formCode: 'DN-NOTES',
    label: 'District Nursing Notes',
    instructions: 'Give to Amy G',
  },
  {
    id: 'mailref_orthotics',
    formCode: 'ORTHOTICS',
    label: 'Orthotics Forms',
    instructions: 'Give to Paige',
  },
  {
    id: 'mailref_nonres',
    formCode: 'NON-RES',
    label: 'Non-Resident Registration Form / Proof of Eligibility',
    instructions: 'Send to eligibilityadmin and CC accounts.receivable',
    email: 'eligibilityadmin@midcentraldhb.govt.nz',
    ccEmail: 'accounts.receivable@midcentraldhb.govt.nz',
  },
];

/** Case-insensitive search across form code, label, instructions, and emails. */
export function filterMailReferenceEntries(
  entries: MailReferenceEntry[],
  query: string,
): MailReferenceEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    const hay = [e.formCode, e.label, e.instructions, e.email ?? '', e.ccEmail ?? '']
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}
