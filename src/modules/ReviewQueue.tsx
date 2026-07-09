import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  SectionTitle,
  Badge,
  Card,
  EmptyState,
  Field,
  TextInput,
  DateInput,
  TextArea,
} from '../components/ui';
import { PdfPreview } from '../components/PdfPreview';
import { useConfirm } from '../components/useConfirm';
import {
  loadStagingItems,
  importStagingJsonText,
  importStagingSidecars,
  updateStagingItem,
  stagingAgeLabel,
  type StagingItem,
} from '../lib/staging';
import { hrqSlaStatus, hrqSlaLabel, summarizeQueueSla, type SlaLevel } from '../lib/hrqSla';
import { appendAudit, recordHrqResolution } from '../lib/auditLog';
import { LETTER_IMPORT_ACCEPT } from '../components/LetterImportButton';
import {
  fetchInboxFileForStaging,
  probeLocalStagingBridge,
  type StagingBridgeStatus,
} from '../lib/localAccBridge';
import { enqueueStagingPreparse, buildStagingPreview } from '../lib/stagingPreparse';
import {
  blobToBase64,
  getCachedLetterFile,
  getCachedLetterParse,
  putCachedLetterBlob,
  putCachedLetterParse,
} from '../lib/letterCache';
import {
  commitLetterForm,
  emptyLetterCommitForm,
  fileFromStagingPreview,
  formFieldsFromParsed,
  formFieldsFromPreview,
  stagingPreviewOf,
  type LetterCommitFormFields,
} from '../lib/letterCommit';
import type { LetterParseResult, ParsedLetter, ParsedServiceRow } from '../lib/letterImport';
import { hashBlob } from '../lib/letterImport';
import type { ApprovalServiceCode } from '../types';

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

function listTitle(item: StagingItem): string {
  const preview = stagingPreviewOf(item);
  return (
    preview?.patientName?.trim() ||
    item.patientName?.trim() ||
    item.title
  );
}

