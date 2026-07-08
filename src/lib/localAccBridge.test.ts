import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLocalStagingSidecars, fetchInboxFileByHash } from './localAccBridge';

describe('localAccBridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed sidecars from /_acc/staging', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            version: 1,
            item: {
              id: 'a1',
              type: 'letter-import-pending',
              status: 'pending',
              source: 'folder',
              createdAt: 1,
              severity: 'info',
              title: 'Folder: x.docx',
              summary: 'test',
              sourceFileName: 'x.docx',
              sourceHash: 'a'.repeat(64),
            },
          },
          { version: 99, item: { id: 'bad' } },
        ],
      })),
    );
    const list = await fetchLocalStagingSidecars();
    expect(list).toHaveLength(1);
    expect(list[0].item.id).toBe('a1');
    expect(list[0].item.sourceHash).toBe('a'.repeat(64));
  });

  it('returns [] when staging endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await fetchLocalStagingSidecars()).toEqual([]);
  });

  it('fetches inbox file bytes by hash', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toContain('/_acc/inbox-file?hash=');
        return {
          ok: true,
          blob: async () => new Blob([bytes], { type: 'application/pdf' }),
          headers: { get: (k: string) => (k === 'content-type' ? 'application/pdf' : null) },
        };
      }),
    );
    const file = await fetchInboxFileByHash('b'.repeat(64));
    expect(file).toBeTruthy();
    expect(file!.name).toBe('letter.pdf');
    expect(file!.size).toBe(3);
  });

  it('rejects invalid hash shapes', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await fetchInboxFileByHash('not-a-hash')).toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});
