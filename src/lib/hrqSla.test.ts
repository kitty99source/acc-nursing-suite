import { describe, it, expect } from 'vitest';
import {
  DEFAULT_HRQ_SLA,
  hrqSlaLabel,
  hrqSlaLevel,
  hrqSlaStatus,
  summarizeQueueSla,
} from './hrqSla';

const HOUR = 3_600_000;
// Fixed, injected clock so escalation is deterministic (no real Date.now()).
const NOW = Date.UTC(2026, 6, 8, 12, 0, 0);
const hoursAgo = (h: number) => NOW - h * HOUR;

describe('hrqSla — escalation levels (P8-013)', () => {
  it('stays ok below the warn threshold', () => {
    expect(hrqSlaLevel(hoursAgo(0), NOW)).toBe('ok');
    expect(hrqSlaLevel(hoursAgo(8.9), NOW)).toBe('ok');
  });

  it('escalates ok → warn at the warn threshold (9h)', () => {
    expect(hrqSlaLevel(hoursAgo(9), NOW)).toBe('warn');
    expect(hrqSlaLevel(hoursAgo(17.9), NOW)).toBe('warn');
  });

  it('escalates warn → danger at the danger threshold (18h)', () => {
    expect(hrqSlaLevel(hoursAgo(18), NOW)).toBe('danger');
    expect(hrqSlaLevel(hoursAgo(48), NOW)).toBe('danger');
  });

  it('treats a future createdAt as age 0 (clock skew safe)', () => {
    expect(hrqSlaLevel(NOW + 5 * HOUR, NOW)).toBe('ok');
    expect(hrqSlaStatus(NOW + 5 * HOUR, NOW).ageHours).toBe(0);
  });

  it('honours custom thresholds', () => {
    const cfg = { dangerHours: 4, warnHours: 2 };
    expect(hrqSlaLevel(hoursAgo(1), NOW, cfg)).toBe('ok');
    expect(hrqSlaLevel(hoursAgo(3), NOW, cfg)).toBe('warn');
    expect(hrqSlaLevel(hoursAgo(5), NOW, cfg)).toBe('danger');
  });
});

describe('hrqSla — status details', () => {
  it('reports hours until breach and breached flag', () => {
    const before = hrqSlaStatus(hoursAgo(10), NOW);
    expect(before.breached).toBe(false);
    expect(before.hoursUntilBreach).toBeCloseTo(8, 5);

    const after = hrqSlaStatus(hoursAgo(20), NOW);
    expect(after.breached).toBe(true);
    expect(after.hoursUntilBreach).toBeCloseTo(-2, 5);
  });

  it('uses default config when none supplied', () => {
    expect(hrqSlaStatus(hoursAgo(DEFAULT_HRQ_SLA.dangerHours), NOW).level).toBe('danger');
  });
});

describe('hrqSla — labels', () => {
  it('labels waiting, due-soon and overdue items', () => {
    expect(hrqSlaLabel(hrqSlaStatus(hoursAgo(0.2), NOW))).toBe('Just now');
    expect(hrqSlaLabel(hrqSlaStatus(hoursAgo(13), NOW))).toBe('Due in 5h');
    expect(hrqSlaLabel(hrqSlaStatus(hoursAgo(20), NOW))).toBe('Overdue 2h');
  });
});

describe('hrqSla — queue summary', () => {
  it('rolls up levels across a queue', () => {
    const items = [
      { createdAt: hoursAgo(1) },
      { createdAt: hoursAgo(10) },
      { createdAt: hoursAgo(12) },
      { createdAt: hoursAgo(19) },
      { createdAt: hoursAgo(30) },
    ];
    const summary = summarizeQueueSla(items, NOW);
    expect(summary).toEqual({ ok: 1, warn: 2, danger: 2, breached: 2, total: 5 });
  });

  it('handles an empty queue', () => {
    expect(summarizeQueueSla([], NOW)).toEqual({ ok: 0, warn: 0, danger: 0, breached: 0, total: 0 });
  });
});
