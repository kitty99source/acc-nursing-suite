// ============================================================================
// Recent-files list logic for the "Save into ▾" menu. A small, most-recent-first
// list of File System Access handles the user can overwrite directly, instead of
// only ever writing to the single connected file or downloading a fresh copy.
//
// The pure list logic (add / dedupe / cap) lives here so it can be unit-tested
// without a browser or IndexedDB. Handles are structured-cloneable and are the
// only non-serialisable part; the list shape itself is plain data.
// ============================================================================

export const MAX_RECENT_FILES = 5;

/** One remembered file: its handle plus lightweight display metadata. */
export interface RecentFileEntry {
  handle: FileSystemFileHandle;
  /** Display name (the handle's file name). Also the dedupe key. */
  name: string;
  lastUsedAt: number;
}

/**
 * Insert (or move) `entry` at the front of the recent list, deduping by name
 * so the same file never appears twice, and capping the list length.
 *
 * Pure and synchronous: takes and returns a new array, most-recent-first.
 * Generic over the entry shape so it is trivially testable without real
 * FileSystemFileHandle objects.
 */
export function upsertRecent<T extends { name: string }>(
  list: readonly T[],
  entry: T,
  cap: number = MAX_RECENT_FILES,
): T[] {
  const withoutDupe = list.filter((e) => e.name !== entry.name);
  return [entry, ...withoutDupe].slice(0, Math.max(0, cap));
}

/** Remove the entry at `index`, returning a new array. Out-of-range is a no-op. */
export function removeRecentAt<T>(list: readonly T[], index: number): T[] {
  if (index < 0 || index >= list.length) return [...list];
  return list.filter((_, i) => i !== index);
}
