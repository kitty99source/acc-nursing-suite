import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

// React 18 requires this flag for act(...) to drive effects in a test env.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import fixture from '../lib/__fixtures__/email-sync-status.sample.json';
import { LOCAL_EMAIL_SYNC_STATUS_URL } from '../lib/emailSyncStatus';
import { LOCAL_EMAIL_SYNC_TRIGGER_URL } from '../lib/emailSyncRefresh';

// Staging reads/writes IndexedDB, which jsdom lacks — stub it so the component
// mounts. This does NOT edit staging.ts; it only isolates the render.
vi.mock('../lib/staging', () => ({
  loadStagingItems: vi.fn(async () => []),
  addStagingItem: vi.fn(async () => {}),
}));

import { AccInbox } from './AccInbox';
import { useStore } from '../state/store';
import { emptyData } from '../lib/sampleData';

let container: HTMLDivElement;
let root: Root;

async function flush() {
  // Let the mount effect's fetch + setState settle.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  useStore.setState({ data: emptyData(), accInboxSyncStatus: undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, queued: true }),
        } as unknown as Response;
      }
      if (String(url) === LOCAL_EMAIL_SYNC_STATUS_URL) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(fixture),
        } as unknown as Response;
      }
      void init;
      return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    }),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Subjects of the actual rendered letter rows (not the sync-status summary list). */
function renderedRowSubjects(): string[] {
  return Array.from(container.querySelectorAll('.font-medium.truncate')).map(
    (el) => el.textContent ?? '',
  );
}

describe('<AccInbox /> render from synthetic sync fixture', () => {
  it('renders real synced ACC letters with Claim/ACCID badges', async () => {
    await act(async () => {
      root.render(<AccInbox />);
    });
    await flush();

    const rowSubjects = renderedRowSubjects();
    const text = container.textContent ?? '';
    // (a) real rows render from savedFiles (two ACC letters, newsletter excluded)
    expect(rowSubjects).toHaveLength(2);
    expect(rowSubjects.some((s) => s.includes('Ms Fakey McTestface'))).toBe(true);
    expect(rowSubjects.some((s) => s.includes('Mr Sample Q Public'))).toBe(true);
    // (b) Claim/ACCID badges parse correctly (badge text "Claim 900…" has no colon,
    // so it only appears on a rendered row, never in the raw savedFiles summary).
    expect(text).toContain('Claim 90000000001');
    expect(text).toContain('VEND-FAKE001');
    // (c) non-ACC newsletter is filtered out of the row list
    expect(rowSubjects.some((s) => s.includes('July team newsletter'))).toBe(false);
    // (e) demo/no-sync stubs never appear when real data is present
    expect(text).not.toContain('No sync yet');
  });

  it('renders a saved letter whose subject is name-only (no Claim/ACCID)', async () => {
    // Real-world "Steyn"/"Watson" case: allowlisted sender + PDF, but the subject has no
    // Claim:/ACCID: token. Under the capture-rule change this saved letter must still render.
    const nameOnlyStatus = {
      version: 1,
      lastRunAt: '2026-07-08T10:00:00.000Z',
      outcome: 'ok',
      mode: 'backlog',
      savedCount: 1,
      skippedCount: 0,
      errorCount: 0,
      savedFiles: [
        {
          fileName: 'Steyn.pdf',
          subject: 'Steyn',
          sender: 'John.Bentley@acc.co.nz',
          savedAt: '2026-07-08T10:00:00.000Z',
        },
      ],
      errors: [],
      inboxPath: '',
      sharedMailbox: 'ACCDistrictNursing',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true, queued: true }),
          } as unknown as Response;
        }
        if (String(url) === LOCAL_EMAIL_SYNC_STATUS_URL) {
          return { ok: true, status: 200, text: async () => JSON.stringify(nameOnlyStatus) } as unknown as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as unknown as Response;
      }),
    );

    await act(async () => {
      root.render(<AccInbox />);
    });
    await flush();

    const rowSubjects = renderedRowSubjects();
    expect(rowSubjects).toHaveLength(1);
    expect(rowSubjects[0]).toBe('Steyn');
    const text = container.textContent ?? '';
    expect(text).not.toContain('synced letter(s) hidden');
    expect(text).not.toContain('No sync yet');
  });

  it('keeps the loaded rows after navigating away and back (no "no sync yet")', async () => {
    // First mount: report is served, rows render and get cached in the store.
    await act(async () => {
      root.render(<AccInbox />);
    });
    await flush();
    expect(renderedRowSubjects()).toHaveLength(2);
    expect(useStore.getState().accInboxSyncStatus).toBeTruthy();

    // Simulate leaving ACC Inbox (unmount) — mirrors switching modules in App.
    act(() => root.unmount());

    // While away, helper stops serving the report (fetch now 404s). Before
    // the fix, the remount would clobber state with null → "No sync yet".
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === LOCAL_EMAIL_SYNC_TRIGGER_URL) {
          return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
        }
        return { ok: false, status: 404, text: async () => '' } as unknown as Response;
      }),
    );

    // Return to ACC Inbox: fresh component instance, same store.
    root = createRoot(container);
    await act(async () => {
      root.render(<AccInbox />);
    });
    await flush();

    const text = container.textContent ?? '';
    expect(renderedRowSubjects()).toHaveLength(2);
    expect(text).not.toContain('No sync yet');
  });

  it('shows the hidden-by-filters empty state when settings hide every synced file', async () => {
    // Narrow the sender allowlist to something no fixture row matches; the merge
    // keeps Claim:/ACCID: subject patterns but the sender gate hides everything.
    useStore.getState().updateSettings({
      accInboxSenderAllowlist: ['nobody@nowhere.invalid'],
    });

    await act(async () => {
      root.render(<AccInbox />);
    });
    await flush();

    const text = container.textContent ?? '';
    expect(renderedRowSubjects()).toHaveLength(0);
    expect(text).toContain('synced letter(s) hidden');
    // The letters exist but are hidden — not the "no sync yet" state.
    expect(text).not.toContain('No sync yet');
  });
});
