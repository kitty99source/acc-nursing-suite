import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Badge, EmptyState } from '../components/ui';
import { IconFolder } from '../components/icons';
import { filterAccInboxRows, type AccInboxRow } from '../lib/accInboxFilters';
import { loadStagingItems, addStagingItem, type StagingItem } from '../lib/staging';

/** Demo rows until Outlook COM bridge (P8-017) lands on work PC. */
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

  const rows = useMemo(
    () => filterAccInboxRows(DEMO_ROWS).filter((r) => !ignored.has(r.id)),
    [ignored],
  );

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
      summary: `${row.subject} — awaiting HRQ review (stub; attach real PDF via folder watch).`,
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
      `Real PDF required: save ${row.attachmentName} to ACC-Inbox/ or use Review Queue after folder watch. COM bridge blocked until work PC (P8-017).`,
    );
    setFocus({ module: 'patients' });
  }

  return (
    <div>
      <SectionTitle
        title="ACC Inbox"
        subtitle="Filtered ACC letters only — not a full mail client. Outlook COM bridge pending work PC."
      />

      {settings.automationPaused && (
        <div className="card mb-4 p-3 text-sm" style={{ borderColor: 'var(--warn-fg)' }}>
          <strong>Automation paused.</strong> Folder watch and inbox parse are held until you turn this off in Settings.
        </div>
      )}

      {message && (
        <div className="card mb-4 p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
          {message}
        </div>
      )}

      <div className="card mb-4 p-3 text-xs" style={{ color: 'var(--muted)' }}>
        Stub panel (P8-016). Shows demo filtered rows. Live email ingress requires P8-017 on Windows work PC.
        {stagingCount > 0 && ` · ${stagingCount} item(s) already in HRQ staging.`}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconFolder width={32} height={32} />}
          title="No ACC letters in inbox"
          message="Filtered ACC correspondence will appear here after the Outlook COM bridge is configured."
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
                    <span style={{ color: 'var(--muted)' }}>stub</span>
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
