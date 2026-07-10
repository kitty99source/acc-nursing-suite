import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import type { StagingItem } from '../lib/staging';

// ReviewQueue touches IndexedDB (via staging.ts) and the local launcher bridge
// (via localAccBridge.ts) — neither is available in jsdom, so stub the whole
// surface the same way AccInbox.test.tsx does. This does NOT edit the real
// libs; it only isolates the render so the toolbar layout can be asserted.
const pendingItems: StagingItem[] = [
  {
    id: 'named-1',
    type: 'letter-import-pending',
    status: 'pending',
    source: 'folder',
    createdAt: 1,
    severity: 'info',
    title: 'Folder: named.pdf',
    summary: '',
    patientName: 'Jane Doe',
  },
  {
    id: 'unnamed-1',
    type: 'letter-import-pending',
    status: 'pending',
    source: 'folder',
    createdAt: 2,
    severity: 'info',
    title: 'Folder: unnamed-1.pdf',
    summary: '',
    sourceHash: 'a'.repeat(64),
  },
  {
    id: 'unnamed-2',
    type: 'letter-import-pending',
    status: 'pending',
    source: 'folder',
    createdAt: 3,
    severity: 'info',
    title: 'Folder: unnamed-2.pdf',
    summary: '',
  },
];

// Mutates the shared fixture in place so `updateStagingItem` behaves like the
// real (immutable-map) implementation closely enough for the component's
// subsequent `loadAllStagingItems()` refresh to see the patch.
function applyPatch(id: string, patch: Partial<StagingItem>) {
  const idx = pendingItems.findIndex((i) => i.id === id);
  if (idx >= 0) pendingItems[idx] = { ...pendingItems[idx], ...patch };
}

vi.mock('../lib/staging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/staging')>();
  return {
    ...actual,
    loadStagingItems: vi.fn(async () => pendingItems.filter((i) => i.status === 'pending')),
    loadAllStagingItems: vi.fn(async () => [...pendingItems]),
    importStagingJsonText: vi.fn(async () => 0),
    importStagingSidecars: vi.fn(async () => 0),
    updateStagingItem: vi.fn(async (id: string, patch: Partial<StagingItem>) => applyPatch(id, patch)),
    reconcileStagingQueue: vi.fn(async () => ({ removed: 0, renamed: 0, total: pendingItems.length })),
    analyzeStagingQueue: actual.analyzeStagingQueue,
    removeByteIdenticalDuplicates: vi.fn(async () => 0),
    removeUnnamedStagingItems: vi.fn(async () => 0),
    removeUnhashedStagingItems: vi.fn(async () => 0),
    dismissStagingItems: vi.fn(async () => {}),
  };
});

vi.mock('../lib/localAccBridge', () => ({
  probeLocalStagingBridge: vi.fn(async () => ({ status: 'empty', sidecars: [] })),
  fetchInboxFileForStaging: vi.fn(async () => undefined),
  fetchEmailMetaForHash: vi.fn(async () => undefined),
}));

vi.mock('../lib/stagingPreparse', () => ({
  enqueueStagingPreparse: vi.fn(),
  buildStagingPreview: vi.fn(() => null),
  retryUnnamedStagingPreparse: vi.fn(() => 0),
  stagingPreparseStats: vi.fn(() => ({ queued: 0, active: 0, done: 0, unavailable: 0 })),
}));

vi.mock('../lib/letterCache', () => ({
  blobToBase64: vi.fn(async () => 'AA=='),
  getCachedLetterFile: vi.fn(async () => undefined),
  getCachedLetterParse: vi.fn(async () => undefined),
  getCachedLetterParseAny: vi.fn(async () => undefined),
  putCachedLetterBlob: vi.fn(async () => {}),
  putCachedLetterParse: vi.fn(async () => {}),
}));

vi.mock('../lib/hrqBatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/hrqBatch')>();
  return {
    ...actual,
    isAutoAcceptEligible: vi.fn(() => false),
    runAutoAccept: vi.fn(async () => []),
  };
});

vi.mock('../lib/auditLog', () => ({
  appendAudit: vi.fn(async () => {}),
  recordHrqResolution: vi.fn(async () => {}),
}));

import { ReviewQueue } from './ReviewQueue';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';

