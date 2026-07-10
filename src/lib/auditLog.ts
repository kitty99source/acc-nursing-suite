import { loadAuditLog, saveAuditLog } from './idb';

export interface AuditEntry {
  ts: number;
  action: string;
  entityType: string;
  entityId?: string;
  summary: string;
  /** Who performed the action (settings.userDisplayName), when known. */
  user?: string;
  /** Automation run that produced the item being resolved (P8-008). */
  runId?: string;
  /** JSON-serialisable state snapshot before the change (P8-008 before/after). */
  before?: unknown;
  /** JSON-serialisable state snapshot after the change. */
  after?: unknown;
}

const MAX_ENTRIES = 10_000;

export async function appendAudit(entry: Omit<AuditEntry, 'ts'>): Promise<void> {
  const existing = await loadAuditLog();
  const row: AuditEntry = { ...entry, ts: Date.now() };
  const next = [...existing, row];
  const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  await saveAuditLog(trimmed);
}

export async function readRecentAudit(limit = 50): Promise<AuditEntry[]> {
  const entries = await loadAuditLog();
  return entries.slice(-limit).reverse();
}

export async function clearAuditLog(): Promise<void> {
  await saveAuditLog([]);
}

// ============================================================================
// P8-008 — HRQ sign-off audit trail.
//
// Every time a queue item is resolved (single review-import, batch approve,
// reject, defer) we record the full who / when / before→after / runId so the
// human sign-off on staged automation is fully accountable. `ts` (when) is
// stamped by appendAudit; the rest is captured here.
// ============================================================================

export type HrqResolutionAction =
  | 'hrq-sign-off'
  | 'hrq-batch-sign-off'
  | 'hrq-reject'
  | 'hrq-defer'
  | 'hrq-restore';

export interface HrqResolutionInput {
  action: HrqResolutionAction;
  /** Staging item id being resolved. */
  stagingItemId: string;
  /** Human-readable staging item title for the summary line. */
  title: string;
  /** Staging status before resolution (usually 'pending'). */
  beforeStatus: string;
  /** Staging status after resolution ('approved' | 'rejected' | 'deferred'). */
  afterStatus: string;
  /** Operator name (settings.userDisplayName). */
  user?: string;
  /** Automation run id carried on the staging item, if any. */
  runId?: string;
  /** Extra detail appended to the summary, e.g. "filed approval for claim …". */
  detail?: string;
}

const HRQ_ACTION_VERB: Record<HrqResolutionAction, string> = {
  'hrq-sign-off': 'approved',
  'hrq-batch-sign-off': 'batch approved',
  'hrq-reject': 'rejected',
  'hrq-defer': 'deferred',
  'hrq-restore': 'brought back to review',
};

/**
 * Record a complete HRQ resolution audit entry (who/when/before→after/runId).
 * `when` is stamped by {@link appendAudit}.
 */
export async function recordHrqResolution(input: HrqResolutionInput): Promise<void> {
  const verb = HRQ_ACTION_VERB[input.action];
  const detail = input.detail ? ` — ${input.detail}` : '';
  await appendAudit({
    action: input.action,
    entityType: 'staging',
    entityId: input.stagingItemId,
    summary: `HRQ ${verb}: ${input.title}${detail}`,
    ...(input.user ? { user: input.user } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    before: { status: input.beforeStatus },
    after: { status: input.afterStatus },
  });
}
