import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { LetterImportCommitResult } from '../state/store';
import { Modal } from './Modal';
import { Field, TextInput, DateInput, NumberInput, Badge, Select } from './ui';
import { PREFILL_FROM_LETTER_LABEL } from './LetterImportButton';
import { useConfirm } from './useConfirm';
import type {
  ParsedServiceRow,
  LetterParseResult,
  LetterImportProgress,
  LetterIssue,
  LetterFormField,
  FieldConfidence,
} from '../lib/letterImport';
import { prefillFromParsed } from '../lib/letterImport';

function issueForField(issues: LetterIssue[], field: LetterFormField): LetterIssue | undefined {
  return issues.find((i) => i.field === field);
}

/** Inline field error — skip when the issues strip already shows fix buttons. */
function fieldInlineError(issues: LetterIssue[], field: LetterFormField): string | undefined {
  const issue = issueForField(issues, field);
  if (!issue || issue.alternatives?.length) return undefined;
  return issue.message;
}

function isBlockingIssue(issue: LetterIssue): boolean {
  return issue.blocking !== false;
}

const FIELD_LABELS: Record<LetterFormField, string> = {
  patientName: 'Patient name',
  nhi: 'NHI',
  dob: 'Date of birth',
  claimNumber: 'Claim number',
  acc45: 'ACC45',
  poNumber: 'PO number',
  injury: 'Injury description',
  day1: 'Day 1 / date of injury',
  declineReason: 'Decline reason',
  linkPatient: 'Link to patient',
  linkClaim: 'Link to claim',
  serviceRows: 'Service periods',
};

const ENTRY_POINT_HINTS: Record<string, string> = {
  approvals:
    'Opened from Approvals — parses approval letters (NUR02), files NS04/NS05 periods, and stores the PDF.',
  declines:
    'Opened from Declines — parses decline letters (NUR04VEN), creates a decline record, and stores the PDF.',
  patients:
    'Opened from Patients — full import: creates or updates patient, claim, approvals or declines, and attaches the PDF.',
  'claim-documents':
    'Opened from Claim Documents — approval or decline letter (auto-detected), filed for this claim; PDF stays on the claim.',
};

function LetterIssueFix({
  issue,
  onPick,
}: {
  issue: LetterIssue;
  onPick: (value: string) => void;
}) {
  if (!issue.alternatives?.length) {
    return (
      <p className="text-xs mt-1" style={{ color: issue.blocking === false ? 'var(--warn-fg)' : 'var(--salmon-fg)' }}>
        {issue.message}
      </p>
    );
  }
  return (
    <div className="mt-1">
      <p className="text-xs mb-1" style={{ color: issue.blocking === false ? 'var(--warn-fg)' : 'var(--salmon-fg)' }}>
        {issue.message}
      </p>
      <div className="flex flex-wrap gap-1">
        {issue.alternatives.map((alt) => (
          <button key={alt} type="button" className="btn btn-sm py-0.5 px-2" onClick={() => onPick(alt)}>
            Use {alt}
          </button>
        ))}
      </div>
    </div>
  );
}

function LetterIssuesStrip({
  issues,
  formValues,
  onPick,
}: {
  issues: LetterIssue[];
  formValues: LetterFormValues;
  onPick: (field: LetterFormField, value: string) => void;
}) {
  const openIssues = issues.filter((i) => !isIssueResolved(i, formValues));
  if (!openIssues.length) return null;

  return (
    <div
      className="mb-3 rounded-lg p-3 space-y-2"
      style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
    >
      {openIssues.map((issue) => (
        <div key={issue.id} className="min-h-[2.25rem]">
          <p className="text-xs font-medium mb-0.5" style={{ color: 'var(--muted)' }}>
            {FIELD_LABELS[issue.field]}
          </p>
          <LetterIssueFix issue={issue} onPick={(value) => onPick(issue.field, value)} />
        </div>
      ))}
    </div>
  );
}

