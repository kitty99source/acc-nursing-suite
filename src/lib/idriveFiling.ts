// ============================================================================
// I-drive filing path builder for District Nursing Admin Suite (pure, unit-testable).
//
// Admin path grammar (NOT Enable/Ramps):
//   Letters\{year}\{MonthName}\{LASTNAME, Firstname} {CLAIM}\{fileName}
//
// Writeback always lands under Settings.iDriveStagingSubfolder (default `_Staging`)
// via buildStagingRelativePath — moving into the live archive is a manual step.
// ============================================================================

import { todayISO } from './format';

export const DEFAULT_IDRIVE_ROOT = 'I:\\ACC\\District Nursing';
export const DEFAULT_IDRIVE_STAGING_SUBFOLDER = '_Staging';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface AdminIDriveFilingInput {
  patientName: string;
  claimNumber?: string;
  /** ISO date (YYYY-MM-DD) for year/month folders; defaults to today. */
  letterDate?: string;
  sourceFileName?: string;
}

export interface AdminIDriveFilingPath {
  /** Path relative to Settings.iDriveRootPath, using backslashes (Windows). */
  relativePath: string;
  patientFolder: string;
  fileName: string;
}

/** Strip characters illegal in Windows paths. */
export function sanitisePathSegment(raw: string, fallback = '_'): string {
  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return cleaned || fallback;
}

/** Format a display name as `LASTNAME, Firstname` (nursing I-drive convention). */
export function formatNameLastFirst(patientName: string): string {
  const cleaned = patientName.trim().replace(/\s+/g, ' ');
  if (!cleaned) return 'Unknown';
  const parts = cleaned.split(' ');
  if (parts.length === 1) return parts[0]!.toUpperCase();
  const last = parts[parts.length - 1]!.toUpperCase();
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

function fileExtension(sourceFileName?: string): string {
  const name = (sourceFileName ?? '').trim();
  const dot = name.lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot).toLowerCase();
    if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  }
  return '.pdf';
}

export function yearMonthFromIso(iso: string | undefined): { year: string; monthName: string } {
  const raw = (iso ?? '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match) {
    const year = match[1]!;
    const monthIdx = Number(match[2]) - 1;
    if (monthIdx >= 0 && monthIdx < 12) {
      return { year, monthName: MONTH_NAMES[monthIdx]! };
    }
  }
  return yearMonthFromIso(todayISO());
}

/**
 * Build the live (non-staging) relative path for a District Nursing letter.
 * Callers wrap with buildStagingRelativePath before writeback.
 */
export function buildAdminIDriveRelativePath(input: AdminIDriveFilingInput): AdminIDriveFilingPath {
  const { year, monthName } = yearMonthFromIso(input.letterDate);
  const namePart = sanitisePathSegment(formatNameLastFirst(input.patientName), 'Unknown');
  const claim = sanitisePathSegment((input.claimNumber ?? '').trim() || 'NOCLAIM', 'NOCLAIM');
  const patientFolder = `${namePart} ${claim}`;
  const ext = fileExtension(input.sourceFileName);
  const base =
    sanitisePathSegment(
      (input.sourceFileName ?? '').replace(/\.[^.]+$/, '') || `ACC letter ${claim}`,
      `ACC letter ${claim}`,
    ) + ext;
  const relativePath = ['Letters', year, monthName, patientFolder, base].join('\\');
  return { relativePath, patientFolder, fileName: base };
}

/** Prefix a live relative path with the staging subfolder (default `_Staging`). */
export function buildStagingRelativePath(
  liveRelativePath: string,
  stagingSubfolder: string = DEFAULT_IDRIVE_STAGING_SUBFOLDER,
): string {
  const sub = sanitisePathSegment(stagingSubfolder.trim() || DEFAULT_IDRIVE_STAGING_SUBFOLDER, '_Staging');
  const rest = liveRelativePath.replace(/^[\\/]+/, '');
  return `${sub}\\${rest}`;
}

export function joinIDriveDisplayPath(root: string, relativePath: string): string {
  const r = root.replace(/[\\/]+$/, '');
  const rel = relativePath.replace(/^[\\/]+/, '');
  return `${r}\\${rel}`;
}
