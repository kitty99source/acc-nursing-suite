// Extracted from staging.ts so idb / hrqBatch can depend on the shape without
// importing the staging module (breaks idb ↔ staging and
// staging → letterCache → hrqBatch → staging cycles).

export type StagingItemType =
  | 'letter-import-pending'
  | 'letter-import-low-confidence'
  | 'letter-duplicate-suspect'
  | 'portal-fetch-complete'
  | 'automation-failure';

export type StagingItemStatus = 'pending' | 'approved' | 'rejected' | 'deferred';

export type StagingSource = 'folder' | 'email' | 'portal' | 'manual';

export interface StagingItem {
  id: string;
  type: StagingItemType;
  status: StagingItemStatus;
  source: StagingSource;
  createdAt: number;
  severity: 'danger' | 'warn' | 'info';
  title: string;
  summary: string;
  sourceFileName?: string;
  /** Patient display name parsed from the ACC email subject (Review Queue hint). */
  patientName?: string;
  /** ACC claim number parsed from the subject (e.g. "P2222756868"). */
  claimNumber?: string;
  /** ACC vendor/ACCID token parsed from the subject (e.g. "VEND-K96655"). */
  accId?: string;
  /** Descriptive on-disk filename outlook-sync saves the attachment as — the name to look for at Review & import. */
  expectedFileName?: string;
  /** Original ACC email subject (from .email-sync meta / folder-watch enrichment). */
  emailSubject?: string;
  /** ISO timestamp the ACC email was received (from .email-sync meta). */
  emailDate?: string;
  /** True when emailDate is a file-timestamp fallback, not an exact Outlook ReceivedTime. */
  emailDateApprox?: boolean;
  /** SHA-256 hex of source PDF bytes — dedup key for folder/email ingress. */
  sourceHash?: string;
  /** Absolute path on work PC (folder watch only; not synced to IDB on other machines). */
  sourcePath?: string;
  parsedPreview?: Record<string, unknown>;
  /**
   * Denormalized result of `isAutoAcceptEligiblePreview` from the last
   * successful parse (foreground or background pre-parse) — NOT the full
   * `StagingParsedPreview` blob, which the lean-queue redesign deliberately
   * stopped writing onto staging items (parsed data lives in the hash-keyed
   * letter parse cache instead; see `letterCache.ts`). Lets the "Auto-accept
   * ready (N)" toolbar count/list filter stay a cheap synchronous check
   * (same pattern as `patientName`/`claimNumber` hints) without needing the
   * full preview object on the item itself. Cleared back to `false`/removed
   * whenever a fresh parse no longer qualifies (e.g. a re-parse resolves an
   * ambiguous match or drops confidence).
   */
  autoAcceptEligible?: boolean;
  runId?: string;
}
