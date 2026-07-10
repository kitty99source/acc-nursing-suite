import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchLocalStagingSidecars,
  fetchInboxFileByHash,
  fetchInboxFileForStaging,
  probeLocalStagingBridge,
} from './localAccBridge';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n%%EOF');

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
    const probe = await probeLocalStagingBridge();
    expect(probe.status).toBe('ok');
    expect(probe.sidecars).toHaveLength(1);
  });

  it('returns [] when staging endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    expect(await fetchLocalStagingSidecars()).toEqual([]);
    expect(await probeLocalStagingBridge()).toEqual({ status: 'unavailable', sidecars: [] });
  });

  it('reports empty when launch.ps1 returns []', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })));
    expect(await probeLocalStagingBridge()).toEqual({ status: 'empty', sidecars: [] });
  });

  it('reports unavailable on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Failed to fetch');
    }));
    expect(await probeLocalStagingBridge()).toEqual({ status: 'unavailable', sidecars: [] });
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

  it('sniffs the bytes and assigns letter.pdf when content-type gives no hint', async () => {
    // Regression for the "download produces a nameless/typeless file that is
    // actually a valid PDF" bug — launch.ps1 answering with a generic
    // content-type must not leave the resolved file ambiguous when the bytes
    // themselves carry the %PDF- magic number.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([PDF_BYTES], { type: 'application/octet-stream' }),
        headers: { get: (k: string) => (k === 'content-type' ? 'application/octet-stream' : null) },
      })),
    );
    const file = await fetchInboxFileByHash('c'.repeat(64));
    expect(file).toBeTruthy();
    expect(file!.name).toBe('letter.pdf');
    expect(file!.type).toBe('application/pdf');
  });

  it('repairs an extensionless sidecar filename (GUID) using content-sniffing', async () => {
    // The sidecar's sourceFileName/expectedFileName can itself be a bare GUID
    // with no extension — fetchInboxFileForStaging must not clobber the
    // extension fetchInboxFileByHash already worked out from the bytes.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([PDF_BYTES], { type: 'application/octet-stream' }),
        headers: { get: (k: string) => (k === 'content-type' ? 'application/octet-stream' : null) },
      })),
    );
    const file = await fetchInboxFileForStaging({
      sourceHash: 'd'.repeat(64),
      sourceFileName: '2d5d827c-94cd-46f7-8e3e-0ba051001379',
    });
    expect(file).toBeTruthy();
    expect(file!.name).toBe('2d5d827c-94cd-46f7-8e3e-0ba051001379.pdf');
    expect(file!.type).toBe('application/pdf');
  });
});
