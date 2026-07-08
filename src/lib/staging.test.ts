import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createStagingItem,
  parseStagingSidecar,
  importStagingSidecars,
  assertStagingIsolation,
  stagingSlaLevel,
  ingestAttachment,
  findStagingByHash,
  dedupeStagingByHash,
  type StagingItem,
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

describe('staging — attachment-hash idempotency (P8-014)', () => {
  // Stateful in-memory IDB queue so ingest sees what previous ingests saved.
  let queue: StagingItem[];

  beforeEach(() => {
    queue = [];
    vi.mocked(loadStagingQueue).mockImplementation(async () => queue);
    vi.mocked(saveStagingQueue).mockImplementation(async (items) => {
      queue = items;
    });
  });

  // Tagged stand-in blobs so the injected hasher is deterministic regardless of
  // the test environment's Blob implementation.
  const fakeBlob = (id: string) => ({ __id: id }) as unknown as Blob;
  const fakeHash = async (blob: Blob) => `h:${(blob as unknown as { __id: string }).__id}`;

  const meta = (title: string) => ({
    type: 'letter-import-pending' as const,
    source: 'email' as const,
    severity: 'info' as const,
    title,
    summary: 'Awaiting HRQ review',
    sourceFileName: 'letter.pdf',
  });

  it('adds a new item on first ingest and stamps the hash', async () => {
    const res = await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A'), { hash: fakeHash });
    expect(res.outcome).toBe('added');
    expect(res.item.sourceHash).toBe('h:PDF-A');
    expect(queue).toHaveLength(1);
  });

  it('flags the second ingest of the same attachment as duplicate — one item, not two', async () => {
    const first = await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A'), { hash: fakeHash });
    const second = await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A (re-drop)'), {
      hash: fakeHash,
    });
    expect(second.outcome).toBe('duplicate');
    expect(second.duplicateOfId).toBe(first.item.id);
    expect(queue).toHaveLength(1);
  });

  it('adds separate items for genuinely different attachments', async () => {
    await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A'), { hash: fakeHash });
    const other = await ingestAttachment(fakeBlob('PDF-B'), meta('Letter B'), { hash: fakeHash });
    expect(other.outcome).toBe('added');
    expect(queue).toHaveLength(2);
  });

  it('re-ingests once a prior item is resolved (only pending items dedupe)', async () => {
    await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A'), { hash: fakeHash });
    queue = queue.map((i) => ({ ...i, status: 'approved' }));
    const again = await ingestAttachment(fakeBlob('PDF-A'), meta('Letter A again'), {
      hash: fakeHash,
    });
    expect(again.outcome).toBe('added');
    expect(queue.filter((i) => i.status === 'pending')).toHaveLength(1);
  });

  it('reuses the real SHA-256 hashBlob when no hasher is injected', async () => {
    const realBlob = () => new Blob(['real-bytes'], { type: 'application/pdf' });
    const res = await ingestAttachment(realBlob(), meta('Real letter'));
    expect(res.outcome).toBe('added');
    expect(res.item.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    const dup = await ingestAttachment(realBlob(), meta('Real letter re-drop'));
    expect(dup.outcome).toBe('duplicate');
    expect(queue).toHaveLength(1);
  });
});

describe('staging — hash helpers (P8-014)', () => {
  const item = (id: string, sourceHash?: string, status: StagingItem['status'] = 'pending', createdAt = 0): StagingItem =>
    createStagingItem({
      id,
      status,
      type: 'letter-import-pending',
      source: 'email',
      severity: 'info',
      title: id,
      summary: '',
      sourceHash,
    });

  it('findStagingByHash matches pending items only by default', () => {
    const items = [item('a', 'h1'), item('b', 'h2', 'approved')];
    expect(findStagingByHash(items, 'h1')?.id).toBe('a');
    expect(findStagingByHash(items, 'h2')).toBeUndefined();
    expect(findStagingByHash(items, 'h2', { includeResolved: true })?.id).toBe('b');
    expect(findStagingByHash(items, '')).toBeUndefined();
  });

  it('dedupeStagingByHash keeps the earliest item per hash', () => {
    const a = { ...item('a', 'dup'), createdAt: 100 };
    const b = { ...item('b', 'dup'), createdAt: 50 };
    const c = { ...item('c', 'unique'), createdAt: 10 };
    const d = { ...item('d'), createdAt: 5 };
    const out = dedupeStagingByHash([a, b, c, d]);
    const ids = out.map((i) => i.id).sort();
    expect(ids).toEqual(['b', 'c', 'd']);
  });
});
