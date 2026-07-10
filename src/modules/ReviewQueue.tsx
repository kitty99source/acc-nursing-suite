import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  Badge,
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
  reconcileStagingQueue,
  analyzeStagingQueue,
  removeByteIdenticalDuplicates,
  removeUnnamedStagingItems,
  removeUnhashedStagingItems,
  dismissStagingItems,
  stagingAgeLabel,
  type StagingItem,
} from '../lib/staging';
import { appendAudit, recordHrqResolution } from '../lib/auditLog';
import { LETTER_IMPORT_ACCEPT } from '../components/LetterImportButton';
import {
  fetchInboxFileForStaging,
  fetchEmailMetaForHash,
  probeLocalStagingBridge,
  type StagingBridgeStatus,
} from '../lib/localAccBridge';
import {
  enqueueStagingPreparse,
  buildStagingPreview,
  retryUnnamedStagingPreparse,
  stagingPreparseStats,
} from '../lib/stagingPreparse';
import {
  blobToBase64,
  getCachedLetterFile,
  getCachedLetterParse,
  getCachedLetterParseAny,
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

/** Format a full ISO email timestamp as "dd/mm/yyyy, HH:MM" (NZ). Empty -> "". */
function formatEmailDate(iso?: string): string {
  if (!iso?.trim()) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  return new Date(ms).toLocaleString('en-NZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  const [query, setQuery] = useState('');
  const [fixProgress, setFixProgress] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (!toolsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [toolsOpen]);

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

  const reconciledOnce = useRef(false);

  const sorted = useMemo(() => items, [items]);
  const readyCount = useMemo(
    () => sorted.filter((i) => Boolean(i.patientName?.trim())).length,
    [sorted],
  );
  const unnamedCount = sorted.length - readyCount;
  const unhashedCount = useMemo(
    () => sorted.filter((i) => i.status === 'pending' && !i.sourceHash?.trim()).length,
    [sorted],
  );
  const missingDateCount = useMemo(
    () => sorted.filter((i) => Boolean(i.sourceHash) && !i.emailDate?.trim()).length,
    [sorted],
  );

  useEffect(() => {
    void (async () => {
      if (!reconciledOnce.current) {
        reconciledOnce.current = true;
        try {
          const res = await reconcileStagingQueue();
          if (res.removed > 0 || res.renamed > 0) {
            setAutoImportNote(
              `Tidied the review list: ${res.renamed} renamed from the letter, ${res.removed} duplicate(s) removed.`,
            );
          }
        } catch {
          /* non-fatal — list still loads below */
        }
      }
      await refresh();
      await autoImportFromLauncher();
    })();
    const id = window.setInterval(() => {
      void autoImportFromLauncher();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [refresh, autoImportFromLauncher]);

  // Keep the list titles live while background pre-parse fills patient names.
  useEffect(() => {
    if (unnamedCount <= 0 || busy) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [unnamedCount, busy, refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((item) => {
      const haystack = [
        listTitle(item),
        item.patientName,
        item.claimNumber,
        item.sourceFileName,
        item.accId,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, query]);
  const selected = useMemo(
    () => sorted.find((i) => i.id === selectedId) ?? null,
    [sorted, selectedId],
  );
  async function discardUnnamed() {
    if (busy) return;
    setBusy(true);
    try {
      const pending = await loadStagingItems();
      const count = pending.filter((i) => !i.patientName?.trim()).length;
      if (count === 0) {
        setFlash('No filename-only rows to discard.');
        window.setTimeout(() => setFlash(null), 4000);
        return;
      }
      const ok = await confirm({
        title: `Discard ${count} filename-only letter(s)?`,
        message: (
          <div className="space-y-2 text-sm">
            <p>
              This permanently removes the <strong>{count}</strong> letter(s) that still have{' '}
              <strong>no patient name</strong> — the rows showing only a filename.
            </p>
            <p style={{ color: 'var(--danger, #b42318)' }}>
              Only do this if you have already run “Fix names now” and these are genuinely
              unreadable or junk. This cannot be undone.
            </p>
            <p style={{ color: 'var(--muted)' }}>
              Accepted patient cases are never affected — this only clears items still under review.
            </p>
          </div>
        ),
        confirmLabel: `Discard ${count} letter(s)`,
      });
      if (!ok) return;
      const removed = await removeUnnamedStagingItems();
      await appendAudit({
        action: 'staging-import',
        entityType: 'staging',
        summary: `Discarded ${removed} filename-only (unnamed) staging row(s)`,
      });
      await refresh();
      setFlash(`Discarded ${removed} filename-only letter(s).`);
      window.setTimeout(() => setFlash(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  async function discardUnhashed() {
    if (busy) return;
    setBusy(true);
    try {
      const pending = await loadStagingItems();
      const count = pending.filter((i) => i.status === 'pending' && !i.sourceHash?.trim()).length;
      if (count === 0) {
        setFlash('No unhashed rows to remove.');
        window.setTimeout(() => setFlash(null), 4000);
        return;
      }
      const ok = await confirm({
        title: `Remove ${count} unhashed letter(s)?`,
        message: (
          <div className="space-y-2 text-sm">
            <p>
              This permanently removes the <strong>{count}</strong> letter(s) with{' '}
              <strong>no content hash</strong>. Without a hash the app can't fetch or parse the
              letter bytes, so these rows can never fill in a patient name — they're almost always
              the junk/filename-only rows.
            </p>
            <p style={{ color: 'var(--danger, #b42318)' }}>This cannot be undone.</p>
            <p style={{ color: 'var(--muted)' }}>
              Accepted patient cases are never affected — this only clears items still under review.
            </p>
          </div>
        ),
        confirmLabel: `Remove ${count} letter(s)`,
      });
      if (!ok) return;
      const removed = await removeUnhashedStagingItems();
      await appendAudit({
        action: 'staging-import',
        entityType: 'staging',
        summary: `Removed ${removed} unhashed staging row(s)`,
      });
      await refresh();
      setFlash(`Removed ${removed} unhashed letter(s).`);
      window.setTimeout(() => setFlash(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  async function checkQueueHealth() {
    if (busy) return;
    setBusy(true);
    try {
      const pending = await loadStagingItems();
      const a = analyzeStagingQueue(pending);
      const canDedupe = a.byteIdenticalExtras > 0;
      const ok = await confirm({
        title: 'Review queue health',
        message: (
          <div className="space-y-2 text-sm">
            <div className="grid gap-1" style={{ gridTemplateColumns: 'auto 1fr' }}>
              <span className="font-semibold">{a.total}</span>
              <span>letters under review (pending)</span>
              <span className="font-semibold">{a.named}</span>
              <span>have a patient name</span>
              <span className="font-semibold">{a.unnamed}</span>
              <span>still show a filename only</span>
              <span className="font-semibold">{a.uniqueByHash}</span>
              <span>distinct letters by content (the “true” count)</span>
              <span className="font-semibold">{a.byteIdenticalExtras}</span>
              <span>byte-identical duplicate row(s)</span>
              <span className="font-semibold">{a.withoutHash}</span>
              <span>legacy row(s) with no content hash (cannot auto-parse)</span>
            </div>
            <p style={{ color: 'var(--muted)' }}>
              Note: many ACC letters share the generic filename{' '}
              <span className="font-mono">…approve_-_vendor.docx</span>, so rows that look the same
              are usually different patients — not duplicates.
            </p>
            {canDedupe ? (
              <p>
                Remove the <strong>{a.byteIdenticalExtras}</strong> byte-identical duplicate row(s)?
                This keeps the earliest copy of each and never touches accepted patient cases.
              </p>
            ) : (
              <p style={{ color: 'var(--muted)' }}>No byte-identical duplicates to remove.</p>
            )}
            {a.unnamed > 0 && (
              <p style={{ color: 'var(--muted)' }}>
                {a.unnamed} row(s) still show a filename only. Try “Fix names now” first; if any are
                genuinely unreadable, use the “Discard unnamed” button to clear them.
              </p>
            )}
          </div>
        ),
        confirmLabel: canDedupe ? `Remove ${a.byteIdenticalExtras} duplicate(s)` : 'Close',
      });
      if (ok && canDedupe) {
        const removed = await removeByteIdenticalDuplicates();
        await appendAudit({
          action: 'staging-import',
          entityType: 'staging',
          summary: `Removed ${removed} byte-identical duplicate staging row(s)`,
        });
        await refresh();
        setFlash(`Removed ${removed} byte-identical duplicate row(s).`);
        window.setTimeout(() => setFlash(null), 6000);
      }
    } finally {
      setBusy(false);
    }
  }

  async function fixNamesNow() {
    if (busy) return;
    setBusy(true);
    try {
      const probe = await probeLocalStagingBridge();
      setBridgeStatus(probe.status);
      if (probe.status === 'unavailable') {
        await confirm({
          title: 'Cannot reach letter files',
          message:
            'Start WFH Mode (or Start ACC Suite) so the app can read letters from ACC-Inbox. Without that bridge, old filename-only rows cannot be renamed.',
          confirmLabel: 'OK',
        });
        return;
      }
      const pending = await loadStagingItems();
      const targets = retryUnnamedStagingPreparse(pending);
      if (targets === 0) {
        setFixProgress(null);
        setFlash('All letters already have patient names.');
        window.setTimeout(() => setFlash(null), 4000);
        return;
      }
      setFixProgress(`Reading letters to fix names… 0/${targets}`);
      const started = Date.now();
      while (Date.now() - started < 10 * 60_000) {
        await new Promise((r) => setTimeout(r, 1500));
        await refresh();
        const stats = stagingPreparseStats();
        const still = (await loadStagingItems()).filter(
          (i) => i.status === 'pending' && !i.patientName?.trim(),
        ).length;
        const doneCount = Math.max(0, targets - still);
        setFixProgress(
          `Reading letters to fix names… ${doneCount}/${targets}` +
            (stats.queued + stats.active > 0 ? ` (${stats.queued + stats.active} in flight)` : ''),
        );
        if (stats.queued === 0 && stats.active === 0) break;
      }
      const after = await loadStagingItems();
      const named = after.filter((i) => i.status === 'pending' && i.patientName?.trim()).length;
      const stillUnnamed = after.filter(
        (i) => i.status === 'pending' && !i.patientName?.trim(),
      ).length;
      setFixProgress(null);
      setFlash(
        stillUnnamed > 0
          ? `Named ${named} letters. ${stillUnnamed} still need a file (bridge/hash miss or unreadable).`
          : `Named ${named} letters. Review list is ready.`,
      );
      window.setTimeout(() => setFlash(null), 8000);
    } finally {
      setBusy(false);
      setFixProgress(null);
    }
  }

  async function backfillEmailDates() {
    if (busy) return;
    setBusy(true);
    try {
      const probe = await probeLocalStagingBridge();
      setBridgeStatus(probe.status);
      if (probe.status === 'unavailable') {
        await confirm({
          title: 'Cannot reach letter files',
          message:
            'Start WFH Mode (or Start ACC Suite) so the app can read email dates from ACC-Inbox. Without that bridge, older rows cannot pick up their email date.',
          confirmLabel: 'OK',
        });
        return;
      }
      const pending = await loadStagingItems();
      const targets = pending.filter((i) => i.sourceHash && !i.emailDate?.trim());
      if (targets.length === 0) {
        setFlash('All letters already have an email date.');
        window.setTimeout(() => setFlash(null), 4000);
        return;
      }
      setFixProgress(`Looking up email dates… 0/${targets.length}`);
      let filled = 0;
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        setFixProgress(`Looking up email dates… ${i + 1}/${targets.length}`);
        const meta = await fetchEmailMetaForHash(item.sourceHash!);
        if (meta) {
          await updateStagingItem(item.id, {
            emailDate: meta.emailDate,
            emailDateApprox: meta.emailDateApprox,
          });
          filled++;
        }
      }
      await refresh();
      setFixProgress(null);
      setFlash(
        filled < targets.length
          ? `Added email dates to ${filled} of ${targets.length} letters. Run the "Backfill Email Dates" tool on the local machine to fill in the rest.`
          : `Added email dates to ${filled} letter(s).`,
      );
      window.setTimeout(() => setFlash(null), 8000);
    } finally {
      setBusy(false);
      setFixProgress(null);
    }
  }

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
        // No fetchable bytes (bridge down, nothing cached). Fall back to any
        // previously cached parse — even an older parser version — so the form
        // still shows what we had rather than regressing to a blank error.
        const stale = hash ? await getCachedLetterParseAny(hash) : undefined;
        if (gen !== loadGen.current) return;
        if (stale) {
          await applyPreview(stale, null);
          return;
        }
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

  // Load the attachment/parse only when the *selected item* changes, keyed by id.
  // Depending on the `selected` object would re-fire on every list refresh (the
  // 2.5s auto-refresh replaces item references), reloading the file and causing
  // the preview to flicker between error and fallback states.
  useEffect(() => {
    if (!selected) {
      setFile(null);
      setParsed(null);
      setFields(emptyLetterCommitForm());
      setParseMeta({ blockers: [], loading: false, error: null });
      return;
    }
    void loadSelected(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, loadSelected]);

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
    const list = visible.length ? visible : sorted;
    const idx = list.findIndex((i) => i.id === id);
    if (idx < 0) return list[0]?.id ?? null;
    return list[idx + 1]?.id ?? list[idx - 1]?.id ?? null;
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
    await dismissStagingItems([item]);
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
      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg font-bold leading-tight truncate">Review final patient form</h1>
          <p
            className="text-xs truncate"
            style={{ color: 'var(--muted)' }}
            title="Check the letter and the pre-filled form, then Accept to create the patient case. Items under review do not count toward metrics until accepted."
          >
            Check the letter &amp; pre-filled form, then Accept to create the patient case.
          </p>
        </div>
        {sorted.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Badge tone="accent">{sorted.length} under review</Badge>
            {readyCount > 0 && <Badge tone="good">{readyCount} ready</Badge>}
          </div>
        )}
      </div>

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

      {fixProgress && (
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }} role="status">
          {fixProgress}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {sorted.length > 0 && (
          <div className="relative" style={{ minWidth: 220, flex: '1 1 260px', maxWidth: 380 }}>
            <TextInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search patient, claim, or file…"
              aria-label="Search review list"
              style={{ paddingLeft: 32 }}
            />
            <span
              aria-hidden
              className="absolute"
              style={{ left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }}
            >
              ⌕
            </span>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute"
                style={{
                  right: 8,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 ml-auto">
          {unnamedCount > 0 && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              disabled={busy}
              onClick={() => void discardUnnamed()}
              title="Clear rows that still show a filename only. Try “Fix names now” first for any that are genuinely readable."
            >
              Discard unnamed ({unnamedCount})
            </button>
          )}
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void refresh()}>
            Refresh
          </button>
          <div className="relative" ref={toolsRef}>
            <button
              type="button"
              className="btn btn-sm"
              aria-haspopup="menu"
              aria-expanded={toolsOpen}
              onClick={() => setToolsOpen((v) => !v)}
            >
              More ▾
            </button>
            {toolsOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1 z-20 flex flex-col gap-1 p-1.5 rounded-card"
                style={{
                  minWidth: 220,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                }}
              >
                {unnamedCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm w-full justify-start"
                    disabled={busy}
                    onClick={() => {
                      setToolsOpen(false);
                      void fixNamesNow();
                    }}
                    title="Re-read letter files via the local bridge and fill patient names on filename-only rows"
                  >
                    Fix names now ({unnamedCount})
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm w-full justify-start"
                  disabled={busy}
                  onClick={() => {
                    setToolsOpen(false);
                    void importStagingFolder();
                  }}
                >
                  Import letters from folder
                </button>
                <button
                  type="button"
                  className="btn btn-sm w-full justify-start"
                  disabled={busy}
                  onClick={() => {
                    setToolsOpen(false);
                    sidecarInput.current?.click();
                  }}
                >
                  Import letter files
                </button>
                <button
                  type="button"
                  className="btn btn-sm w-full justify-start"
                  disabled={busy}
                  onClick={() => {
                    setToolsOpen(false);
                    void checkQueueHealth();
                  }}
                >
                  Check queue health
                </button>
                {missingDateCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-sm w-full justify-start"
                    disabled={busy}
                    onClick={() => {
                      setToolsOpen(false);
                      void backfillEmailDates();
                    }}
                  >
                    Backfill email dates ({missingDateCount})
                  </button>
                )}
                {unhashedCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm w-full justify-start"
                    disabled={busy}
                    onClick={() => {
                      setToolsOpen(false);
                      void discardUnhashed();
                    }}
                    title="Remove rows with no content hash — they can't be fetched or parsed, so they stay filename-only forever"
                  >
                    Remove unhashed ({unhashedCount})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
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
          style={{ gridTemplateColumns: 'minmax(240px, 300px) minmax(0, 1fr)' }}
        >
          {/* Left: pending list */}
          <div
            className="flex flex-col rounded-card"
            style={{
              maxHeight: 'calc(100vh - 150px)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            <div
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide flex items-center justify-between"
              style={{ color: 'var(--muted)', borderBottom: '1px solid var(--border)' }}
            >
              <span>Letters under review</span>
              <span>{query ? `${visible.length}/${sorted.length}` : sorted.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1.5">
              {visible.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--muted)' }}>
                  No letters match “{query}”.
                </p>
              ) : (
                visible.map((item) => {
                  const preview = stagingPreviewOf(item);
                  const active = item.id === selectedId;
                  const ready = Boolean(item.patientName?.trim() || preview?.patientName?.trim());
                  const claim = item.claimNumber || preview?.claimNumber;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className="w-full text-left rounded-card p-2.5 transition-colors"
                      style={{
                        border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
                        borderLeft: active
                          ? '3px solid var(--accent)'
                          : '3px solid transparent',
                        background: active ? 'var(--accent-soft)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          aria-hidden
                          title={ready ? 'Patient details ready' : 'Still reading the letter…'}
                          style={{
                            flexShrink: 0,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: ready ? 'var(--good-fg)' : 'var(--warn-fg)',
                          }}
                        />
                        <span className="font-semibold text-sm truncate flex-1">
                          {listTitle(item)}
                        </span>
                      </div>
                      <div
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs pl-4"
                        style={{ color: 'var(--muted)' }}
                      >
                        {claim && <span className="font-mono">{claim}</span>}
                        <span>{stagingAgeLabel(item.createdAt)}</span>
                        {preview && <span>· {Math.round(preview.confidence)}%</span>}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: detail pane */}
          <div
            className="flex flex-col rounded-card min-w-0"
            style={{
              maxHeight: 'calc(100vh - 150px)',
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              overflow: 'hidden',
            }}
          >
            {!selected ? (
              <div className="p-6">
                <EmptyState
                  title="Select a letter"
                  message="Choose an item on the left to review the attachment and patient form."
                />
              </div>
            ) : (
              <>
                <div
                  className="px-4 py-2 flex items-start justify-between gap-3"
                  style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold truncate">{listTitle(selected)}</h2>
                      <Badge
                        tone={
                          selected.severity === 'danger'
                            ? 'danger'
                            : selected.severity === 'warn'
                              ? 'warn'
                              : 'good'
                        }
                      >
                        {typeLabel(selected.type)}
                      </Badge>
                      {typeof parseMeta.confidence === 'number' && (
                        <Badge tone={parseMeta.confidence >= 90 ? 'good' : 'warn'}>
                          {Math.round(parseMeta.confidence)}%
                        </Badge>
                      )}
                    </div>
                    <p
                      className="text-xs mt-0.5 truncate"
                      style={{ color: 'var(--muted)' }}
                    >
                      {formatEmailDate(selected.emailDate) && (
                        <>
                          Email {formatEmailDate(selected.emailDate)}
                          {selected.emailDateApprox && ' (approx.)'}
                        </>
                      )}
                      {formatEmailDate(selected.emailDate) && selected.sourceFileName && ' · '}
                      {selected.sourceFileName && (
                        <span className="font-mono">{selected.sourceFileName}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={!canAccept}
                      onClick={() => void acceptItem()}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void deferItem(selected)}
                    >
                      Defer
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                      onClick={() => void rejectItem(selected)}
                    >
                      Reject
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
                  {matchedPatient ? (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
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
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      Will create a <strong>new patient</strong> and claim when you Accept.
                    </p>
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
                    <div className="min-w-0" style={{ order: 2 }}>
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
                            minHeight: 300,
                            height: 'min(380px, 42vh)',
                            color: 'var(--muted)',
                            border: '1px dashed var(--border)',
                          }}
                        >
                          Loading letter...
                        </div>
                      ) : (
                        <PdfPreview
                          file={file}
                          title={selected.sourceFileName || selected.title}
                          text={parsed?.rawText}
                          height={380}
                        />
                      )}
                    </div>

                    <div className="space-y-3 min-w-0" style={{ order: 1 }}>
                      <div>
                        <h3 className="text-sm font-semibold mb-2">Patient</h3>
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                          <Field label="Patient name" required>
                            <TextInput
                              value={fields.patientName}
                              onChange={(e) => patchField('patientName', e.target.value)}
                            />
                          </Field>
                          <Field label="NHI">
                            <TextInput
                              value={fields.nhi}
                              onChange={(e) => patchField('nhi', e.target.value)}
                            />
                          </Field>
                          <Field label="Date of birth">
                            <DateInput
                              value={fields.dob}
                              onChange={(e) => patchField('dob', e.target.value)}
                            />
                          </Field>
                          <Field label="Letter date">
                            <DateInput
                              value={fields.letterDate}
                              onChange={(e) => patchField('letterDate', e.target.value)}
                            />
                          </Field>
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold mb-2">Claim</h3>
                        <div className="grid gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
                          <Field label="Claim number" required={parsed?.kind === 'approval'}>
                            <TextInput
                              value={fields.claimNumber}
                              onChange={(e) => patchField('claimNumber', e.target.value)}
                            />
                          </Field>
                          <Field label="ACC45">
                            <TextInput
                              value={fields.acc45}
                              onChange={(e) => patchField('acc45', e.target.value)}
                            />
                          </Field>
                          <Field label="PO number">
                            <TextInput
                              value={fields.poNumber}
                              onChange={(e) => patchField('poNumber', e.target.value)}
                            />
                          </Field>
                          <Field label="Day 1 / date of injury">
                            <DateInput
                              value={fields.day1}
                              onChange={(e) => patchField('day1', e.target.value)}
                            />
                          </Field>
                        </div>
                        <div className="mt-3">
                          <Field label="Injury description">
                            <TextArea
                              rows={2}
                              value={fields.injury}
                              onChange={(e) => patchField('injury', e.target.value)}
                            />
                          </Field>
                        </div>
                      </div>

                      {parsed?.kind === 'decline' && (
                        <div>
                          <h3 className="text-sm font-semibold mb-2">Decline</h3>
                          <div className="space-y-3">
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
                                onChange={(e) =>
                                  patchField('servicePeriodDeclined', e.target.value)
                                }
                              />
                            </Field>
                          </div>
                        </div>
                      )}

                      {parsed?.kind === 'approval' && fields.rows.length > 0 && (
                        <div>
                          <h3 className="text-sm font-semibold mb-2">Service rows</h3>
                          <div className="space-y-2 overflow-x-auto">
                            {fields.rows.map((row, i) => (
                              <div
                                key={`${row.serviceCode}-${i}`}
                                className="grid gap-2 items-end p-2 rounded-card"
                                style={{
                                  gridTemplateColumns:
                                    '64px minmax(0, 1fr) minmax(0, 1fr) 56px auto auto',
                                  minWidth: 440,
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
                                    onChange={(e) =>
                                      updateRow(i, { approvalStartDate: e.target.value })
                                    }
                                  />
                                </Field>
                                <Field label="End">
                                  <DateInput
                                    value={row.approvalEndDate}
                                    onChange={(e) =>
                                      updateRow(i, { approvalEndDate: e.target.value })
                                    }
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
                </div>

                <div
                  className="px-4 py-1.5 text-xs"
                  style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--muted)' }}
                >
                  Accept creates the patient case; items under review don’t count toward metrics
                  until accepted.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}
