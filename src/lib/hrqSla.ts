// ============================================================================
// P8-013 — SLA escalation for Human Review Queue items.
//
// PURE COMPUTE: no persisted schema change. An item's escalation level is
// derived entirely from its createdAt timestamp and the current time, so it can
// be unit-tested with an injected/fake clock and rendered live without touching
// the store. Items unreviewed past the danger threshold (default 18h) escalate
// warn → danger so the operator sees the oldest work breaching first.
// ============================================================================

export type SlaLevel = 'ok' | 'warn' | 'danger';

export interface SlaConfig {
  /** Hours until an unreviewed item breaches SLA and escalates to danger. */
  dangerHours: number;
  /** Hours until an item escalates from ok → warn (must be < dangerHours). */
  warnHours: number;
}

/** Default HRQ SLA: warn at half-life (9h), danger/breach at 18h. */
export const DEFAULT_HRQ_SLA: SlaConfig = { dangerHours: 18, warnHours: 9 };

const MS_PER_HOUR = 3_600_000;

function resolveConfig(config: Partial<SlaConfig> = {}): SlaConfig {
  const dangerHours = config.dangerHours ?? DEFAULT_HRQ_SLA.dangerHours;
  const warnHours =
    config.warnHours ?? Math.min(DEFAULT_HRQ_SLA.warnHours, dangerHours / 2);
  return { dangerHours, warnHours: Math.min(warnHours, dangerHours) };
}

export interface SlaStatus {
  level: SlaLevel;
  /** Whole-and-fractional hours the item has been waiting (never negative). */
  ageHours: number;
  /** Hours left until the danger breach; negative once breached. */
  hoursUntilBreach: number;
  breached: boolean;
}

/** Full SLA status for one item given its createdAt and an injectable clock. */
export function hrqSlaStatus(
  createdAt: number,
  now: number = Date.now(),
  config: Partial<SlaConfig> = {},
): SlaStatus {
  const cfg = resolveConfig(config);
  const ageHours = Math.max(0, (now - createdAt) / MS_PER_HOUR);
  const hoursUntilBreach = cfg.dangerHours - ageHours;
  let level: SlaLevel = 'ok';
  if (ageHours >= cfg.dangerHours) level = 'danger';
  else if (ageHours >= cfg.warnHours) level = 'warn';
  return { level, ageHours, hoursUntilBreach, breached: ageHours >= cfg.dangerHours };
}

/** Escalation level only — convenience wrapper around {@link hrqSlaStatus}. */
export function hrqSlaLevel(
  createdAt: number,
  now: number = Date.now(),
  config: Partial<SlaConfig> = {},
): SlaLevel {
  return hrqSlaStatus(createdAt, now, config).level;
}

/** Short human label for a badge, e.g. "Overdue 3h" / "Due in 5h" / "Just now". */
export function hrqSlaLabel(status: SlaStatus): string {
  if (status.breached) {
    const over = Math.max(1, Math.round(-status.hoursUntilBreach));
    return `Overdue ${over}h`;
  }
  const left = Math.round(status.hoursUntilBreach);
  if (status.ageHours < 1) return 'Just now';
  if (left <= 0) return 'Due now';
  return `Due in ${left}h`;
}

export interface QueueSlaSummary {
  ok: number;
  warn: number;
  danger: number;
  /** Count of items that have breached the danger threshold (== danger). */
  breached: number;
  total: number;
}

/** Roll up SLA levels across a queue for header badges. */
export function summarizeQueueSla(
  items: Array<{ createdAt: number }>,
  now: number = Date.now(),
  config: Partial<SlaConfig> = {},
): QueueSlaSummary {
  const summary: QueueSlaSummary = { ok: 0, warn: 0, danger: 0, breached: 0, total: items.length };
  for (const item of items) {
    const level = hrqSlaLevel(item.createdAt, now, config);
    summary[level] += 1;
  }
  summary.breached = summary.danger;
  return summary;
}
