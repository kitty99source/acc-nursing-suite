import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createStagingItem,
  parseStagingSidecar,
  importStagingSidecars,
  assertStagingIsolation,
  stagingSlaLevel,
} from './staging';

vi.mock('./idb', () => ({
  loadStagingQueue: vi.fn(async () => []),
  saveStagingQueue: vi.fn(async () => {}),
}));

import { loadStagingQueue, saveStagingQueue } from './idb';

describe('staging', () => {
  beforeEach(() => {
    vi.mocked(loadStagingQueue).mockResolvedValue([]);
    vi.mocked(saveStagingQueue).mockClear();
  });

  it('creates staging item with pending status', () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Approval letter',
      summary: 'Parsed 87% confidence',
      sourceFileName: 'acc.pdf',
      sourceHash: 'abc123',
    });
    expect(item.status).toBe('pending');
    expect(item.id).toBeTruthy();
    expect(item.createdAt).toBeGreaterThan(0);
  });

  it('parses valid staging sidecar JSON', () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'warn',
      title: 'Decline letter',
      summary: 'Low confidence',
    });
    const sidecar = parseStagingSidecar({ version: 1, item });
    expect(sidecar?.item.title).toBe('Decline letter');
  });

  it('rejects invalid sidecar version', () => {
    expect(parseStagingSidecar({ version: 2, item: {} })).toBeNull();
  });

  it('deduplicates by sourceHash on import', async () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Letter',
      summary: 'Test',
      sourceHash: 'hash1',
    });
    vi.mocked(loadStagingQueue).mockResolvedValue([item]);
    const added = await importStagingSidecars([{ version: 1, item: { ...item, id: 'other' } }]);
    expect(added).toBe(0);
  });

  it('imports new sidecar into staging queue', async () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'New letter',
      summary: 'From folder watch',
      sourceHash: 'unique-hash',
    });
    const added = await importStagingSidecars([{ version: 1, item }]);
    expect(added).toBe(1);
    expect(saveStagingQueue).toHaveBeenCalled();
  });

  it('assertStagingIsolation throws if live data mutated from staging', () => {
    expect(() => assertStagingIsolation(true, true)).toThrow(/HRQ sign-off/);
    expect(() => assertStagingIsolation(false, true)).not.toThrow();
  });

  it('computes SLA level from createdAt', () => {
    const now = Date.now();
    expect(stagingSlaLevel(now - 1_000, now)).toBe('ok');
    expect(stagingSlaLevel(now - 10 * 3_600_000, now)).toBe('warn');
    expect(stagingSlaLevel(now - 20 * 3_600_000, now)).toBe('danger');
  });
});
