import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Badge, EmptyState } from '../components/ui';
import { IconFolder } from '../components/icons';
import { HelperTip } from '../components/HelperTip';
import {
  accInboxConfigFromSettings,
  filterSavedAccInboxRows,
  type AccInboxRow,
} from '../lib/accInboxFilters';
import { loadStagingItems, addStagingItem, type StagingItem } from '../lib/staging';
import {
  claimTokenFromSubject,
  descriptiveAttachmentName,
  patientNameFromSubject,
} from '../lib/attachmentNaming';
import {
  describeEmailSyncStatusRejectReason,
  describeInboxEmptyState,
  EMAIL_SYNC_STATUS_HINT_PATH,
  formatScanStatsSummary,
  formatSyncOutcome,
  inboxRowsFromSyncStatus,
  parseEmailSyncStatusFromText,
  parseEmailSyncStateFallback,
  stripJsonBom,
} from '../lib/emailSyncStatus';
import {
  formatElapsedMs,
  refreshEmailSyncStatus,
  syncRefreshStatusText,
  type SyncRefreshPhase,
} from '../lib/emailSyncRefresh';

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('en-NZ');
}

export function AccInbox() {
  const settings = useStore((s) => s.data.settings);
  const setFocus = useStore((s) => s.setFocus);
  const showTopBarFlash = useStore((s) => s.showTopBarFlash);
  // Sync status lives in the store so it survives leaving/returning to ACC Inbox
  // (see setAccInboxSyncStatus). Local component state reset on every mount was
  // the cause of the "no sync yet" flash after navigating away.
  const syncStatus = useStore((s) => s.accInboxSyncStatus) ?? null;
  const setSyncStatus = useStore((s) => s.setAccInboxSyncStatus);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const [stagingCount, setStagingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // Only show the blocking first-load empty state when nothing is cached yet;
  // a cached report stays visible under the progress panel while we refresh.
  const [syncLoading, setSyncLoading] = useState(() => !useStore.getState().accInboxSyncStatus);
  const [refreshPhase, setRefreshPhase] = useState<SyncRefreshPhase | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const syncInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const refreshStartedAt = useRef<number | null>(null);

  const filterConfig = useMemo(
    () => accInboxConfigFromSettings(settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns),
    [settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns],
  );

  const syncRows = useMemo(
    () => (syncStatus ? inboxRowsFromSyncStatus(syncStatus) : []),
    [syncStatus],
  );

  const rows = useMemo(() => {
    // Keep the last audit list visible during refresh so the screen doesn't look hung.
    if (!syncStatus) return [];
    return filterSavedAccInboxRows(syncRows, filterConfig).filter((r) => !ignored.has(r.id));
  }, [filterConfig, ignored, syncRows, syncStatus]);

  // Only relevant when the list is empty: syncRows.length > 0 with rows empty
  // means real synced letters exist but the sender sanity check/Ignore hid them all.
  const emptyState = useMemo(
    () =>
      describeInboxEmptyState(
        syncStatus,
        syncLoading && !syncStatus,
        rows.length === 0 ? syncRows.length : 0,
      ),
    [rows.length, syncLoading, syncRows.length, syncStatus],
  );

  useEffect(() => {
    if (!syncLoading || refreshStartedAt.current == null) return;
    const tick = window.setInterval(() => {
      const started = refreshStartedAt.current;
      if (started != null) setElapsedMs(Date.now() - started);
    }, 250);
    return () => window.clearInterval(tick);
  }, [syncLoading]);

  async function refreshSyncStatus(opts?: { triggerSync?: boolean }) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    refreshStartedAt.current = Date.now();
    setElapsedMs(0);
    setSyncLoading(true);
    setRefreshPhase('connecting');
    setMessage(null);
    try {
      const result = await refreshEmailSyncStatus({
        signal: ctrl.signal,
        triggerSync: opts?.triggerSync !== false,
        onPhase: (phase, status) => {
          setRefreshPhase(phase);
          if (status) setSyncStatus(status);
        },
      });
      if (result.cancelled) {
        setMessage(syncRefreshStatusText('cancelled'));
        return;
      }
      if (result.phase === 'stopped') {
        setMessage(
          result.status?.errors?.[0]
            ? `Sync stopped — ${result.status.errors[0]}. Press Refresh to try again. Keep Outlook open (not as Administrator), then use the quiet starter.`
            : 'Mail check did not finish — press Refresh to try again. Outlook must be open and signed in; start the suite with the quiet desktop shortcut (not as Administrator).',
        );
        if (result.status) setSyncStatus(result.status);
        return;
      }
      if (result.status) {
        setSyncStatus(result.status);
        setMessage(null);
      } else if (useStore.getState().accInboxSyncStatus) {
        setMessage(
          'Could not get a fresh mail report — showing the last one. Press Refresh again, or use “Load sync report” if you have a saved file.',
        );
      } else {
        setSyncStatus(undefined);
        if (result.phase === 'error') {
          setMessage(
            'Could not reach the local helper. Start the suite with the quiet starter (desktop shortcut), keep the tab open, then press Refresh.',
          );
        }
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      refreshStartedAt.current = null;
      setSyncLoading(false);
      setRefreshPhase(null);
    }
  }

  function cancelRefresh() {
    abortRef.current?.abort();
  }

  // On mount, only re-read the last mail report (no Outlook COM). Pressing
  // Refresh is what asks the helper to check mail again.
  async function initialLoadSyncStatus() {
    await refreshSyncStatus({ triggerSync: false });
  }

  useEffect(() => {
    void initialLoadSyncStatus();
    void refreshStaging();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function refreshStaging() {
    const items = await loadStagingItems();
    setStagingCount(items.length);
  }

  async function parseToStaging(row: AccInboxRow) {
    // Manual IndexedDB write — works without launch.ps1 /_acc/staging. Prefer folder-watch
    // sidecars when the launcher bridge is up; this path is the reliable fallback when it is not.
    if (settings.automationPaused) {
      setMessage('Automation is paused — enable in Settings before parsing to staging.');
      return;
    }
    const patientName = patientNameFromSubject(row.subject);
    const claimNumber = row.claimNumber ?? claimTokenFromSubject(row.subject);
    const expectedFileName = descriptiveAttachmentName(row.subject, row.attachmentName);
    const item: StagingItem = {
      id: crypto.randomUUID(),
      type: 'letter-import-pending',
      status: 'pending',
      source: 'email',
      createdAt: Date.now(),
      severity: 'info',
      title: `ACC Inbox: ${row.attachmentName}`,
      summary: `${row.subject} — manually staged from ACC Inbox (IndexedDB). Prefer folder-watch + launch.ps1 auto-import when available.`,
      sourceFileName: row.attachmentName,
      patientName,
      claimNumber,
      accId: row.accId,
      expectedFileName,
      runId: `acc-inbox-${new Date().toISOString().slice(0, 10)}`,
    };
    await addStagingItem(item);
    await refreshStaging();
    showTopBarFlash(
      `Staged "${row.attachmentName}" into Review Queue (IndexedDB). This is the path that works without /_acc/staging.`,
      'good',
    );
    setFocus({ module: 'review' });
  }

  function goToReviewQueue() {
    // Navigation only — does NOT write staging. If Review is empty, auto-import needs
    // launch.ps1 serving /_acc/staging, or use Advanced: stage / Import .staging folder.
    showTopBarFlash(
      'Opened Review Queue (navigation only). Letters appear there from folder-watch via launch.ps1, or after Advanced: stage / Import .staging.',
      'good',
    );
    setFocus({ module: 'review' });
  }

  async function loadSyncReport(file: File) {
    try {
      const text = await file.text();
      let raw: unknown;
      try {
        raw = JSON.parse(stripJsonBom(text)) as unknown;
      } catch {
        throw new Error(
          `Could not parse JSON. Pick ${EMAIL_SYNC_STATUS_HINT_PATH} (not email-sync-state.json or a log file).`,
        );
      }
      const parsed = parseEmailSyncStatusFromText(text);
      if (!parsed) {
        const fallback = parseEmailSyncStateFallback(raw);
        if (fallback) {
          setSyncStatus(fallback);
          setSyncLoading(false);
          setMessage(null);
          return;
        }
        throw new Error(describeEmailSyncStatusRejectReason(raw, file.name));
      }
      setSyncStatus(parsed);
      setSyncLoading(false);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read sync report.');
    }
  }

  const showProgressPanel = syncLoading && refreshPhase != null;

  return (
    <div>
      <SectionTitle
        title="ACC Inbox"
        subtitle="Shows the latest mail check from Outlook. Filing happens in Review Queue. Open Review Queue only navigates; Advanced: stage writes a queue row when the helper is offline."
      />

      {settings.automationPaused && (
        <div className="card mb-4 p-3 text-sm" style={{ borderColor: 'var(--warn-fg)' }}>
          <strong>Automation paused.</strong> Folder watch, email sync, and inbox parse are held until you turn this off in Settings.
        </div>
      )}

      {showProgressPanel && (
        <div
          className="card mb-4 p-4"
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{ borderColor: 'var(--accent)', background: 'var(--accent-soft)' }}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <span className="spinner shrink-0 mt-1" aria-hidden style={{ width: '1.25rem', height: '1.25rem' }} />
              <div className="min-w-0">
                <h3 className="font-semibold text-sm">Refreshing mail</h3>
                <p className="text-sm mt-1">{syncRefreshStatusText(refreshPhase, syncStatus)}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                  Elapsed {formatElapsedMs(elapsedMs)}
                  {syncStatus?.outcome === 'running'
                    ? ' · Cancel only stops waiting here — Outlook keeps checking mail.'
                    : ' · Cancel stops waiting here; it does not undo a finished check.'}
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-sm shrink-0" onClick={cancelRefresh}>
              Cancel wait
            </button>
          </div>
        </div>
      )}

      <Card className="mb-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-semibold text-sm">Email sync status</h3>
          <button className="btn btn-sm btn-primary" type="button" onClick={goToReviewQueue}>
            Open Review Queue
            {stagingCount > 0 ? ` (${stagingCount})` : ''}
          </button>
        </div>
        {syncStatus ? (
          <>
            <p className="text-sm mb-2">{formatSyncOutcome(syncStatus)}</p>
            {syncStatus.scanStats && syncStatus.savedCount === 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                Scan detail: {formatScanStatsSummary(syncStatus.scanStats)}
                {syncStatus.sharedMailbox
                  ? ` · mailbox: ${syncStatus.sharedMailbox}`
                  : ' · mailbox: ACCDistrictNursing (default)'}
              </p>
            )}
          </>
        ) : syncLoading ? (
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            Please wait — starting the local helper and checking mail…
          </p>
        ) : (
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            No mail report yet. Start the suite with the quiet desktop shortcut (Outlook should be
            open), then press Refresh. Or use Load sync report if someone gave you a status file.
          </p>
        )}
        {syncStatus && syncStatus.savedFiles.length > 0 && (
          <ul className="text-xs mb-2 list-disc pl-4" style={{ color: 'var(--muted)' }}>
            {syncStatus.savedFiles.slice(0, 5).map((f) => (
              <li key={f.fileName + f.savedAt}>
                {f.fileName} — {f.subject.slice(0, 48)}
              </li>
            ))}
          </ul>
        )}
        <input
          ref={syncInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadSyncReport(f);
            e.target.value = '';
          }}
        />
        <div className="flex flex-wrap gap-2">
          <HelperTip tipId="tip-acc-inbox-refresh">
            <button
              className="btn btn-sm"
              type="button"
              disabled={syncLoading}
              onClick={() => void refreshSyncStatus({ triggerSync: true })}
            >
              {syncLoading ? 'Refreshing…' : 'Refresh sync status'}
            </button>
          </HelperTip>
          <button className="btn btn-sm" type="button" onClick={() => syncInputRef.current?.click()}>
            Load sync report
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Filter rules: {settings.accInboxSenderAllowlist.length} sender(s), {settings.accInboxSubjectPatterns.length} subject pattern(s) — edit via Settings office config.
        </p>
      </Card>

      {message && (
        <div className="card mb-4 p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
          {message}
        </div>
      )}

      {syncStatus && (
        <div className="card mb-4 p-3 text-xs" style={{ color: 'var(--muted)' }}>
          Audit list of letters saved by the last email sync. Staging and filing happen in the{' '}
          <button type="button" className="underline" onClick={goToReviewQueue}>
            Review Queue
          </button>
          {stagingCount > 0 && ` · ${stagingCount} item(s) already in HRQ staging`}.
        </div>
      )}

      {!syncStatus && syncLoading ? (
        <EmptyState
          icon={<IconFolder width={32} height={32} />}
          title={emptyState.title}
          message={emptyState.message}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<IconFolder width={32} height={32} />}
          title={emptyState.title}
          message={emptyState.message}
        />
      ) : (
        <div className="space-y-2" style={syncLoading ? { opacity: 0.72 } : undefined}>
          {rows.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{row.subject}</div>
                  <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                    {row.sender} · {formatWhen(row.receivedAt)}
                  </div>
                  <div className="text-xs mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone="accent">{row.attachmentName}</Badge>
                    {row.claimNumber && <Badge tone="neutral">Claim {row.claimNumber}</Badge>}
                    {row.accId && <Badge tone="neutral">{row.accId}</Badge>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button
                    className="btn btn-sm btn-primary"
                    type="button"
                    title="Navigate to Review Queue only — does not stage this letter"
                    onClick={goToReviewQueue}
                  >
                    Open Review Queue
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Writes this sync row into Review Queue IndexedDB (works without /_acc/staging). Prefer folder-watch auto-import when launch.ps1 is serving."
                    onClick={() => void parseToStaging(row)}
                  >
                    Advanced: stage
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => setIgnored((s) => new Set(s).add(row.id))}>
                    Hide
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
