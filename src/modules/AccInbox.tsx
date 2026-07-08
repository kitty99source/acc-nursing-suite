import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Badge, EmptyState } from '../components/ui';
import { IconFolder } from '../components/icons';
import {
  accInboxConfigFromSettings,
  filterAccInboxRows,
  type AccInboxRow,
} from '../lib/accInboxFilters';
import { loadStagingItems, addStagingItem, type StagingItem } from '../lib/staging';
import {
  describeEmailSyncStatusRejectReason,
  EMAIL_SYNC_STATUS_HINT_PATH,
  fetchLocalEmailSyncStatus,
  formatScanStatsSummary,
  formatSyncOutcome,
  inboxRowsFromSyncStatus,
  parseEmailSyncStatusFromText,
  parseEmailSyncStateFallback,
  stripJsonBom,
  type EmailSyncStatus,
} from '../lib/emailSyncStatus';

/** Demo rows until Outlook COM bridge feeds live manifest (P8-017). */
const DEMO_ROWS: AccInboxRow[] = [
  {
    id: 'demo-1',
    sender: 'nursing@acc.co.nz',
    subject: 'Approval — Extended Nursing NUR02 (stub)',
    receivedAt: Date.now() - 3600_000,
    attachmentName: 'approval-stub.pdf',
    attachmentExt: '.pdf',
  },
  {
    id: 'demo-2',
    sender: 'acc.co.nz',
    subject: 'Decline NUR04VEN — service not approved (stub)',
    receivedAt: Date.now() - 7200_000,
    attachmentName: 'decline-stub.pdf',
    attachmentExt: '.pdf',
  },
];

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('en-NZ');
}

export function AccInbox() {
  const settings = useStore((s) => s.data.settings);
  const setFocus = useStore((s) => s.setFocus);
  const [ignored, setIgnored] = useState<Set<string>>(() => new Set());
  const [stagingCount, setStagingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<EmailSyncStatus | null>(null);
  const syncInputRef = useRef<HTMLInputElement>(null);

  const filterConfig = useMemo(
    () => accInboxConfigFromSettings(settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns),
    [settings.accInboxSenderAllowlist, settings.accInboxSubjectPatterns],
  );

  const syncRows = useMemo(
    () => (syncStatus ? inboxRowsFromSyncStatus(syncStatus) : []),
    [syncStatus],
  );

  const useLiveRows = syncStatus !== null;

  const rows = useMemo(() => {
    const source = syncStatus ? syncRows : DEMO_ROWS;
    return filterAccInboxRows(source, filterConfig).filter((r) => !ignored.has(r.id));
  }, [filterConfig, ignored, syncRows, syncStatus]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const local = await fetchLocalEmailSyncStatus();
      if (!cancelled && local) {
        setSyncStatus(local);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshStaging() {
    const items = await loadStagingItems();
    setStagingCount(items.length);
  }

  async function parseToStaging(row: AccInboxRow) {
    if (settings.automationPaused) {
      setMessage('Automation is paused — enable in Settings before parsing to staging.');
      return;
    }
    const item: StagingItem = {
      id: crypto.randomUUID(),
      type: 'letter-import-pending',
      status: 'pending',
      source: 'email',
      createdAt: Date.now(),
      severity: 'info',
      title: `ACC Inbox: ${row.attachmentName}`,
      summary: `${row.subject} — awaiting HRQ review (stub; attach real PDF or Word letter via folder watch).`,
      sourceFileName: row.attachmentName,
      runId: `acc-inbox-${new Date().toISOString().slice(0, 10)}`,
    };
    await addStagingItem(item);
    await refreshStaging();
    setMessage(`Staged "${row.attachmentName}" for Human Review Queue.`);
    setFocus({ module: 'patients' });
  }

  function openImportStub(row: AccInboxRow) {
    setMessage(
      `Real letter required: save ${row.attachmentName} to ACC-Inbox/ or use Review Queue after folder watch + email sync.`,
    );
    setFocus({ module: 'patients' });
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
          setMessage(null);
          return;
        }
        throw new Error(describeEmailSyncStatusRejectReason(raw, file.name));
      }
      setSyncStatus(parsed);
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not read sync report.');
    }
  }

  return (
    <div>
      <SectionTitle
        title="ACC Inbox"
        subtitle="Filtered ACC letters only — run Start Email Sync.cmd on work laptop, then folder watch."
      />

      {settings.automationPaused && (
        <div className="card mb-4 p-3 text-sm" style={{ borderColor: 'var(--warn-fg)' }}>
          <strong>Automation paused.</strong> Folder watch, email sync, and inbox parse are held until you turn this off in Settings.
        </div>
      )}

      <Card className="mb-4 p-4">
        <h3 className="font-semibold mb-2 text-sm">Email sync status</h3>
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
        <button className="btn btn-sm" type="button" onClick={() => syncInputRef.current?.click()}>
          Load sync report
        </button>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Filter rules: {settings.accInboxSenderAllowlist.length} sender(s), {settings.accInboxSubjectPatterns.length} subject pattern(s) — edit via Settings office config.
        </p>
      </Card>

      {message && (
        <div className="card mb-4 p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
          {message}
        </div>
      )}

      <div className="card mb-4 p-3 text-xs" style={{ color: 'var(--muted)' }}>
        {useLiveRows
          ? 'Rows from last email sync (demo hidden). Run folder watch, then import staging in Review Queue.'
          : 'Demo rows until email sync runs. After sync: folder watch, then Review Queue.'}
        {stagingCount > 0 && ` · ${stagingCount} item(s) already in HRQ staging.`}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconFolder width={32} height={32} />}
          title="No ACC letters in inbox"
          message="Filtered ACC correspondence will appear here after email sync + folder watch on the work laptop."
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
                  <div className="text-xs mt-1 flex items-center gap-2">
                    <Badge tone="accent">{row.attachmentName}</Badge>
                    {!useLiveRows && <span style={{ color: 'var(--muted)' }}>demo</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  <button className="btn btn-sm btn-primary" type="button" onClick={() => void parseToStaging(row)}>
                    Parse → staging
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => openImportStub(row)}>
                    Open import
                  </button>
                  <button className="btn btn-sm" type="button" onClick={() => setIgnored((s) => new Set(s).add(row.id))}>
                    Ignore
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