function applyIssuePick(
  field: LetterFormField,
  value: string,
  setters: {
    setPatientName: (v: string) => void;
    setNhi: (v: string) => void;
    setDob: (v: string) => void;
    setClaimNumber: (v: string) => void;
    setAcc45: (v: string) => void;
    setPoNumber: (v: string) => void;
    setInjury: (v: string) => void;
    setDay1: (v: string) => void;
    setDeclineReason: (v: string) => void;
    setSelectedPatientId: (v: string) => void;
    setSelectedClaimId: (v: string) => void;
  },
) {
  switch (field) {
    case 'patientName':
      setters.setPatientName(value);
      break;
    case 'nhi':
      setters.setNhi(value);
      break;
    case 'dob':
      setters.setDob(value);
      break;
    case 'claimNumber':
      setters.setClaimNumber(value);
      break;
    case 'acc45':
      setters.setAcc45(value);
      break;
    case 'poNumber':
      setters.setPoNumber(value);
      break;
    case 'injury':
      setters.setInjury(value);
      break;
    case 'day1':
      setters.setDay1(value);
      break;
    case 'declineReason':
      setters.setDeclineReason(value);
      break;
    case 'linkPatient':
      setters.setSelectedPatientId(value);
      break;
    case 'linkClaim':
      setters.setSelectedClaimId(value);
      break;
    default:
      break;
  }
}

type LetterFormValues = {
  patientName: string;
  nhi: string;
  dob: string;
  claimNumber: string;
  acc45: string;
  poNumber: string;
  injury: string;
  day1: string;
  declineReason: string;
  servicePeriodDeclined: string;
  letterDate: string;
  selectedPatientId: string;
  selectedClaimId: string;
  rows: ParsedServiceRow[];
};

function fieldValueForIssue(field: LetterFormField, values: LetterFormValues): string {
  switch (field) {
    case 'patientName':
      return values.patientName;
    case 'nhi':
      return values.nhi;
    case 'dob':
      return values.dob;
    case 'claimNumber':
      return values.claimNumber;
    case 'acc45':
      return values.acc45;
    case 'poNumber':
      return values.poNumber;
    case 'injury':
      return values.injury;
    case 'day1':
      return values.day1;
    case 'declineReason':
      return values.declineReason;
    case 'linkPatient':
      return values.selectedPatientId;
    case 'linkClaim':
      return values.selectedClaimId;
    case 'serviceRows':
      return String(values.rows.length);
    default:
      return '';
  }
}

function isIssueResolved(issue: LetterIssue, values: LetterFormValues): boolean {
  if (issue.blocking === false) return true;
  const v = fieldValueForIssue(issue.field, values);
  if (issue.alternatives?.length) {
    return issue.alternatives.includes(v);
  }
  if (issue.field === 'linkPatient' || issue.field === 'linkClaim') {
    return !!v;
  }
  if (issue.field === 'serviceRows') {
    return Number(v) > 0;
  }
  return !!v.trim();
}

function PatientCombobox({
  patients,
  value,
  onChange,
  error,
}: {
  patients: { id: string; name: string; nhi: string }[];
  value: string;
  onChange: (id: string) => void;
  error?: string;
}) {
  const [query, setQuery] = useState('');
  const selected = patients.find((p) => p.id === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return patients.slice(0, 50);
    return patients.filter((p) => `${p.name} ${p.nhi}`.toLowerCase().includes(q)).slice(0, 50);
  }, [patients, query]);

  return (
    <div>
      <TextInput
        placeholder="Search patients…"
        value={query || (selected ? `${selected.name} (${selected.nhi || 'no NHI'})` : '')}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!e.target.value) onChange('');
        }}
        onFocus={() => setQuery(selected ? '' : query)}
      />
      {query && (
        <div
          className="mt-1 max-h-32 overflow-y-auto rounded-lg border text-sm"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <button type="button" className="w-full text-left px-2 py-1.5 hover:opacity-80" onClick={() => { onChange(''); setQuery(''); }}>
            New / from letter
          </button>
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover:opacity-80"
              style={{ background: p.id === value ? 'var(--surface-2)' : undefined }}
              onClick={() => { onChange(p.id); setQuery(''); }}
            >
              {p.name} ({p.nhi || 'no NHI'})
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--salmon-fg)' }}>{error}</p>
      )}
    </div>
  );
}

