// ============================================================================
// Descriptive attachment naming.
//
// Mirrors `New-DescriptiveFileName` in scripts/launcher/outlook-sync.ps1 so the
// Review Queue can show the exact on-disk filename outlook-sync writes and can
// derive patient/claim hints from an ACC email subject. KEEP THE TWO IN SYNC.
//
// ACC subject format:
//   "Mr Graham Wayne Reichenbach - Claim:P2222756868 ACCID:VEND-K96655"
//     patient = text before " - Claim" (title stripped)
//     claim   = alphanumerics after "Claim:"
// Descriptive filename:
//   "Reichenbach-Graham_ClaimP2222756868_<original>.docx"
// ============================================================================

const TITLE_PREFIX = /^(?:mr|mrs|ms|miss|dr)\.?\s+/i;
const CLAIM_TOKEN = /claim\s*[:#]?\s*([A-Za-z0-9]+)/i;
const CLAIM_SEPARATOR = ' - claim';

/** Cap filename length while preserving the extension (matches Limit-FileNameLength). */
export function limitFileNameLength(fileName: string, maxLength = 150): string {
  if (!fileName || fileName.length <= maxLength) return fileName;
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot) : '';
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const keep = maxLength - ext.length;
  if (keep < 1) return fileName.slice(0, maxLength);
  return stem.slice(0, keep) + ext;
}

/**
 * Readable patient name from an ACC subject: the text before " - Claim" with any
 * leading title (Mr/Mrs/Ms/Miss/Dr) stripped. Returns undefined when the subject
 * has no " - Claim" separator (a free-text subject is not a reliable name source).
 */
export function patientNameFromSubject(subject: string): string | undefined {
  if (!subject) return undefined;
  const sepIndex = subject.toLowerCase().indexOf(CLAIM_SEPARATOR);
  if (sepIndex < 0) return undefined;
  const cleaned = subject
    .slice(0, sepIndex)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(TITLE_PREFIX, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

/** "Graham Wayne Reichenbach" -> "Reichenbach-Graham" (surname-first, ASCII-safe). */
function surnameFirst(name: string): string | undefined {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter((w) => w.length > 0);
  if (words.length >= 2) return `${words[words.length - 1]}-${words[0]}`;
  if (words.length === 1) return words[0];
  return undefined;
}

/** Claim token from "Claim:P2222756868" -> "P2222756868" (keeps the leading letter). */
export function claimTokenFromSubject(subject: string): string | undefined {
  if (!subject) return undefined;
  const m = CLAIM_TOKEN.exec(subject);
  if (!m) return undefined;
  const token = m[1].replace(/[^A-Za-z0-9]/g, '');
  return token.length > 0 ? token : undefined;
}

/**
 * True when the filename already starts with a descriptive patient/claim prefix
 * produced by descriptiveAttachmentName / New-DescriptiveFileName.
 * Patterns: Surname-First_ClaimN_…, ClaimN_…, or Surname-First_… (before ACC original).
 */
export function isDescriptiveName(fileName: string): boolean {
  const leaf = (fileName.split(/[\\/]/).pop() ?? fileName).trim();
  if (!leaf) return false;
  // Surname-First_ClaimTOKEN_rest  OR  ClaimTOKEN_rest
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_/.test(leaf)) return true;
  if (/^Claim[A-Za-z0-9]+_/.test(leaf)) return true;
  // Surname-First_rest (patient-only prefix; require hyphenated surname-first form)
  if (/^[A-Za-z0-9]+-[A-Za-z0-9]+_/.test(leaf)) return true;
  return false;
}

/**
 * Strip a leading descriptive prefix so rename / re-save is idempotent.
 * "Reichenbach-Graham_ClaimP1_vendor.docx" -> "vendor.docx"
 * Leaves non-descriptive names (TMT…, %20, generic vendor) unchanged.
 */
export function stripDescriptivePrefix(fileName: string): string {
  const leaf = (fileName.split(/[\\/]/).pop() ?? fileName).trim();
  if (!leaf || !isDescriptiveName(leaf)) return leaf;

  let rest = leaf;
  const withClaim = rest.match(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)?_Claim[A-Za-z0-9]+_(.+)$/);
  if (withClaim) return withClaim[1];
  const claimOnly = rest.match(/^Claim[A-Za-z0-9]+_(.+)$/);
  if (claimOnly) return claimOnly[1];
  const patientOnly = rest.match(/^[A-Za-z0-9]+-[A-Za-z0-9]+_(.+)$/);
  if (patientOnly) return patientOnly[1];
  return leaf;
}

/**
 * Build the patient/claim-identifiable filename outlook-sync saves attachments as.
 * Falls back to the original filename when neither a patient name nor a claim can
 * be parsed (never an empty/garbage prefix). Uses whichever of the two is present.
 * Strips an existing descriptive prefix first so re-runs never double-prefix.
 */
export function descriptiveAttachmentName(subject: string, originalFileName: string): string {
  const leaf = (originalFileName.split(/[\\/]/).pop() ?? originalFileName).trim();
  if (!leaf) return originalFileName;
  const original = stripDescriptivePrefix(leaf);
  if (!subject) return original;

  const patient = patientNameFromSubject(subject);
  const patientPart = patient ? surnameFirst(patient) : undefined;
  const claimPart = claimTokenFromSubject(subject);

  let prefix = '';
  if (patientPart && claimPart) prefix = `${patientPart}_Claim${claimPart}`;
  else if (patientPart) prefix = patientPart;
  else if (claimPart) prefix = `Claim${claimPart}`;

  if (!prefix) return original;
  return limitFileNameLength(`${prefix}_${original}`, 150);
}
