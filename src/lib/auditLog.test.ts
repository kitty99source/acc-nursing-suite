import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appendAudit, readRecentAudit, recordHrqResolution } from './auditLog';

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

describe('recordHrqResolution (P8-008 sign-off trail)', () => {
  beforeEach(() => {
    vi.mocked(loadAuditLog).mockResolvedValue([]);
    vi.mocked(saveAuditLog).mockClear();
  });

  it('records who / when / before→after / runId on approval sign-off', async () => {
    const before = Date.now();
    await recordHrqResolution({
      action: 'hrq-sign-off',
      stagingItemId: 's1',
      title: 'Email: approval.pdf',
      beforeStatus: 'pending',
      afterStatus: 'approved',
      user: 'Nurse Jo',
      runId: 'run-123',
      detail: 'filed letter import approval.pdf',
    });
    const saved = vi.mocked(saveAuditLog).mock.calls[0][0];
    expect(saved).toHaveLength(1);
    const row = saved[0];
    expect(row.action).toBe('hrq-sign-off');
    expect(row.entityType).toBe('staging');
    expect(row.entityId).toBe('s1');
    expect(row.user).toBe('Nurse Jo');
    expect(row.runId).toBe('run-123');
    expect(row.before).toEqual({ status: 'pending' });
    expect(row.after).toEqual({ status: 'approved' });
    expect(row.ts).toBeGreaterThanOrEqual(before);
    expect(row.summary).toContain('approved');
    expect(row.summary).toContain('filed letter import approval.pdf');
  });

  it('uses the right verb per resolution action', async () => {
    await recordHrqResolution({
      action: 'hrq-batch-sign-off',
      stagingItemId: 's2',
      title: 'Letter 2',
      beforeStatus: 'pending',
      afterStatus: 'approved',
    });
    await recordHrqResolution({
      action: 'hrq-reject',
      stagingItemId: 's3',
      title: 'Letter 3',
      beforeStatus: 'pending',
      afterStatus: 'rejected',
    });
    await recordHrqResolution({
      action: 'hrq-defer',
      stagingItemId: 's4',
      title: 'Letter 4',
      beforeStatus: 'pending',
      afterStatus: 'deferred',
    });
    const calls = vi.mocked(saveAuditLog).mock.calls;
    expect(calls[0][0][0].summary).toContain('batch approved');
    expect(calls[1][0][0].summary).toContain('rejected');
    expect(calls[2][0][0].summary).toContain('deferred');
  });

  it('omits user and runId keys when not provided', async () => {
    await recordHrqResolution({
      action: 'hrq-defer',
      stagingItemId: 's5',
      title: 'Letter 5',
      beforeStatus: 'pending',
      afterStatus: 'deferred',
    });
    const row = vi.mocked(saveAuditLog).mock.calls[0][0][0];
    expect('user' in row).toBe(false);
    expect('runId' in row).toBe(false);
    expect(row.before).toEqual({ status: 'pending' });
    expect(row.after).toEqual({ status: 'deferred' });
  });
});
