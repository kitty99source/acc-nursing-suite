import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendAudit, readRecentAudit } from './auditLog';

vi.mock('./idb', () => ({
  loadAuditLog: vi.fn(async () => []),
  saveAuditLog: vi.fn(async () => {}),
}));

import { loadAuditLog, saveAuditLog } from './idb';

describe('auditLog', () => {
  beforeEach(() => {
    vi.mocked(loadAuditLog).mockResolvedValue([]);
    vi.mocked(saveAuditLog).mockClear();
  });

  it('appends audit entry on mutate actions', async () => {
    await appendAudit({
      action: 'create',
      entityType: 'patient',
      entityId: 'p1',
      summary: 'Added patient Test',
    });
    expect(saveAuditLog).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveAuditLog).mock.calls[0][0];
    expect(saved).toHaveLength(1);
    expect(saved[0].action).toBe('create');
    expect(saved[0].entityType).toBe('patient');
    expect(saved[0].entityId).toBe('p1');
  });

  it('rotates at 10k entries', async () => {
    const existing = Array.from({ length: 10_000 }, (_, i) => ({
      ts: i,
      action: 'x',
      entityType: 'y',
      summary: `row ${i}`,
    }));
    vi.mocked(loadAuditLog).mockResolvedValue(existing);
    await appendAudit({ action: 'delete', entityType: 'claim', entityId: 'c1', summary: 'Removed claim' });
    const saved = vi.mocked(saveAuditLog).mock.calls[0][0];
    expect(saved).toHaveLength(10_000);
    expect(saved[0].ts).toBe(1);
    expect(saved[saved.length - 1].summary).toBe('Removed claim');
  });

  it('readRecentAudit returns newest first', async () => {
    vi.mocked(loadAuditLog).mockResolvedValue([
      { ts: 1, action: 'a', entityType: 'b', summary: 'old' },
      { ts: 2, action: 'a', entityType: 'b', summary: 'new' },
    ]);
    const recent = await readRecentAudit(50);
    expect(recent[0].summary).toBe('new');
  });
});
