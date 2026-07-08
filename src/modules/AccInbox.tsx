import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Badge, EmptyState } from '../components/ui';
import { IconFolder } from '../components/icons';
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
  fetchLocalEmailSyncStatus,
  formatScanStatsSummary,
  formatSyncOutcome,
  inboxRowsFromSyncStatus,
  parseEmailSyncStatusFromText,
  parseEmailSyncStateFallback,
  stripJsonBom,
} from '../lib/emailSyncStatus';

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
  // Only show the blocking "Loading…" state when nothing is cached yet; a cached
  // report stays visible while we refresh in the background.
  const [syncLoading, setSyncLoading] = useState(() => !useStore.getState().accInboxSyncStatus);
  const syncInputRef = useRef<HTMLInputElement>(null);

  const filterConfig = useMemo(
    () => accInboxConfigFromSettings(settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns),
    [settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns],
  );

  const syncRows = useMemo(
    () => (syncStatus ? inboxRowsFromSyncStatus(syncStatus) : []),
    [syncStatus],
  );

  const rows = useMemo(() => {
    if (syncLoading || !syncStatus) return [];
    // Saved files are already vetted by outlook-sync.ps1 (sender + supported attachment). We show
    // them regardless of subject tokens — a name-only subject (no Claim:/ACCID:) must NOT hide a
    // legitimately saved letter. Only a light sender/extension sanity check remains.
    return filterSavedAccInboxRows(syncRows, filterConfig).filter((r) => !ignored.has(r.id));
  }, [filterConfig, ignored, syncRows, syncLoading, syncStatus]);

  // Only relevant when the list is empty: syncRows.length > 0 with rows empty
  // means real synced letters exist but the sender sanity check/Ignore hid them all.
  const emptyState = useMemo(
    () => describeInboxEmptyState(syncStatus, syncLoading, rows.length === 0 ? syncRows.length : 0),
    [rows.length, syncLoading, syncRows.length, syncStatus],
  );

  async function refreshSyncStatus() {
    setSyncLoading(true);
    try {
      const local = await fetchLocalEmailSyncStatus();
      if (local) {
        setSyncStatus(local);
        setMessage(null);
      } else if (useStore.getState().accInboxSyncStatus) {
        // launch.ps1 isn't serving a report right now, but we already have one
        // loaded — keep it rather than dropping to the "no sync yet" state.
        setMessage('No served sync report found — showing the last loaded status. Click "Load sync report" to update it.');
      } else {
        setSyncStatus(undefined);
      }
    } finally {
      setSyncLoading(false);
    }
  }

  // On mount, refresh from the locally served report. If nothing is served
  // (e.g. status was loaded manually via the file picker), keep the cached
  // status already in the store so the rows persist across navigation.
  async function initialLoadSyncStatus() {
    const cached = useStore.getState().accInboxSyncStatus;
    if (!cached) {
      await refreshSyncStatus();
      return;
    }
    const local = await fetchLocalEmailSyncStatus();
    if (local) setSyncStatus(local);
  }

  useEffect(() => {
    void initialLoadSyncStatus();
    void refreshStaging();
  }, []);

  async function refreshStaging() {
    const items = await loadStagingItems();
    setStagingCount(items.length);
  }

  async function parseToStaging(row: AccInboxRow) {
    // Legacy path kept for advanced/troubleshooting only — primary ingestion is folder-watch
    // sidecars auto-imported into the Review Queue via /_acc/staging.
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
      summary: `${row.subject} — awaiting HRQ review after folder watch picks up ${row.attachmentName}.`,
      sourceFileName: row.attachmentName,
      patientName,
      claimNumber,
      accId: row.accId,
      expectedFileName,
      runId: `acc-inbox-${new Date().toISOString().slice(0, 10)}`,
    };
    await addStagingItem(item);
    await refreshStaging();
    showTopBarFlash(`Added "${row.attachmentName}" to the Review Queue — open it there to file the patient.`, 'good');
    setFocus({ module: 'review' });
  }

  function goToReviewQueue() {
    showTopBarFlash('Review Queue is the primary inbox — letters stage automatically from folder watch.', 'good');
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

  return (
    <div>
      <SectionTitle
        title="ACC Inbox"
        subtitle="Email sync status and saved-letter audit — file patients from the Review Queue (primary inbox)."
      />

      {settings.automationPaused && (
        <div className="card mb-4 p-3 text-sm" style={{ borderColor: 'var(--warn-fg)' }}>
          <strong>Automation paused.</strong> Folder watch, email sync, and inbox parse are held until you turn this off in Settings.
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
        {syncLoading ? (
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            Loading sync report from <span className="font-mono">launch.ps1</span>…
          </p>
        ) : syncStatus ? (
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
        ) : (
          <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>
            No sync report loaded. On work laptop: run <span className="font-mono">Start Email Sync.cmd</span> or{' '}
            <span className="font-mono">Start WFH Mode.cmd</span> — status auto-loads when served by{' '}
            <span className="font-mono">launch.ps1</span>, or pick{' '}
            <span className="font-mono">{EMAIL_SYNC_STATUS_HINT_PATH}</span> below (not email-sync-state.json).
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
          <button
            className="btn btn-sm"
            type="button"
            disabled={syncLoading}
            onClick={() => void refreshSyncStatus()}
          >
            {syncLoading ? 'Refreshing…' : 'Refresh sync status'}
          </button>
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

      {!syncLoading && syncStatus && (
        <div className="card mb-4 p-3 text-xs" style={{ color: 'var(--muted)' }}>
          Audit list of letters saved by the last email sync. Staging and filing happen in the{' '}
          <button type="button" className="underline" onClick={goToReviewQueue}>
            Review Queue
          </button>
          {stagingCount > 0 && ` · ${stagingCount} item(s) already in HRQ staging`}.
        </div>
      )}

      {syncLoading ? (
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
        <div className="space-y-2">
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
                  <button className="btn btn-sm btn-primary" type="button" onClick={goToReviewQueue}>
                    Open Review Queue
                  </button>
                  <button
                    className="btn btn-sm"
                    type="button"
                    title="Advanced: manually stage this sync row (prefer folder-watch auto-import)"
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
