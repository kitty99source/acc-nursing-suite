// ============================================================================
// Small shared utilities: ids, date math/formatting. All TZ-safe (UTC math
// on YYYY-MM-DD strings) to avoid off-by-one across DST boundaries.
// ============================================================================

export function uid(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Today's date as an ISO YYYY-MM-DD string (local calendar day). */
export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole-day difference (b - a) using UTC anchors; returns 0 for invalid input. */
export function daysBetween(a: string, b: string): number {
  if (!a || !b) return 0;
  const start = Date.parse(a + 'T00:00:00Z');
  const end = Date.parse(b + 'T00:00:00Z');
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / MS_PER_DAY);
}

/** Days from today until the given date (positive = future, negative = past). */
export function daysUntil(dateISO: string): number {
  return daysBetween(todayISO(), dateISO);
}

/** Format an ISO date for display as dd/mm/yyyy (NZ/British). Empty input -> "". */
export function formatDateNZ(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleDateString('en-NZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** @deprecated alias — use formatDateNZ. Kept for existing imports. */
export function formatDate(iso?: string): string {
  return formatDateNZ(iso);
}

/** Month index (0-11) for an ISO date, or -1 if invalid. */
export function monthIndex(iso?: string): number {
  if (!iso) return -1;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return -1;
  return new Date(ms).getUTCMonth();
}

/** Year for an ISO date, or NaN if invalid. */
export function yearOf(iso?: string): number {
  if (!iso) return NaN;
  const ms = Date.parse(iso + 'T00:00:00Z');
  if (Number.isNaN(ms)) return NaN;
  return new Date(ms).getUTCFullYear();
}

export function isValidISODate(iso?: string): boolean {
  if (!iso) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return !Number.isNaN(Date.parse(iso + 'T00:00:00Z'));
}

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
