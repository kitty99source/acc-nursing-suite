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
  reconcileStagingQueue,
  analyzeStagingQueue,
  stagingIngressDedupKey,
  addDismissedStagingKeys,
  type StagingItem,
} from './staging';

vi.mock('./idb', () => ({
  loadStagingQueue: vi.fn(async () => []),
  saveStagingQueue: vi.fn(async () => {}),
  loadDismissedStaging: vi.fn(async () => []),
  saveDismissedStaging: vi.fn(async () => {}),
}));

vi.mock('./letterCache', () => ({
  putCachedLetterBlob: vi.fn(async () => {}),
  getCachedLetterParse: vi.fn(async () => undefined),
  base64ToBlob: vi.fn((base64: string, mime: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }),
}));

import {
  loadStagingQueue,
  saveStagingQueue,
  loadDismissedStaging,
  saveDismissedStaging,
} from './idb';
import { putCachedLetterBlob } from './letterCache';

describe('staging', () => {
  beforeEach(() => {
    vi.mocked(loadStagingQueue).mockResolvedValue([]);
    vi.mocked(saveStagingQueue).mockClear();
    vi.mocked(loadDismissedStaging).mockResolvedValue([]);
    vi.mocked(saveDismissedStaging).mockClear();
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

  it('deduplicates by sourceHash + sourceFileName on import', async () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Letter',
      summary: 'Test',
      sourceHash: 'hash1',
      sourceFileName: 'vendor.docx',
    });
    vi.mocked(loadStagingQueue).mockResolvedValue([item]);
    const added = await importStagingSidecars([
      { version: 1, item: { ...item, id: 'other', title: 'Letter again' } },
    ]);
    expect(added).toBe(0);
  });

  it('imports sidecars with same hash but different saved filenames', async () => {
    const first = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Letter A',
      summary: 'Test',
      sourceHash: 'same-hash',
      sourceFileName: '1_NUR02_Nursing_services_approve_-_vendor.docx',
    });
    vi.mocked(loadStagingQueue).mockResolvedValue([first]);
    const second = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Letter B',
      summary: 'Test',
      sourceHash: 'same-hash',
      sourceFileName: '1_NUR02_Nursing_services_approve_-_vendor-1.docx',
    });
    const added = await importStagingSidecars([{ version: 1, item: second }]);
    expect(added).toBe(1);
  });

  it('skips importing a sidecar whose ingress key is tombstoned', async () => {
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Discarded letter',
      summary: 'From folder watch',
      sourceHash: 'tombstoned-hash',
      sourceFileName: 'discarded.pdf',
    });
    const key = stagingIngressDedupKey(item);
    vi.mocked(loadDismissedStaging).mockResolvedValue([key as string]);
    const added = await importStagingSidecars([{ version: 1, item }]);
    expect(added).toBe(0);
    expect(saveStagingQueue).not.toHaveBeenCalled();
  });

  it('merges and de-dupes dismissed ingress keys without unbounded growth', async () => {
    vi.mocked(loadDismissedStaging).mockResolvedValue(['a', 'b']);
    await addDismissedStagingKeys(['b', 'c', null, undefined, '']);
    expect(saveDismissedStaging).toHaveBeenCalledWith(['a', 'b', 'c']);
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

  it('caches embedded sidecar bytes and keeps the staging item lean', async () => {
    const hash = 'f'.repeat(64);
    const item = createStagingItem({
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: 'Embedded letter',
      summary: 'From folder watch',
      sourceHash: hash,
      sourceFileName: 'letter.pdf',
    });
    const added = await importStagingSidecars([
      {
        version: 1,
        item,
        fileBase64: btoa('pdf-bytes'),
        fileMimeType: 'application/pdf',
      },
    ]);
    expect(added).toBe(1);
    expect(putCachedLetterBlob).toHaveBeenCalledWith(
      hash,
      expect.objectContaining({ type: 'application/pdf' }),
    );
    const saved = vi.mocked(saveStagingQueue).mock.calls.at(-1)?.[0] as StagingItem[];
    const row = saved.find((r) => r.sourceHash === hash);
    expect(row).toBeTruthy();
    expect((row as unknown as { fileBase64?: string }).fileBase64).toBeUndefined();
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

describe('staging — reconcileStagingQueue', () => {
  let queue: StagingItem[];

  beforeEach(() => {
    vi.mocked(loadStagingQueue).mockImplementation(async () => queue);
    vi.mocked(saveStagingQueue).mockImplementation(async (items) => {
      queue = items;
    });
  });

  const mk = (
    id: string,
    opts: Partial<StagingItem> & { createdAt?: number } = {},
  ): StagingItem =>
    createStagingItem({
      id,
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: `Folder: ${id}.pdf`,
      summary: '',
      ...opts,
    });

  it('removes duplicate imports on hash + filename, keeping the earliest', async () => {
    queue = [
      { ...mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf' }), createdAt: 100 },
      { ...mk('b', { sourceHash: 'h1', sourceFileName: 'x.pdf' }), createdAt: 50 },
      { ...mk('c', { sourceHash: 'h2', sourceFileName: 'x.pdf' }), createdAt: 10 },
    ];
    const res = await reconcileStagingQueue(async () => undefined);
    expect(res.removed).toBe(1);
    expect(queue.map((i) => i.id).sort()).toEqual(['b', 'c']);
  });

  it('backfills patient and claim names from the enricher', async () => {
    queue = [mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf' })];
    const res = await reconcileStagingQueue(async () => ({
      patientName: 'Jane Doe',
      claimNumber: 'P123',
    }));
    expect(res.renamed).toBe(1);
    expect(queue[0].patientName).toBe('Jane Doe');
    expect(queue[0].claimNumber).toBe('P123');
  });

  it('does not persist when nothing changes', async () => {
    queue = [mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf', patientName: 'Jane Doe' })];
    vi.mocked(saveStagingQueue).mockClear();
    const res = await reconcileStagingQueue(async () => ({ patientName: 'Jane Doe' }));
    expect(res.removed).toBe(0);
    expect(res.renamed).toBe(0);
    expect(saveStagingQueue).not.toHaveBeenCalled();
  });

  it('skips enrichment for non-pending items', async () => {
    queue = [mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf', status: 'approved' })];
    const enrich = vi.fn(async () => ({ patientName: 'Should Not Apply' }));
    const res = await reconcileStagingQueue(enrich);
    expect(enrich).not.toHaveBeenCalled();
    expect(res.renamed).toBe(0);
  });
});

describe('staging — analyzeStagingQueue', () => {
  const mk = (
    id: string,
    opts: Partial<StagingItem> = {},
  ): StagingItem =>
    createStagingItem({
      id,
      type: 'letter-import-pending',
      source: 'folder',
      severity: 'info',
      title: `Folder: ${id}.pdf`,
      summary: '',
      ...opts,
    });

  it('counts named, unnamed, and byte-identical duplicates', () => {
    const items = [
      mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf', patientName: 'Jane Doe' }),
      mk('b', { sourceHash: 'h1', sourceFileName: 'y.pdf' }), // same bytes, different name
      mk('c', { sourceHash: 'h1', sourceFileName: 'x.pdf' }), // exact dupe of a
      mk('d', { sourceHash: 'h2', sourceFileName: 'z.pdf', patientName: 'John Roe' }),
      mk('e', {}), // legacy, no hash
    ];
    const a = analyzeStagingQueue(items);
    expect(a.total).toBe(5);
    expect(a.named).toBe(2);
    expect(a.unnamed).toBe(3);
    expect(a.withHash).toBe(4);
    expect(a.withoutHash).toBe(1);
    expect(a.uniqueByHash).toBe(3); // h1, h2, + 1 no-hash row
    expect(a.byteIdenticalExtras).toBe(2); // b and c share h1 with a
    expect(a.exactDuplicates).toBe(1); // c matches a on hash+filename
  });

  it('ignores non-pending items', () => {
    const items = [
      mk('a', { sourceHash: 'h1', sourceFileName: 'x.pdf', status: 'approved' }),
      mk('b', { sourceHash: 'h2', sourceFileName: 'y.pdf' }),
    ];
    const a = analyzeStagingQueue(items);
    expect(a.total).toBe(1);
    expect(a.uniqueByHash).toBe(1);
  });
});