let container: HTMLDivElement;
let root: Root;
const originalPendingItems = pendingItems.map((i) => ({ ...i }));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  pendingItems.splice(0, pendingItems.length, ...originalPendingItems.map((i) => ({ ...i })));
  useStore.setState({ data: emptyData() });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function buttonTexts(scope: ParentNode = container): string[] {
  return Array.from(scope.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');
}

function moreMenu(): HTMLElement | null {
  return container.querySelector('[role="menu"]');
}

describe('<ReviewQueue /> toolbar layout (item 5)', () => {
  it('shows Fix names now, Discard unnamed, and Check queue health as primary always-visible buttons', async () => {
    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Fix names now (2)')).toBe(true);
    expect(texts.some((t) => t === 'Discard unnamed (2)')).toBe(true);
    expect(texts.some((t) => t === 'Check queue health')).toBe(true);
    expect(texts.some((t) => t === 'Refresh')).toBe(true);
  });

  it('keeps the primary action buttons OUTSIDE the "More" overflow menu', async () => {
    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    const moreButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'More ▾',
    );
    expect(moreButton).toBeTruthy();

    await act(async () => {
      moreButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const menu = moreMenu();
    expect(menu).toBeTruthy();
    const menuTexts = buttonTexts(menu!);
    // These moved OUT of the overflow menu and into the always-visible row.
    expect(menuTexts.some((t) => t.startsWith('Fix names now'))).toBe(false);
    expect(menuTexts.some((t) => t === 'Check review list health')).toBe(false);
    // These stay in "More" — lower-frequency actions.
    expect(menuTexts.some((t) => t === 'Import letters from folder')).toBe(true);
    expect(menuTexts.some((t) => t === 'Import letter files')).toBe(true);
  });
});

describe('<ReviewQueue /> auto-accept eligible count (Auto-accept ready (N) button)', () => {
  it('surfaces "Auto-accept ready (N)" as soon as any item carries the denormalized autoAcceptEligible flag', async () => {
    // Regression test for the bug where isAutoAcceptEligible gated on
    // item.parsedPreview (a field never written under the lean-queue
    // redesign), which made this button permanently invisible. Here
    // isAutoAcceptEligible is mocked directly (ReviewQueue.tsx just filters
    // `sorted` with it — see the `autoAcceptEligible` useMemo), so this
    // proves the toolbar count reacts to the real gate function's result
    // rather than any legacy shape.
    const { isAutoAcceptEligible } = await import('../lib/hrqBatch');
    vi.mocked(isAutoAcceptEligible).mockImplementation(
      (item) => item.id === 'named-1' && item.status === 'pending',
    );

    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    expect(buttonTexts().some((t) => t === 'Auto-accept ready (1)')).toBe(true);
  });

  it('does not show the button when no item is auto-accept eligible', async () => {
    const { isAutoAcceptEligible } = await import('../lib/hrqBatch');
    vi.mocked(isAutoAcceptEligible).mockImplementation(() => false);

    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    expect(buttonTexts().some((t) => t.startsWith('Auto-accept ready'))).toBe(false);
  });
});

describe('<ReviewQueue /> Unnamed tab (filtered view of the pending queue)', () => {
  it('shows the tab counts and filters the list to nameless pending items only', async () => {
    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    const texts = buttonTexts();
    expect(texts.some((t) => t === 'Under review (3)')).toBe(true);
    expect(texts.some((t) => t === 'Unnamed (2)')).toBe(true);
    expect(texts.some((t) => t === 'Deferred (0)')).toBe(true);

    const unnamedTab = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Unnamed (2)',
    );
    expect(unnamedTab).toBeTruthy();

    await act(async () => {
      unnamedTab!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();

    const rowTexts = buttonTexts();
    expect(rowTexts.some((t) => t.includes('unnamed-1.pdf'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('unnamed-2.pdf'))).toBe(true);
    expect(rowTexts.some((t) => t.includes('named.pdf'))).toBe(false);

    // Toolbar action counts stay based on the full pending set regardless of tab.
    expect(rowTexts.some((t) => t === 'Fix names now (2)')).toBe(true);
    expect(rowTexts.some((t) => t === 'Discard unnamed (2)')).toBe(true);
  });
});

describe('<ReviewQueue /> list title staleness (item 4)', () => {
  it('updates the list row title as soon as loadSelected resolves a patient name, without a manual Refresh', async () => {
    // jsdom has no Blob/File URL support — PdfPreview only needs a stable stub.
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    const { fetchInboxFileForStaging } = await import('../lib/localAccBridge');
    const { buildStagingPreview } = await import('../lib/stagingPreparse');
    vi.mocked(fetchInboxFileForStaging).mockResolvedValue(
      new File(['pdf-bytes'], 'unnamed-1.pdf', { type: 'application/pdf' }),
    );
    vi.mocked(buildStagingPreview).mockReturnValue({
      kind: 'approval',
      confidence: 95,
      patientName: 'Newly Parsed Patient',
      claimNumber: 'P123',
      parsed: {} as never,
      fileBlobBase64: 'AA==',
      fileName: 'unnamed-1.pdf',
      mimeType: 'application/pdf',
    });
    useStore.setState({
      data: emptyData(),
      parseLetterFile: vi.fn(async () => ({
        parsed: {
          kind: 'approval',
          letterDate: '',
          patient: { name: 'Newly Parsed Patient', nhi: '', dob: '' },
          claim: {
            claimNumber: 'P123',
            acc45Number: '',
            poNumber: '',
            injuryDescription: '',
            dateOfInjury: '',
          },
          serviceRows: [],
          packageRows: [],
        },
        overallConfidence: 95,
        issues: [],
        blockers: [],
        match: {},
      })),
    } as never);

    await act(async () => {
      root.render(<ReviewQueue />);
    });
    await flush();

    // Select the still-unnamed row — its title is the generic "Folder: …" one
    // before the letter attachment has been read.
    const unnamedRow = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('unnamed-1.pdf'),
    );
    expect(unnamedRow).toBeTruthy();
    expect(unnamedRow!.textContent).toContain('Folder: unnamed-1.pdf');

    await act(async () => {
      unnamedRow!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush();
    await flush();

    // The name resolved via loadSelected must "stick" on the LIST row itself —
    // not just the detail form — without the user pressing Refresh.
    const updatedRow = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Newly Parsed Patient'),
    );
    expect(updatedRow).toBeTruthy();
  });
});