function ExtractionDetails({ confidences }: { confidences: FieldConfidence[] }) {
  const [open, setOpen] = useState(false);
  if (!confidences.length) return null;
  return (
    <div className="mb-3">
      <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} extraction details
      </button>
      {open && (
        <div className="mt-2 rounded-lg p-2 text-xs space-y-1 max-h-36 overflow-y-auto" style={{ background: 'var(--surface-2)' }}>
          {confidences.map((f) => (
            <div key={f.field} className="flex justify-between gap-2">
              <span className="font-medium">{f.field}</span>
              <span style={{ color: 'var(--muted)' }}>
                {f.confidence}% — {f.value || '—'}{f.note ? ` (${f.note})` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LetterImportLoading({
  fileName,
  progress,
}: {
  fileName: string;
  progress: LetterImportProgress | null;
}) {
  const pct = progress?.progress ?? 0;
  const message = progress?.message ?? 'Starting…';
  const preview = progress?.extractPreview?.trim();
  const ocrActive = progress?.usedOcr || progress?.stage === 'ocr-init' || progress?.stage === 'ocr-page';

  return (
    <div className="space-y-4">
      {ocrActive && (
        <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
          <strong>Scanned PDF detected.</strong> OCR may take a minute on first run while the engine loads offline.
        </div>
      )}
      <div>
        <p className="text-sm font-medium truncate" title={fileName}>{fileName}</p>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{message}</p>
        {progress?.totalPages != null && progress.page != null && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            Page {progress.page} of {progress.totalPages}
            {progress.usedOcr ? ' · OCR' : ''}
          </p>
        )}
      </div>
      <div>
        <div className="flex items-center justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
          <span>Progress</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-2)' }}>
          <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.max(pct, 4)}%`, background: 'var(--accent)' }} />
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--muted)' }}>Extracted text preview</p>
        <div className="rounded-lg p-3 text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-words font-mono" style={{ background: 'var(--surface-2)', color: preview ? 'var(--fg)' : 'var(--muted)', border: '1px solid var(--border)' }}>
          {preview || 'Text will appear here as each page is read…'}
        </div>
      </div>
    </div>
  );
}

function ImportSuccessPanel({
  result,
  onOpenClaim,
  onViewApprovals,
  onClose,
}: {
  result: LetterImportCommitResult;
  onOpenClaim: () => void;
  onViewApprovals: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg p-4" style={{ background: 'var(--surface-2)', border: '1px solid var(--good-fg)' }}>
        <p className="font-semibold" style={{ color: 'var(--good-fg)' }}>
          {result.kind === 'document-only' ? 'Document attached' : result.kind === 'decline' ? 'Decline letter saved' : 'Approval letter saved'}
        </p>
        {result.billingHint && (
          <p className="text-sm mt-2" style={{ color: result.billingHint.startsWith('Safe') ? 'var(--good-fg)' : 'var(--warn-fg)' }}>
            {result.billingHint}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button className="btn" onClick={onClose}>Close</button>
        {result.claimId && (
          <button className="btn btn-primary" onClick={onOpenClaim}>Open claim</button>
        )}
        {result.kind === 'approval' && (
          <button className="btn" onClick={onViewApprovals}>View approvals</button>
        )}
      </div>
    </div>
  );
}

export function LetterImportModal() {
  const letterImport = useStore((s) => s.letterImport);
  const closeLetterImport = useStore((s) => s.closeLetterImport);
  const parseLetterFile = useStore((s) => s.parseLetterFile);
  const commitParsedApproval = useStore((s) => s.commitParsedApproval);
  const commitParsedDecline = useStore((s) => s.commitParsedDecline);
  const attachDocumentOnly = useStore((s) => s.attachDocumentOnly);
  const findDuplicateLetterImport = useStore((s) => s.findDuplicateLetterImport);
  const setFocus = useStore((s) => s.setFocus);
  const data = useStore((s) => s.data);
  const [confirm, confirmDialog] = useConfirm();

  const [result, setResult] = useState<LetterParseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<LetterImportProgress | null>(null);
  const [commitResult, setCommitResult] = useState<LetterImportCommitResult | null>(null);
  const [packageOffer, setPackageOffer] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [patientName, setPatientName] = useState('');
  const [nhi, setNhi] = useState('');
  const [dob, setDob] = useState('');
  const [claimNumber, setClaimNumber] = useState('');
  const [acc45, setAcc45] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [injury, setInjury] = useState('');
  const [day1, setDay1] = useState('');
  const [declineReason, setDeclineReason] = useState('');
  const [servicePeriodDeclined, setServicePeriodDeclined] = useState('');
  const [letterDate, setLetterDate] = useState('');
  const [rows, setRows] = useState<ParsedServiceRow[]>([]);
  const [selectedClaimId, setSelectedClaimId] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');

  useEffect(() => {
    if (!letterImport) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    setResult(null);
    setCommitResult(null);
    setPackageOffer(null);
    setLoadProgress({ stage: 'open', message: 'Opening PDF…', progress: 2, extractPreview: '' });
    void parseLetterFile(letterImport.file, letterImport.context, (p) => {
      if (!cancelled) setLoadProgress(p);
    })
      .then(async (r) => {
        if (cancelled) return;
        setResult(r);
        if (r.parsed) {
          const pre = prefillFromParsed(r.parsed);
          const matchedPatient = r.match.patient;
          setPatientName(matchedPatient?.name ?? pre.patient.name ?? '');
          setNhi(pre.patient.nhi ?? '');
          setDob(pre.patient.dob ?? '');
          setClaimNumber(pre.claim.claimNumber ?? '');
          setAcc45(pre.claim.acc45Number ?? '');
          setPoNumber(pre.claim.poNumber ?? '');
          setInjury(pre.claim.injuryDescription ?? '');
          setDay1(pre.claim.day1Date ?? '');
          setLetterDate(r.parsed.letterDate ?? '');
          if (r.parsed.kind === 'decline') {
            setDeclineReason(r.parsed.reason ?? '');
            setServicePeriodDeclined(r.parsed.serviceRequested ?? 'Extended Nursing');
          }
          if (r.parsed.kind === 'approval') {
            setRows(r.parsed.serviceRows.map((x) => ({ ...x })));
            if (r.parsed.packageRows.length > 0) {
              setPackageOffer(r.parsed.packageRows.map((p) => p.serviceCode).join(', '));
            }
          }
        }
        setSelectedClaimId(r.match.claimId ?? letterImport.context?.claimId ?? '');
        setSelectedPatientId(r.match.patientId ?? letterImport.context?.patientId ?? '');

        if (letterImport.prefillOnly && r.parsed && letterImport.onPrefill) {
          letterImport.onPrefill(prefillFromParsed(r.parsed));
          closeLetterImport();
          setBusy(false);
          return;
        }

        if (r.autoCommit && r.parsed?.kind === 'approval' && !letterImport.prefillOnly) {
          try {
            const pre = prefillFromParsed(r.parsed);
            const commitRes = await commitParsedApproval(r.parsed, letterImport.file, {
              patientId: r.match.patientId,
              claimId: r.match.claimId,
              patientPatch: r.match.patient ? { name: r.match.patient.name, nhi: r.match.patient.nhi, dob: r.match.patient.dob } : pre.patient,
              claimPatch: pre.claim,
              rows: r.parsed.serviceRows,
            });
            setCommitResult(commitRes);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Auto-commit failed');
          }
        } else if (r.autoCommit && r.parsed?.kind === 'decline' && !letterImport.prefillOnly) {
          try {
            const commitRes = await commitParsedDecline(r.parsed, letterImport.file, {
              patientName: r.match.patient?.name ?? r.parsed.patient.name,
              claimNumber: r.parsed.claim.claimNumber,
              reason: r.parsed.reason,
              patientId: r.match.patientId,
              claimId: r.match.claimId,
            });
            setCommitResult(commitRes);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Auto-commit failed');
          }
        }
        setBusy(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to read PDF');
        setLoadProgress({ stage: 'done', message: 'Could not read PDF', progress: 100, extractPreview: e instanceof Error ? e.message : String(e) });
        setBusy(false);
      });
    return () => { cancelled = true; };
  }, [letterImport, parseLetterFile, commitParsedApproval, commitParsedDecline, closeLetterImport]);

  if (!letterImport) return null;

  function handleCloseRequest() {
    if (result?.parsed && !commitResult) {
      void confirm({
        title: 'Discard import?',
        message: 'You have unsaved letter data. Close without saving?',
        confirmLabel: 'Discard',
        destructive: true,
      }).then((ok) => { if (ok) closeLetterImport(); });
      return;
    }
    closeLetterImport();
  }

  if (commitResult) {
    return (
      <Modal open title="Import complete" onClose={closeLetterImport} size="lg">
        <ImportSuccessPanel
          result={commitResult}
          onClose={closeLetterImport}
          onOpenClaim={() => {
            setFocus({ module: 'patients', patientId: commitResult.patientId, claimId: commitResult.claimId });
            closeLetterImport();
          }}
          onViewApprovals={() => {
            setFocus({ module: 'approvals', patientId: commitResult.patientId, claimId: commitResult.claimId });
            closeLetterImport();
          }}
        />
      </Modal>
    );
  }

  if (busy && !result) {
    return (
      <Modal open title="Reading ACC letter…" onClose={handleCloseRequest} size="lg">
        <LetterImportLoading fileName={letterImport.file.name} progress={loadProgress} />
        {error && <p className="text-sm mt-3" style={{ color: 'var(--danger-fg)' }}>{error}</p>}
      </Modal>
    );
  }

  const parsed = result?.parsed;
  const parseFailed = result && !parsed && !busy;
  const showConfirm =
    parsed &&
    !(result?.autoCommit && !letterImport.prefillOnly && (parsed.kind === 'approval' || parsed.kind === 'decline'));

  async function attachOnly() {
    if (!letterImport) return;
    setBusy(true);
    setError(null);
    try {
      const letterKind =
        parsed?.kind ?? (result?.kind !== 'unknown' ? result?.kind : undefined);
      const res = await attachDocumentOnly(letterImport.file, {
        claimId: selectedClaimId || letterImport.context?.claimId,
        patientId: selectedPatientId || letterImport.context?.patientId,
        letterKind: letterKind === 'approval' || letterKind === 'decline' ? letterKind : undefined,
      });
      setCommitResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Attach failed');
    } finally {
      setBusy(false);
    }
  }

  function setCurrentRow(index: number) {
    setRows((prev) => prev.map((r, i) => ({ ...r, recordStatus: i === index ? 'current' : 'historical' })));
  }

  function toggleRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveAll() {
    if (!parsed || !letterImport) return;
    const targetClaimId = selectedClaimId || letterImport.context?.claimId || '';
    if (targetClaimId) {
      const isDuplicate = await findDuplicateLetterImport(targetClaimId, letterImport.file, {
        parsedKind: parsed.kind,
        letterDate: parsed.letterDate ?? letterDate,
      });
      if (isDuplicate) {
        const ok = await confirm({
          title: 'Duplicate file?',
          message: `This exact PDF is already on claim ${claimNumber || targetClaimId}. Import anyway?`,
          confirmLabel: 'Import anyway',
        });
        if (!ok) return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      if (parsed.kind === 'approval') {
        const commitRes = await commitParsedApproval(parsed, letterImport.file, {
          patientId: selectedPatientId || undefined,
          claimId: selectedClaimId || undefined,
          patientPatch: { name: patientName, nhi, dob },
          claimPatch: { claimNumber, acc45Number: acc45, poNumber, injuryDescription: injury, day1Date: day1 },
          rows,
        });
        setCommitResult(commitRes);
      } else {
        const commitRes = await commitParsedDecline(parsed, letterImport.file, {
          patientName,
          claimNumber,
          reason: declineReason,
          servicePeriodDeclined,
          declineReceivedDate: letterDate,
          patientId: selectedPatientId || undefined,
          claimId: selectedClaimId || undefined,
        });
        setCommitResult(commitRes);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  function applyToFormOnly() {
    if (!parsed) return;
    letterImport?.onPrefill?.(prefillFromParsed(parsed));
    closeLetterImport();
  }

  function openFullImportFromPrefill() {
    if (!letterImport) return;
    closeLetterImport();
    useStore.getState().openLetterImport(letterImport.file, {
      context: letterImport.context,
      prefillOnly: false,
    });
  }

  if (parseFailed || (error && !parsed && !busy)) {
    return (
      <Modal
        open
        title="Could not read letter"
        onClose={handleCloseRequest}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={closeLetterImport}>Cancel</button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}>Try another file</button>
            <button className="btn btn-primary" onClick={() => void attachOnly()} disabled={busy}>
              Attach as document only
            </button>
          </>
        }
      >
        <p className="text-sm mb-3" style={{ color: 'var(--danger-fg)' }}>
          {error || result?.blockers.join(' · ') || 'Unrecognised letter format — this PDF does not look like an ACC NUR02 approval or NUR04VEN decline.'}
        </p>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          You can attach the PDF to a claim without extracting approvals, or pick a different file.
        </p>
        <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            closeLetterImport();
            useStore.getState().openLetterImport(file, { context: letterImport.context });
          }
          e.target.value = '';
        }} />
        {confirmDialog}
      </Modal>
    );
  }

  if (!showConfirm) {
    if (error) {
      return (
        <Modal open title="Import error" onClose={handleCloseRequest} size="lg">
          <p className="text-sm" style={{ color: 'var(--danger-fg)' }}>{error}</p>
          <button className="btn mt-3" onClick={closeLetterImport}>Close</button>
        </Modal>
      );
    }
    return null;
  }

  const formValues: LetterFormValues = {
    patientName, nhi, dob, claimNumber, acc45, poNumber, injury, day1,
    declineReason, servicePeriodDeclined, letterDate, selectedPatientId, selectedClaimId, rows,
  };
  const allIssues = result?.issues ?? [];
  const openIssues = allIssues.filter((i) => !isIssueResolved(i, formValues));
  const blockingIssues = openIssues.filter(isBlockingIssue);
  const warningIssues = openIssues.filter((i) => !isBlockingIssue(i));
  const matchedPatient = result?.match.patient;

  return (
    <Modal
      open
      title={parsed.kind === 'approval' ? 'Confirm approval letter' : 'Confirm decline letter'}
      onClose={handleCloseRequest}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={handleCloseRequest} disabled={busy}>Cancel</button>
          {letterImport.onPrefill && (
            <>
              <button className="btn" onClick={applyToFormOnly} disabled={busy}>{PREFILL_FROM_LETTER_LABEL}</button>
              {letterImport.context?.patientId && (
                <button className="btn" onClick={openFullImportFromPrefill} disabled={busy}>Import &amp; save now</button>
              )}
            </>
          )}
          <button className="btn" onClick={() => void attachOnly()} disabled={busy}>Attach PDF only</button>
          <button className="btn btn-primary" onClick={() => void saveAll()} disabled={busy || blockingIssues.length > 0}>
            Save everything
          </button>
        </>
      }
    >
      {error && <p className="text-sm mb-3" style={{ color: 'var(--danger-fg)' }}>{error}</p>}

      {letterImport.entryPoint && ENTRY_POINT_HINTS[letterImport.entryPoint] && (
        <p className="text-xs mb-3 rounded-lg px-3 py-2" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
          {ENTRY_POINT_HINTS[letterImport.entryPoint]}
        </p>
      )}

      {letterImport.onPrefill && (
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
          <strong>{PREFILL_FROM_LETTER_LABEL}</strong> fills the open form only — nothing is saved until you click Save on that form.
          Use <strong>Import &amp; save now</strong> or <strong>Save everything</strong> to file approvals and attach the PDF.
        </p>
      )}

      {matchedPatient && (
        <div className="rounded-lg p-3 mb-3 text-sm" style={{ background: 'var(--surface-2)', border: '1px solid var(--good-fg)' }}>
          Matched <strong>{matchedPatient.name}</strong> (NHI {matchedPatient.nhi || '—'})
          {result?.match.claim && <> · Claim {result.match.claim.claimNumber}</>}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge tone={result!.overallConfidence >= 100 ? 'good' : result!.overallConfidence >= 70 ? 'warn' : 'salmon'}>
          {result!.overallConfidence}% confidence
        </Badge>
        {result!.usedOcr && <Badge tone="neutral">OCR used</Badge>}
        {blockingIssues.length > 0 && (
          <Badge tone="salmon">{blockingIssues.length} item{blockingIssues.length === 1 ? '' : 's'} to fix</Badge>
        )}
        {blockingIssues.length === 0 && warningIssues.length > 0 && (
          <Badge tone="warn">{warningIssues.length} review recommended</Badge>
        )}
        {openIssues.length === 0 && <Badge tone="good">Ready to save</Badge>}
      </div>

      <ExtractionDetails confidences={result!.fieldConfidences} />

      {blockingIssues.length > 0 && (
        <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          Fix {blockingIssues.length} blocking item{blockingIssues.length === 1 ? '' : 's'} below, then click Save everything.
        </p>
      )}

      <LetterIssuesStrip
        issues={allIssues}
        formValues={formValues}
        onPick={(field, value) =>
          applyIssuePick(field, value, {
            setPatientName,
            setNhi,
            setDob,
            setClaimNumber,
            setAcc45,
            setPoNumber,
            setInjury,
            setDay1,
            setDeclineReason,
            setSelectedPatientId,
            setSelectedClaimId,
          })
        }
      />

      <div className="grid sm:grid-cols-2 gap-3 letter-import-form items-start">
        <Field label="Patient name" error={fieldInlineError(blockingIssues, 'patientName')}>
          <TextInput value={patientName} onChange={(e) => setPatientName(e.target.value)} />
        </Field>
        <Field label="NHI" error={fieldInlineError(blockingIssues, 'nhi')}>
          <TextInput value={nhi} onChange={(e) => setNhi(e.target.value)} />
        </Field>
        <Field label="Date of birth">
          <DateInput value={dob} onChange={(e) => setDob(e.target.value)} />
        </Field>
        <Field label="Claim number" error={fieldInlineError(blockingIssues, 'claimNumber')}>
          <TextInput value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} />
        </Field>
        <Field label="ACC45">
          <TextInput value={acc45} onChange={(e) => setAcc45(e.target.value)} />
        </Field>
        <Field label="PO number" error={fieldInlineError(blockingIssues, 'poNumber')}>
          <TextInput value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
        </Field>
        <Field label="Link to existing patient" error={fieldInlineError(blockingIssues, 'linkPatient')}>
          {data.patients.length > 15 ? (
            <PatientCombobox
              patients={data.patients}
              value={selectedPatientId}
              onChange={setSelectedPatientId}
            />
          ) : (
            <Select value={selectedPatientId} onChange={(e) => setSelectedPatientId(e.target.value)}>
              <option value="">New / from letter</option>
              {data.patients.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.nhi || 'no NHI'})</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Link to existing claim" error={fieldInlineError(blockingIssues, 'linkClaim')}>
          <Select value={selectedClaimId} onChange={(e) => setSelectedClaimId(e.target.value)}>
            <option value="">New / from letter</option>
            {data.claims.filter((c) => !selectedPatientId || c.patientId === selectedPatientId).map((c) => (
              <option key={c.id} value={c.id}>{c.claimNumber}</option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Injury description">
            <TextInput value={injury} onChange={(e) => setInjury(e.target.value)} />
          </Field>
        </div>
        <Field label="Day 1 / date of injury">
          <DateInput value={day1} onChange={(e) => setDay1(e.target.value)} />
        </Field>
      </div>

      {parsed.kind === 'decline' && (
        <div className="mt-3 grid sm:grid-cols-2 gap-3 items-start">
          <Field label="Letter date">
            <DateInput value={letterDate} onChange={(e) => setLetterDate(e.target.value)} />
          </Field>
          <Field label="Service requested">
            <TextInput value={servicePeriodDeclined} onChange={(e) => setServicePeriodDeclined(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Decline reason" error={fieldInlineError(blockingIssues, 'declineReason')}>
              <TextInput value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} />
            </Field>
          </div>
        </div>
      )}

      {parsed.kind === 'approval' && (
        <div className="mt-4">
          <h4 className="text-sm font-semibold mb-2">NS04 / NS05 periods to file</h4>
          {packageOffer && (
            <p className="text-xs mb-2 rounded-lg p-2" style={{ background: 'var(--surface-2)', color: 'var(--muted)' }}>
              Package row(s) on letter ({packageOffer}) are informational — not filed as approvals.
              After import, add an NS03 service line manually if needed.
            </p>
          )}
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {rows.map((row, i) => (
              <div key={`${row.serviceCode}-${row.approvalStartDate}-${i}`} className="flex items-center gap-2 rounded-lg p-2 text-sm flex-wrap" style={{ background: 'var(--surface-2)' }}>
                <label className="flex items-center gap-1 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="currentRow"
                    checked={row.recordStatus === 'current'}
                    onChange={() => setCurrentRow(i)}
                  />
                  Current for billing
                </label>
                <Badge tone={row.recordStatus === 'current' ? 'good' : 'neutral'}>
                  {row.recordStatus === 'current' ? 'Current' : 'Historical'}
                </Badge>
                <span className="font-medium">{row.serviceCode}</span>
                <span>{row.approvalStartDate} → {row.approvalEndDate}</span>
                <NumberInput
                  className="w-20 py-0.5 text-xs"
                  min={0}
                  value={row.approvedHoursOrConsults}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, approvedHoursOrConsults: v } : r)));
                  }}
                />
                <button type="button" className="btn btn-sm btn-sm-danger ml-auto" onClick={() => toggleRow(i)}>Remove</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {confirmDialog}
    </Modal>
  );
}