export function ReviewQueue() {
  const commitParsedApproval = useStore((s) => s.commitParsedApproval);
  const commitParsedDecline = useStore((s) => s.commitParsedDecline);
  const parseLetterFile = useStore((s) => s.parseLetterFile);
  const data = useStore((s) => s.data);
  const setFocus = useStore((s) => s.setFocus);
  const userName = useStore((s) => s.data.settings.userDisplayName?.trim() || undefined);

  const [items, setItems] = useState<StagingItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [autoImportNote, setAutoImportNote] = useState<string | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<StagingBridgeStatus | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<LetterCommitFormFields>(emptyLetterCommitForm());
  const [parsed, setParsed] = useState<ParsedLetter | null>(null);
  const [parseMeta, setParseMeta] = useState<{
    confidence?: number;
    blockers: string[];
    loading: boolean;
    error: string | null;
  }>({ blockers: [], loading: false, error: null });

  const [confirm, confirmDialog] = useConfirm();
  const sidecarInput = useRef<HTMLInputElement>(null);
  const letterInput = useRef<HTMLInputElement>(null);
  const seenSidecarIds = useRef<Set<string>>(new Set());
  const loadGen = useRef(0);

  const refresh = useCallback(async () => {
    const pending = await loadStagingItems();
    const sorted = pending.sort((a, b) => a.createdAt - b.createdAt);
    setItems(sorted);
    enqueueStagingPreparse(pending);
    setSelectedId((prev) => {
      if (prev && sorted.some((i) => i.id === prev)) return prev;
      return sorted[0]?.id ?? null;
    });
  }, []);

  const autoImportFromLauncher = useCallback(async () => {
    const probe = await probeLocalStagingBridge();
    setBridgeStatus(probe.status);
    if (!probe.sidecars.length) return;
    const fresh = probe.sidecars.filter((sc) => {
      if (seenSidecarIds.current.has(sc.item.id)) return false;
      seenSidecarIds.current.add(sc.item.id);
      return true;
    });
    if (!fresh.length) return;
    const added = await importStagingSidecars(fresh);
    if (added > 0) {
      await appendAudit({
        action: 'staging-import',
        entityType: 'staging',
        summary: `Auto-imported ${added} folder-watch sidecar(s) via /_acc/staging`,
      });
      setAutoImportNote(`Auto-imported ${added} letter(s) from ACC-Inbox\\.staging.`);
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    void refresh();
    void autoImportFromLauncher();
    const id = window.setInterval(() => {
      void autoImportFromLauncher();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refresh, autoImportFromLauncher]);

  const sorted = useMemo(() => items, [items]);
  const selected = useMemo(
    () => sorted.find((i) => i.id === selectedId) ?? null,
    [sorted, selectedId],
  );
  const slaSummary = useMemo(() => summarizeQueueSla(sorted), [sorted]);
  const overdueCount = slaSummary.breached;

  const matchedPatient = useMemo(() => {
    if (!fields.selectedPatientId) return undefined;
    return data.patients.find((p) => p.id === fields.selectedPatientId);
  }, [data.patients, fields.selectedPatientId]);

  const matchedClaim = useMemo(() => {
    if (!fields.selectedClaimId) return undefined;
    return data.claims.find((c) => c.id === fields.selectedClaimId);
  }, [data.claims, fields.selectedClaimId]);

  const loadSelected = useCallback(
    async (item: StagingItem) => {
      const gen = ++loadGen.current;
      setFile(null);
      setParsed(null);
      setFields(emptyLetterCommitForm());
      setParseMeta({ blockers: [], loading: true, error: null });

      const legacyPreview = stagingPreviewOf(item);
      const hash = item.sourceHash?.trim().toLowerCase();
      const preferredName = (item.expectedFileName || item.sourceFileName || 'letter.bin').trim();

      const applyPreview = async (
        preview: NonNullable<ReturnType<typeof stagingPreviewOf>>,
        resolved: File | null,
      ) => {
        if (gen !== loadGen.current) return;
        setFields(formFieldsFromPreview(preview));
        setParsed(preview.parsed);
        setFile(resolved);
        setParseMeta({
          confidence: preview.confidence,
          blockers: [],
          loading: false,
          error: resolved ? null : 'Attachment not found - pick the letter file to continue.',
        });
      };

      if (legacyPreview) {
        let resolved = fileFromStagingPreview(item) ?? null;
        if (!resolved && hash) {
          resolved =
            (await getCachedLetterFile(hash, preferredName, legacyPreview.mimeType)) ?? null;
        }
        if (!resolved) {
          resolved =
            (await fetchInboxFileForStaging({
              sourceHash: item.sourceHash,
              sourceFileName: item.sourceFileName,
              expectedFileName: item.expectedFileName,
            })) ?? null;
          if (resolved && hash) await putCachedLetterBlob(hash, resolved);
        }
        await applyPreview(legacyPreview, resolved);
        return;
      }

      if (hash) {
        const cached = await getCachedLetterParse(hash);
        if (cached) {
          const resolved =
            (await getCachedLetterFile(hash, preferredName, cached.mimeType)) ?? null;
          await applyPreview(cached, resolved);
          return;
        }
      }

      let resolved =
        hash
          ? (await getCachedLetterFile(hash, preferredName)) ??
            (await fetchInboxFileForStaging({
              sourceHash: item.sourceHash,
              sourceFileName: item.sourceFileName,
              expectedFileName: item.expectedFileName,
            })) ??
            null
          : null;

      if (gen !== loadGen.current) return;
      if (resolved && hash) await putCachedLetterBlob(hash, resolved);

      if (!resolved) {
        setFields({
          ...emptyLetterCommitForm(),
          patientName: item.patientName ?? '',
          claimNumber: item.claimNumber ?? '',
        });
        setParseMeta({
          blockers: [],
          loading: false,
          error: 'Attachment not found - pick the letter file to parse and review.',
        });
        return;
      }

      setFile(resolved);
      try {
        const result: LetterParseResult = await parseLetterFile(resolved);
        if (gen !== loadGen.current) return;
        if (!result.parsed) {
          setFields({
            ...emptyLetterCommitForm(),
            patientName: item.patientName ?? '',
            claimNumber: item.claimNumber ?? '',
          });
          setParseMeta({
            confidence: result.overallConfidence,
            blockers: result.blockers,
            loading: false,
            error: 'Could not parse this letter - fill the form manually, then Accept.',
          });
          return;
        }
        setParsed(result.parsed);
        setFields(
          formFieldsFromParsed(result.parsed, {
            patientId: result.match.patientId,
            claimId: result.match.claimId,
            patientName: result.match.patient?.name,
          }),
        );
        const blockers = result.issues
          .filter((i) => i.blocking !== false)
          .map((i) => i.message);
        setParseMeta({
          confidence: result.overallConfidence,
          blockers: blockers.length ? blockers : result.blockers,
          loading: false,
          error: null,
        });
        if (hash) {
          const base64 = await blobToBase64(resolved);
          const preview = buildStagingPreview(result, resolved, base64);
          if (preview) {
            await putCachedLetterParse(hash, preview);
            const hints: Partial<StagingItem> = {};
            if (preview.patientName?.trim()) hints.patientName = preview.patientName.trim();
            if (preview.claimNumber?.trim()) hints.claimNumber = preview.claimNumber.trim();
            if (Object.keys(hints).length) await updateStagingItem(item.id, hints);
          }
        }
      } catch (err) {
        if (gen !== loadGen.current) return;
        setParseMeta({
          blockers: [],
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to read letter',
        });
      }
    },
    [parseLetterFile],
  );

  useEffect(() => {
    if (!selected) {
      setFile(null);
      setParsed(null);
      setFields(emptyLetterCommitForm());
      setParseMeta({ blockers: [], loading: false, error: null });
      return;
    }
    void loadSelected(selected);
  }, [selected, loadSelected]);

  async function importSidecars(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      let added = 0;
      for (const f of [...files]) {
        const text = await f.text();
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
        const f = await (entry as FileSystemFileHandle).getFile();
        added += await importStagingJsonText(await f.text());
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

  function patchField<K extends keyof LetterCommitFormFields>(key: K, value: LetterCommitFormFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function updateRow(index: number, patch: Partial<ParsedServiceRow>) {
    setFields((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  }

  function removeRow(index: number) {
    setFields((prev) => ({
      ...prev,
      rows: prev.rows.filter((_, i) => i !== index),
    }));
  }

  function setCurrentRow(index: number) {
    setFields((prev) => ({
      ...prev,
      rows: prev.rows.map((r, i) => ({
        ...r,
        recordStatus: i === index ? 'current' : 'historical',
      })),
    }));
  }

  async function handlePickedLetter(picked: File | undefined) {
    if (!picked || !selected) return;
    setFile(picked);
    setParseMeta({ blockers: [], loading: true, error: null });
    try {
      const fileHash = await hashBlob(picked);
      await putCachedLetterBlob(fileHash, picked);
      if (!selected.sourceHash) {
        await updateStagingItem(selected.id, { sourceHash: fileHash });
      }
      const result = await parseLetterFile(picked);
      if (!result.parsed) {
        setParseMeta({
          confidence: result.overallConfidence,
          blockers: result.blockers,
          loading: false,
          error: 'Could not parse this letter - fill the form manually, then Accept.',
        });
        return;
      }
      setParsed(result.parsed);
      setFields(
        formFieldsFromParsed(result.parsed, {
          patientId: result.match.patientId,
          claimId: result.match.claimId,
          patientName: result.match.patient?.name,
        }),
      );
      const blockers = result.issues
        .filter((i) => i.blocking !== false)
        .map((i) => i.message);
      setParseMeta({
        confidence: result.overallConfidence,
        blockers: blockers.length ? blockers : result.blockers,
        loading: false,
        error: null,
      });
      const base64 = await blobToBase64(picked);
      const preview = buildStagingPreview(result, picked, base64);
      if (preview) {
        await putCachedLetterParse(fileHash, preview);
        const hints: Partial<StagingItem> = {};
        if (preview.patientName?.trim()) hints.patientName = preview.patientName.trim();
        if (preview.claimNumber?.trim()) hints.claimNumber = preview.claimNumber.trim();
        if (Object.keys(hints).length) await updateStagingItem(selected.id, hints);
        await refresh();
      }
    } catch (err) {
      setParseMeta({
        blockers: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to read letter',
      });
    } finally {
      if (letterInput.current) letterInput.current.value = '';
    }
  }

  function nextAfter(id: string): string | null {
    const idx = sorted.findIndex((i) => i.id === id);
    if (idx < 0) return sorted[0]?.id ?? null;
    return sorted[idx + 1]?.id ?? sorted[idx - 1]?.id ?? null;
  }

  async function acceptItem() {
    if (!selected || !parsed || !file) {
      await confirm({
        title: 'Cannot accept yet',
        message: !file
          ? 'Load or pick the letter attachment first.'
          : 'Letter has not been parsed into a patient form yet.',
        confirmLabel: 'OK',
      });
      return;
    }
    if (!fields.patientName.trim()) {
      await confirm({
        title: 'Patient name required',
        message: 'Enter the patient name before accepting this case.',
        confirmLabel: 'OK',
      });
      return;
    }

    const ok = await confirm({
      title: 'Accept → create patient case?',
      message: (
        <div className="space-y-2 text-sm">
          <p>
            This will create (or update) the live patient and claim for{' '}
            <strong>{fields.patientName.trim()}</strong>
            {fields.claimNumber.trim() ? (
              <>
                {' '}
                / claim <strong>{fields.claimNumber.trim()}</strong>
              </>
            ) : null}
            , attach the letter, and remove this item from the review queue. It will then appear in
            Patients &amp; Cases and count toward metrics.
          </p>
        </div>
      ),
      confirmLabel: 'Accept → create patient case',
    });
    if (!ok) return;

    setBusy(true);
    try {
      const result = await commitLetterForm(parsed, file, fields, {
        commitParsedApproval,
        commitParsedDecline,
      });
      await updateStagingItem(selected.id, { status: 'approved' });
      await recordHrqResolution({
        action: 'hrq-sign-off',
        stagingItemId: selected.id,
        title: selected.title,
        beforeStatus: selected.status,
        afterStatus: 'approved',
        user: userName,
        runId: selected.runId,
        detail: `filed ${result.kind} → claim ${result.claimId}`,
      });
      const name = fields.patientName.trim();
      const advanceTo = nextAfter(selected.id);
      setFlash(`Patient case created for ${name}.`);
      window.setTimeout(() => setFlash(null), 5000);
      await refresh();
      setSelectedId(advanceTo);
      const openPatient = await confirm({
        title: 'Patient case created',
        message: (
          <p className="text-sm">
            <strong>{name}</strong> is now in Patients &amp; Cases and counts toward metrics.
          </p>
        ),
        confirmLabel: 'Open in Patients & Cases',
      });
      if (openPatient) {
        setFocus({
          module: 'patients',
          patientId: result.patientId,
          claimId: result.claimId,
        });
      }
    } catch (err) {
      await confirm({
        title: 'Accept failed',
        message: (err as Error).message,
        confirmLabel: 'OK',
      });
    } finally {
      setBusy(false);
    }
  }

  async function rejectItem(item: StagingItem) {
    const ok = await confirm({
      title: 'Reject staged item?',
      message: `"${item.title}" will be removed from the pending queue without creating a patient case.`,
      confirmLabel: 'Reject',
      destructive: true,
    });
    if (!ok) return;
    const advanceTo = nextAfter(item.id);
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
    setSelectedId(advanceTo);
  }

  async function deferItem(item: StagingItem) {
    const advanceTo = nextAfter(item.id);
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
    setSelectedId(advanceTo);
  }

  const canAccept =
    !!selected &&
    !!parsed &&
    !!file &&
    !!fields.patientName.trim() &&
    !parseMeta.loading &&
    !busy;

  return (
    <div>
      <SectionTitle
        title="Review final patient form"
        subtitle="Under review = not yet a live patient case and not in metrics. Select a letter, check the attachment and the pre-filled form, then Accept to create the patient case."
        actions={
          sorted.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone={overdueCount ? 'danger' : 'good'}>{sorted.length} under review</Badge>
              {slaSummary.warn > 0 && <Badge tone="warn">{slaSummary.warn} approaching SLA</Badge>}
              {overdueCount > 0 && <Badge tone="danger">{overdueCount} overdue</Badge>}
            </div>
          ) : undefined
        }
      />

      {bridgeStatus === 'unavailable' && (
        <div
          className="card mb-4 p-3 text-sm"
          style={{ borderColor: 'var(--warn-fg)', background: 'var(--surface-2)' }}
          role="status"
        >
          <strong>Local staging bridge is down.</strong> This page cannot auto-import folder-watch
          letters because <span className="font-mono">/_acc/staging</span> is missing (typical when
          the suite is opened via <span className="font-mono">npm run dev</span>, file://, or a host
          without <span className="font-mono">launch.ps1</span>). Use{' '}
          <strong>Start ACC Suite.cmd</strong> so the launcher serves the app, or use the Import
          buttons below to pick <span className="font-mono">ACC-Inbox\.staging</span> manually.
        </div>
      )}

      {bridgeStatus === 'empty' && !sorted.length && (
        <div className="card mb-4 p-3 text-sm" style={{ background: 'var(--surface-2)' }} role="status">
          Launcher bridge is up, but <span className="font-mono">ACC-Inbox\.staging</span> has no
          sidecar JSON yet. Run <span className="font-mono">Start Folder Watch.cmd</span> (or WFH
          Mode) so new letters get staged. Files already moved to{' '}
          <span className="font-mono">processed/</span> are not queue rows — only{' '}
          <span className="font-mono">.staging\*.json</span> sidecars are.
        </div>
      )}

      {autoImportNote && (
        <p className="text-sm mb-3" style={{ color: 'var(--good-fg, var(--muted))' }}>
          {autoImportNote}
        </p>
      )}

      {flash && (
        <p className="text-sm mb-3 font-medium" style={{ color: 'var(--good-fg)' }} role="status">
          {flash}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void importStagingFolder()}
          title="Pick your ACC-Inbox folder if letters are not loading automatically"
        >
          Import letters from folder
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => sidecarInput.current?.click()}
          title="Pick individual letter files from your inbox staging folder"
        >
          Import letter files
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => void refresh()}>
          Refresh review list
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
          onChange={(e) => void handlePickedLetter(e.target.files?.[0])}
        />
      </div>

      {!sorted.length ? (
        <EmptyState
          title="No letters under review"
          message={
            bridgeStatus === 'unavailable'
              ? 'Auto-import needs launch.ps1 (/_acc/staging). Until then: Import ACC-Inbox .staging folder. processed/ PDFs alone never appear here.'
              : '1. Run Start WFH Mode.cmd (or Start Folder Watch.cmd). 2. Sidecars land in ACC-Inbox\\.staging and auto-import here when launch.ps1 is serving. 3. If the queue stays empty, use Import ACC-Inbox .staging folder.'
          }
        />
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)' }}
        >
          {/* Left: pending list */}
          <div
            className="space-y-2 pr-1"
            style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}
          >
            {sorted.map((item) => {
              const sla = hrqSlaStatus(item.createdAt);
              const preview = stagingPreviewOf(item);
              const active = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className="w-full text-left rounded-card p-3 transition-colors"
                  style={{
                    border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                    background: active ? 'var(--accent-soft)' : 'var(--surface)',
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="font-semibold text-sm truncate">{listTitle(item)}</span>
                    <Badge tone={item.severity === 'danger' ? 'danger' : item.severity === 'warn' ? 'warn' : 'good'}>
                      {typeLabel(item.type)}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                    <Badge tone={slaTone(sla.level)}>{stagingAgeLabel(item.createdAt)}</Badge>
                    {sla.level !== 'ok' && <Badge tone={slaTone(sla.level)}>{hrqSlaLabel(sla)}</Badge>}
                    {preview && <Badge tone="good">{Math.round(preview.confidence)}%</Badge>}
                    {(item.claimNumber || preview?.claimNumber) && (
                      <span className="font-mono">
                        {item.claimNumber || preview?.claimNumber}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Right: detail pane */}
          <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
            <Card className="p-4">
            {!selected ? (
              <EmptyState title="Select a letter" message="Choose an item on the left to review the attachment and patient form." />
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold">{listTitle(selected)}</h2>
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>
                      {selected.summary}
                    </p>
                    {selected.sourceFileName && (
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--muted)' }}>
                        {selected.sourceFileName}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {typeof parseMeta.confidence === 'number' && (
                      <Badge tone={parseMeta.confidence >= 90 ? 'good' : 'warn'}>
                        {Math.round(parseMeta.confidence)}% confidence
                      </Badge>
                    )}
                    <Badge tone="neutral">via {selected.source}</Badge>
                  </div>
                </div>

                {matchedPatient ? (
                  <div
                    className="text-sm p-2 rounded-card"
                    style={{ background: 'var(--accent-soft)', color: 'var(--text)' }}
                  >
                    Links to existing patient <strong>{matchedPatient.name}</strong>
                    {matchedClaim ? (
                      <>
                        {' '}
                        / claim <strong>{matchedClaim.claimNumber || matchedClaim.id}</strong>
                      </>
                    ) : (
                      ' — will create a new claim if needed'
                    )}
                    .
                  </div>
                ) : (
                  <div
                    className="text-sm p-2 rounded-card"
                    style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}
                  >
                    Will create a <strong>new patient</strong> and claim when you Accept.
                  </div>
                )}

                {parseMeta.blockers.length > 0 && (
                  <div
                    className="text-sm p-3 rounded-card"
                    style={{ border: '1px solid var(--warn-fg)', background: 'var(--surface-2)' }}
                  >
                    <strong>Check before accepting:</strong>
                    <ul className="list-disc pl-5 mt-1">
                      {parseMeta.blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {parseMeta.error && (
                  <div className="text-sm" style={{ color: 'var(--danger-fg)' }}>
                    {parseMeta.error}{' '}
                    <button
                      type="button"
                      className="btn btn-sm ml-2"
                      onClick={() => letterInput.current?.click()}
                    >
                      Pick letter file
                    </button>
                  </div>
                )}

                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    alignItems: 'start',
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center justify-between mb-2 gap-2">
                      <h3 className="text-sm font-semibold">Attachment</h3>
                      <button
                        type="button"
                        className="btn btn-sm shrink-0"
                        onClick={() => letterInput.current?.click()}
                      >
                        {file ? 'Replace file' : 'Pick letter file'}
                      </button>
                    </div>
                    {parseMeta.loading ? (
                      <div
                        className="flex items-center justify-center text-sm rounded-card"
                        style={{
                          minHeight: 360,
                          height: 'min(480px, 50vh)',
                          color: 'var(--muted)',
                          border: '1px dashed var(--border)',
                        }}
                      >
                        Loading letter...
                      </div>
                    ) : (
                      <PdfPreview file={file} title={selected.sourceFileName || selected.title} />
                    )}
                  </div>

                  <div className="space-y-3 min-w-0" style={{ maxHeight: 'min(70vh, 640px)', overflowY: 'auto' }}>
                    <h3 className="text-sm font-semibold">Patient &amp; case form</h3>
                    <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                      <Field label="Patient name" required>
                        <TextInput
                          value={fields.patientName}
                          onChange={(e) => patchField('patientName', e.target.value)}
                        />
                      </Field>
                      <Field label="NHI">
                        <TextInput value={fields.nhi} onChange={(e) => patchField('nhi', e.target.value)} />
                      </Field>
                      <Field label="Date of birth">
                        <DateInput value={fields.dob} onChange={(e) => patchField('dob', e.target.value)} />
                      </Field>
                      <Field label="Claim number" required={parsed?.kind === 'approval'}>
                        <TextInput
                          value={fields.claimNumber}
                          onChange={(e) => patchField('claimNumber', e.target.value)}
                        />
                      </Field>
                      <Field label="ACC45">
                        <TextInput value={fields.acc45} onChange={(e) => patchField('acc45', e.target.value)} />
                      </Field>
                      <Field label="PO number">
                        <TextInput
                          value={fields.poNumber}
                          onChange={(e) => patchField('poNumber', e.target.value)}
                        />
                      </Field>
                      <Field label="Day 1 / date of injury">
                        <DateInput value={fields.day1} onChange={(e) => patchField('day1', e.target.value)} />
                      </Field>
                      <Field label="Letter date">
                        <DateInput
                          value={fields.letterDate}
                          onChange={(e) => patchField('letterDate', e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Injury description">
                      <TextArea
                        rows={2}
                        value={fields.injury}
                        onChange={(e) => patchField('injury', e.target.value)}
                      />
                    </Field>

                    {parsed?.kind === 'decline' && (
                      <>
                        <Field label="Decline reason">
                          <TextArea
                            rows={2}
                            value={fields.declineReason}
                            onChange={(e) => patchField('declineReason', e.target.value)}
                          />
                        </Field>
                        <Field label="Service period declined">
                          <TextInput
                            value={fields.servicePeriodDeclined}
                            onChange={(e) => patchField('servicePeriodDeclined', e.target.value)}
                          />
                        </Field>
                      </>
                    )}

                    {parsed?.kind === 'approval' && fields.rows.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold mb-2" style={{ color: 'var(--muted)' }}>
                          Service rows
                        </h4>
                        <div className="space-y-2">
                          {fields.rows.map((row, i) => (
                            <div
                              key={`${row.serviceCode}-${i}`}
                              className="grid gap-2 items-end p-2 rounded-card"
                              style={{
                                gridTemplateColumns: '80px 1fr 1fr 70px auto auto',
                                background: 'var(--surface-2)',
                              }}
                            >
                              <Field label="Code">
                                <TextInput
                                  value={row.serviceCode}
                                  onChange={(e) =>
                                    updateRow(i, {
                                      serviceCode: e.target.value as ApprovalServiceCode,
                                    })
                                  }
                                />
                              </Field>
                              <Field label="Start">
                                <DateInput
                                  value={row.approvalStartDate}
                                  onChange={(e) => updateRow(i, { approvalStartDate: e.target.value })}
                                />
                              </Field>
                              <Field label="End">
                                <DateInput
                                  value={row.approvalEndDate}
                                  onChange={(e) => updateRow(i, { approvalEndDate: e.target.value })}
                                />
                              </Field>
                              <Field label="Qty">
                                <TextInput
                                  type="number"
                                  value={String(row.approvedHoursOrConsults)}
                                  onChange={(e) =>
                                    updateRow(i, {
                                      approvedHoursOrConsults: Number(e.target.value) || 0,
                                    })
                                  }
                                />
                              </Field>
                              <button
                                type="button"
                                className="btn btn-sm"
                                onClick={() => setCurrentRow(i)}
                                title="Mark as current billing period"
                              >
                                {row.recordStatus === 'current' ? 'Current' : 'Make current'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-danger"
                                onClick={() => removeRow(i)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="flex flex-wrap gap-2 pt-3"
                  style={{ borderTop: '1px solid var(--border)' }}
                >
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!canAccept}
                    onClick={() => void acceptItem()}
                  >
                    Accept → create patient case
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void deferItem(selected)}
                  >
                    Defer
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={busy}
                    onClick={() => void rejectItem(selected)}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </Card>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
