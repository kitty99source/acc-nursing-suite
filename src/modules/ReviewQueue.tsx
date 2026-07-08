import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Badge, Card, EmptyState } from '../components/ui';
import { useConfirm } from '../components/useConfirm';
import {
  loadStagingItems,
  importStagingJsonText,
  updateStagingItem,
  stagingSlaLevel,
  stagingAgeLabel,
  type StagingItem,
} from '../lib/staging';
import {
  allSelectedBatchApprovable,
  commitBatchStagingItems,
  isBatchApprovable,
  stagingPatientNames,
} from '../lib/hrqBatch';
import { appendAudit } from '../lib/auditLog';

function slaTone(level: ReturnType<typeof stagingSlaLevel>): 'good' | 'warn' | 'danger' {
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
  const [items, setItems] = useState<StagingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, confirmDialog] = useConfirm();
  const sidecarInput = useRef<HTMLInputElement>(null);
  const letterInput = useRef<HTMLInputElement>(null);
  const pendingReviewId = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const pending = await loadStagingItems();
    setItems(pending.sort((a, b) => b.createdAt - a.createdAt));
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
          await updateStagingItem(stagingId, { status: 'approved' });
          await appendAudit({
            action: 'hrq-sign-off',
            entityType: 'staging',
            entityId: stagingId,
            summary: `HRQ approved letter import: ${file.name}`,
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
    await appendAudit({
      action: 'hrq-reject',
      entityType: 'staging',
      entityId: item.id,
      summary: `HRQ rejected: ${item.title}`,
    });
    await refresh();
  }

  async function deferItem(item: StagingItem) {
    await updateStagingItem(item.id, { status: 'deferred' });
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
      await updateStagingItem(id, { status: 'rejected' });
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
        await updateStagingItem(result.stagingId, { status: 'approved' });
        const item = selectedItems.find((i) => i.id === result.stagingId);
        await appendAudit({
          action: 'hrq-batch-sign-off',
          entityType: 'staging',
          entityId: result.stagingId,
          summary: `HRQ batch approved ${result.kind} for staging item: ${item?.title ?? result.stagingId}`,
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
        subtitle="Folder-watch and automation drafts land here first — sign off before they touch live patient data."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void importStagingFolder()}>
          Import ACC-Inbox .staging folder
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => sidecarInput.current?.click()}>
          Import sidecar JSON files
        </button>
        <button type="button" className="btn btn-primary" disabled={busy || !canBatchApprove} onClick={() => void approveSelected()}>
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
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => handleLetterFile(e.target.files?.[0])}
        />
      </div>

      {!sorted.length ? (
        <EmptyState
          title="No pending reviews"
          message="Run Start Folder Watch.cmd, drop PDF or Word letters in ACC-Inbox, then click Import ACC-Inbox .staging folder above."
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const sla = stagingSlaLevel(item.createdAt);
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
                      <Badge tone={slaTone(sla)}>{stagingAgeLabel(item.createdAt)}</Badge>
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
                    {item.sourceFileName && (
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
                        File: {item.sourceFileName}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    {(item.type === 'letter-import-pending' ||
                      item.type === 'letter-import-low-confidence' ||
                      item.type === 'letter-duplicate-suspect') && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => startReview(item)}>
                        Review & import
                      </button>
                    )}
                    <button type="button" className="btn btn-sm" onClick={() => void deferItem(item)}>
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
      )}

      {confirmDialog}
    </div>
  );
}
