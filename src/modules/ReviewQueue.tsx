import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Badge, Card, EmptyState } from '../components/ui';
import { useConfirm } from '../components/useConfirm';
import {
  loadStagingItems,
  importStagingJsonText,
  updateStagingItem,
  stagingAgeLabel,
  type StagingItem,
} from '../lib/staging';
import { hrqSlaStatus, hrqSlaLabel, summarizeQueueSla, type SlaLevel } from '../lib/hrqSla';
import {
  allSelectedBatchApprovable,
  commitBatchStagingItems,
  isBatchApprovable,
  stagingPatientNames,
} from '../lib/hrqBatch';
import { appendAudit, recordHrqResolution } from '../lib/auditLog';
import { LETTER_IMPORT_ACCEPT } from '../components/LetterImportButton';

function slaTone(level: SlaLevel): 'good' | 'warn' | 'danger' {
  if (level === 'danger') return 'danger';
  if (level === 'warn') return 'warn';
  return 'good';
}

function typeLabel(type: StagingItem['type']): string {
  switch (type) {
    case 'letter-import-pending':
      return 'Letter import';
    case 'letter-import-low-confidence':
      return 'Low confidence';
    case 'letter-duplicate-suspect':
      return 'Duplicate suspect';
    case 'portal-fetch-complete':
      return 'Portal fetch';
    case 'automation-failure':
      return 'Automation failure';
    default:
      return type;
  }
}

export function ReviewQueue() {
  const openLetterImport = useStore((s) => s.openLetterImport);
  const commitParsedApproval = useStore((s) => s.commitParsedApproval);
  const commitParsedDecline = useStore((s) => s.commitParsedDecline);
  const userName = useStore((s) => s.data.settings.userDisplayName?.trim() || undefined);
  const [items, setItems] = useState<StagingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, confirmDialog] = useConfirm();
  const sidecarInput = useRef<HTMLInputElement>(null);
  const letterInput = useRef<HTMLInputElement>(null);
  const pendingReviewId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const pending = await loadStagingItems();
    // Oldest first: items closest to the SLA limit surface at the top of the queue.
    setItems(pending.sort((a, b) => a.createdAt - b.createdAt));
    setSelected(new Set());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sorted = useMemo(() => items, [items]);

  const selectedItems = useMemo(() => sorted.filter((i) => selected.has(i.id)), [sorted, selected]);
  const canBatchApprove = useMemo(() => allSelectedBatchApprovable(selectedItems), [selectedItems]);
  const batchApprovableCount = useMemo(
    () => selectedItems.filter(isBatchApprovable).length,
    [selectedItems],
  );
  const batchReadyItems = useMemo(() => sorted.filter(isBatchApprovable), [sorted]);
  const slaSummary = useMemo(() => summarizeQueueSla(sorted), [sorted]);
  const overdueCount = slaSummary.breached;
  const allSelected = sorted.length > 0 && selected.size === sorted.length;

  function toggleSelectAll() {
    setSelected((prev) => (prev.size === sorted.length ? new Set<string>() : new Set(sorted.map((i) => i.id))));
  }

  async function importSidecars(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let added = 0;
      for (const file of [...files]) {
        const text = await file.text();
        added += await importStagingJsonText(text);
      }
      if (added > 0) {
        await appendAudit({
          action: 'staging-import',
          entityType: 'staging',
          summary: `Imported ${added} folder-watch sidecar(s) into review queue`,
        });
      }
      await refresh();
    } catch (err) {
      await confirm({
        title: 'Import failed',
        message: (err as Error).message,
        confirmLabel: 'OK',
      });
    } finally {
      setBusy(false);
      if (sidecarInput.current) sidecarInput.current.value = '';
    }
  }

  async function importStagingFolder() {
    if (!('showDirectoryPicker' in window)) {
      sidecarInput.current?.click();
      return;
    }
    setBusy(true);
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      let added = 0;
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue;
        const file = await (entry as FileSystemFileHandle).getFile();
        added += await importStagingJsonText(await file.text());
      }
      if (added > 0) {
        await appendAudit({
          action: 'staging-import',
          entityType: 'staging',
          summary: `Imported ${added} folder-watch sidecar(s) from .staging folder`,
        });
      }
      await refresh();
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      await confirm({
        title: 'Import failed',
        message: (err as Error).message,
        confirmLabel: 'OK',
      });
    } finally {
      setBusy(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startReview(item: StagingItem) {
    pendingReviewId.current = item.id;
    letterInput.current?.click();
  }

  function handleLetterFile(file: File | undefined) {
    const stagingId = pendingReviewId.current;
    pendingReviewId.current = null;
    if (!file || !stagingId) return;
    openLetterImport(file, {
      entryPoint: 'review-queue',
      stagingItemId: stagingId,
      onImportComplete: () => {
        void (async () => {
          const before = items.find((i) => i.id === stagingId);
          await updateStagingItem(stagingId, { status: 'approved' });
          await recordHrqResolution({
            action: 'hrq-sign-off',
            stagingItemId: stagingId,
            title: before?.title ?? file.name,
            beforeStatus: before?.status ?? 'pending',
            afterStatus: 'approved',
            user: userName,
            runId: before?.runId,
            detail: `filed letter import ${file.name}`,
          });
          await refresh();
        })();
      },
    });
    if (letterInput.current) letterInput.current.value = '';
  }

  async function rejectItem(item: StagingItem) {
    const ok = await confirm({
      title: 'Reject staged item?',
      message: `"${item.title}" will be removed from the pending queue.`,
      confirmLabel: 'Reject',
      destructive: true,
    });
    if (!ok) return;
    await updateStagingItem(item.id, { status: 'rejected' });
    await recordHrqResolution({
      action: 'hrq-reject',
      stagingItemId: item.id,
      title: item.title,
      beforeStatus: item.status,
      afterStatus: 'rejected',
      user: userName,
      runId: item.runId,
    });
    await refresh();
  }

  async function deferItem(item: StagingItem) {
    await updateStagingItem(item.id, { status: 'deferred' });
    await recordHrqResolution({
      action: 'hrq-defer',
      stagingItemId: item.id,
      title: item.title,
      beforeStatus: item.status,
      afterStatus: 'deferred',
      user: userName,
      runId: item.runId,
    });
    await refresh();
  }

  async function rejectSelected() {
    if (!selected.size) return;
    const ok = await confirm({
      title: `Reject ${selected.size} item(s)?`,
      message: 'Selected items will leave the pending queue.',
      confirmLabel: 'Reject all',
      destructive: true,
    });
    if (!ok) return;
    for (const id of selected) {
      const item = sorted.find((i) => i.id === id);
      await updateStagingItem(id, { status: 'rejected' });
      await recordHrqResolution({
        action: 'hrq-reject',
        stagingItemId: id,
        title: item?.title ?? id,
        beforeStatus: item?.status ?? 'pending',
        afterStatus: 'rejected',
        user: userName,
        runId: item?.runId,
      });
    }
    await refresh();
  }

  async function approveSelected() {
    if (!canBatchApprove) return;
    const names = stagingPatientNames(selectedItems);
    const ok = await confirm({
      title: `Approve ${selectedItems.length} letter(s)?`,
      message: (
        <div>
          <p className="mb-2">
            You are about to file <strong>{selectedItems.length}</strong> high-confidence letter
            {selectedItems.length === 1 ? '' : 's'} to live patient data. Confirm every patient name:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {names.map((name) => (
              <li key={name}>
                <strong>{name}</strong>
              </li>
            ))}
          </ul>
        </div>
      ),
      confirmLabel: `Approve ${selectedItems.length}`,
    });
    if (!ok) return;

    setBusy(true);
    try {
      const results = await commitBatchStagingItems(selectedItems, {
        commitParsedApproval,
        commitParsedDecline,
      });
      for (const result of results) {
        const item = selectedItems.find((i) => i.id === result.stagingId);
        await updateStagingItem(result.stagingId, { status: 'approved' });
        await recordHrqResolution({
          action: 'hrq-batch-sign-off',
          stagingItemId: result.stagingId,
          title: item?.title ?? result.stagingId,
          beforeStatus: item?.status ?? 'pending',
          afterStatus: 'approved',
          user: userName,
          runId: item?.runId,
          detail: `filed ${result.kind} → claim ${result.claimId}`,
        });
      }
      await refresh();
    } catch (err) {
      await confirm({
        title: 'Batch approve failed',
        message: (err as Error).message,
        confirmLabel: 'OK',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionTitle
        title="Human Review Queue"
        subtitle="Folder-watch and automation drafts land here first — sign off before they touch live patient data. Oldest items are shown first."
        actions={
          sorted.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={overdueCount ? 'danger' : 'good'}>{sorted.length} pending</Badge>
              {slaSummary.warn > 0 && <Badge tone="warn">{slaSummary.warn} approaching SLA</Badge>}
              {overdueCount > 0 && <Badge tone="danger">{overdueCount} overdue</Badge>}
              {batchReadyItems.length > 0 && <Badge tone="good">{batchReadyItems.length} batch ready</Badge>}
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void importStagingFolder()}
          title="Pick the ACC-Inbox\.staging folder written by Start Folder Watch.cmd"
        >
          Import ACC-Inbox .staging folder
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => sidecarInput.current?.click()}
          title="Pick individual .json sidecar files instead of the whole folder"
        >
          Import sidecar JSON files
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canBatchApprove}
          onClick={() => void approveSelected()}
          title="File all selected high-confidence letters after confirming every patient name"
        >
          Approve selected ({batchApprovableCount})
        </button>
        <button type="button" className="btn" disabled={busy || !selected.size} onClick={() => void rejectSelected()}>
          Reject selected ({selected.size})
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          Refresh
        </button>
        <input
          ref={sidecarInput}
          type="file"
          accept=".json,application/json"
          multiple
          className="hidden"
          onChange={(e) => void importSidecars(e.target.files)}
        />
        <input
          ref={letterInput}
          type="file"
          accept={LETTER_IMPORT_ACCEPT}
          className="hidden"
          onChange={(e) => handleLetterFile(e.target.files?.[0])}
        />
      </div>

      {!sorted.length ? (
        <EmptyState
          title="No pending reviews"
          message="1. Run Start Folder Watch.cmd on the work laptop.  2. Drop PDF or Word letters into ACC-Inbox.  3. Click Import ACC-Inbox .staging folder above to bring the staged letters in for sign-off."
        />
      ) : (
        <>
        <label
          className="flex items-center gap-2 mb-2 text-sm cursor-pointer select-none"
          style={{ color: 'var(--muted)' }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            aria-label="Select all pending items"
          />
          Select all ({sorted.length})
          {batchReadyItems.length > 0 && (
            <button
              type="button"
              className="underline"
              onClick={(e) => {
                e.preventDefault();
                setSelected(new Set(batchReadyItems.map((i) => i.id)));
              }}
            >
              Select batch-ready only ({batchReadyItems.length})
            </button>
          )}
        </label>
        <div className="space-y-3">
          {sorted.map((item) => {
            const sla = hrqSlaStatus(item.createdAt);
            return (
              <Card key={item.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                    aria-label={`Select ${item.title}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold">{item.title}</span>
                      <Badge tone={item.severity === 'danger' ? 'danger' : item.severity === 'warn' ? 'warn' : 'good'}>
                        {typeLabel(item.type)}
                      </Badge>
                      <Badge tone={slaTone(sla.level)}>{stagingAgeLabel(item.createdAt)}</Badge>
                      {sla.level !== 'ok' && (
                        <Badge tone={slaTone(sla.level)}>{hrqSlaLabel(sla)}</Badge>
                      )}
                      {isBatchApprovable(item) && (
                        <Badge tone="good">Batch ready</Badge>
                      )}
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        via {item.source}
                      </span>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      {item.summary}
                    </p>
                    {(item.patientName || item.claimNumber || item.accId) && (
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                        {item.patientName && (
                          <>
                            Patient: <strong>{item.patientName}</strong>
                          </>
                        )}
                        {item.patientName && item.claimNumber && ' · '}
                        {item.claimNumber && (
                          <>
                            Claim: <strong>{item.claimNumber}</strong>
                          </>
                        )}
                        {(item.patientName || item.claimNumber) && item.accId && ' · '}
                        {item.accId && <>{item.accId}</>}
                      </p>
                    )}
                    {item.sourceFileName && (
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
                        File: {item.sourceFileName}
                      </p>
                    )}
                    {item.expectedFileName && item.expectedFileName !== item.sourceFileName && (
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
                        Look for: {item.expectedFileName}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {(item.type === 'letter-import-pending' ||
                      item.type === 'letter-import-low-confidence' ||
                      item.type === 'letter-duplicate-suspect') && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => startReview(item)}
                        title="Opens a file picker — choose the letter file (usually in ACC-Inbox\processed), then confirm before saving"
                      >
                        Review & import
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => void deferItem(item)}
                      title="Set aside — removes this item from the pending queue without importing it"
                    >
                      Defer
                    </button>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void rejectItem(item)}>
                      Reject
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        </>
      )}

      {confirmDialog}
    </div>
  );
}
