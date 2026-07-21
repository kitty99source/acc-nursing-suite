import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { inferDocumentKindForPdf } from '../lib/letterImport';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { HelperTip } from '../components/HelperTip';
import {
  SectionTitle,
  Card,
  Badge,
  Field,
  DateInput,
  NumberInput,
  Select,
  TextInput,
  TextArea,
  EmptyState,
} from '../components/ui';
import { IconPlus, IconEdit, IconTrash, IconPatients, IconSearch, IconChevron } from '../components/icons';
import { PackageCalculatorPanel } from './CalculatorModule';
import { determinePackage, effectivePackageValue } from '../lib/calculator';
import { computeApproval } from '../lib/analytics';
import { isBillingApproval } from '../lib/approvals';
import { claimBillingState, type ComplianceFinding, type BillingState } from '../lib/compliance';
import { getComplianceFindings, filterFindingsForPatient } from '../lib/complianceCache';
import { formatCurrency, serviceCodeLabel, visibleServiceCodes } from '../lib/serviceCodes';
import { formatDate, todayISO } from '../lib/format';
import { validateNhi } from '../lib/validation';
import { findMatchingPatient, findDuplicatePatientGroups } from '../lib/patients';
import { appendAudit } from '../lib/auditLog';
import { downloadBlob } from '../lib/storage';
import {
  buildAdminIDriveRelativePath,
  buildStagingRelativePath,
  needsInitialAdminIDriveStaging,
} from '../lib/idriveFiling';
import { postFileToIDrive } from '../lib/localAccBridge';
import { bridgeIDriveWriteFailedMessage } from '../lib/bridgeReconnect';
import {
  LetterImportButton,
  LETTER_IMPORT_FULL_TOOLTIP,
  PREFILL_FROM_LETTER_LABEL,
  PREFILL_BUTTON_HINT,
} from '../components/LetterImportButton';
import type {
  ApprovalServiceCode,
  CaseStage,
  Claim,
  ClaimType,
  ClaimDocument,
  DocumentKind,
  MemoPurpose,
  Patient,
  ServiceLine,
  ServiceCode,
} from '../types';
import {
  CASE_STAGE_LABEL,
  MEMO_PURPOSE_LABEL,
  defaultMemoTarget,
  isOpenCase,
} from '../lib/caseWorkflow';
import { CaseStepTracker } from '../components/CaseStepTracker';

const MEMO_EMPTY: { text: string; to: string; purpose: MemoPurpose } = {
  text: '',
  to: '',
  purpose: 'extended_ns04',
};

type CaseFilter = 'all' | 'awaiting-nurse' | 'awaiting-acc' | 'open' | 'decided';

const CASE_FILTER_LABEL: Record<CaseFilter, string> = {
  all: 'All',
  'awaiting-nurse': 'Awaiting nurse',
  'awaiting-acc': 'Waiting for ACC',
  open: 'Open cases',
  decided: 'Closed / decided',
};

const PATIENTS_PAGE_SIZE = 25;

export function Patients() {
  const data = useStore((s) => s.data);
  const addPatient = useStore((s) => s.addPatient);
  const updatePatient = useStore((s) => s.updatePatient);
  const removePatient = useStore((s) => s.removePatient);
  const mergePatients = useStore((s) => s.mergePatients);
  const [confirm, confirmDialog] = useConfirm();

  const [search, setSearch] = useState('');
  const [caseFilter, setCaseFilter] = useState<CaseFilter>('all');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(data.patients[0]?.id ?? null);

  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);

  // Fast lookup: patient -> list of claim case stages, so filter chips can
  // walk the patient list once without re-iterating claims per patient.
  const patientCaseIndex = useMemo(() => {
    const byPatient = new Map<string, CaseStage[]>();
    for (const c of data.claims) {
      const list = byPatient.get(c.patientId) ?? [];
      list.push(c.caseStage ?? 'not_started');
      byPatient.set(c.patientId, list);
    }
    return byPatient;
  }, [data.claims]);

  // A "patients" fix intent selects the relevant patient. If it also carries a
  // deep intent (a specific service line), the matching ClaimCard consumes and
  // clears it; otherwise we clear it here once the patient is shown.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let base = data.patients;
    if (q) {
      base = base.filter((p) => `${p.name} ${p.nhi}`.toLowerCase().includes(q));
    }
    if (caseFilter === 'all') return base;
    return base.filter((p) => {
      const stages = patientCaseIndex.get(p.id) ?? [];
      if (caseFilter === 'awaiting-nurse')
        return stages.some((s) => s === 'awaiting_nurse_docs' || s === 'docs_returned');
      if (caseFilter === 'awaiting-acc') return stages.some((s) => s === 'awaiting_acc');
      if (caseFilter === 'open')
        return stages.some(
          (s) =>
            s !== 'not_started' && s !== 'approved' && s !== 'declined' && s !== 'closed',
        );
      if (caseFilter === 'decided')
        return stages.some((s) => s === 'approved' || s === 'declined' || s === 'closed');
      return true;
    });
  }, [data.patients, search, caseFilter, patientCaseIndex]);

  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PATIENTS_PAGE_SIZE));
  const pageStart = totalFiltered === 0 ? 0 : (page - 1) * PATIENTS_PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PATIENTS_PAGE_SIZE, totalFiltered);

  const pagePatients = useMemo(() => {
    const start = (page - 1) * PATIENTS_PAGE_SIZE;
    return filtered.slice(start, start + PATIENTS_PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => {
    setPage(1);
  }, [search, caseFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!focus || focus.module !== 'patients') return;
    const claim = focus.claimId ? data.claims.find((c) => c.id === focus.claimId) : undefined;
    const pid = focus.patientId || claim?.patientId;
    if (pid) {
      setSelectedId(pid);
      const idx = filtered.findIndex((p) => p.id === pid);
      if (idx >= 0) setPage(Math.floor(idx / PATIENTS_PAGE_SIZE) + 1);
    }
    if (!focus.prefill || !('serviceLineId' in focus.prefill)) clearFocus();
  }, [focus, data.claims, filtered, clearFocus]);

  // patient modal
  const [patientModal, setPatientModal] = useState<{ mode: 'create' | 'edit'; patient?: Patient } | null>(null);
  const [patientForm, setPatientForm] = useState<Omit<Patient, 'id'>>({ name: '', nhi: '', dob: '', notes: '' });
  const nhiCheck = useMemo(() => validateNhi(patientForm.nhi), [patientForm.nhi]);

  const selected = data.patients.find((p) => p.id === selectedId) ?? filtered[0] ?? null;

  function openCreatePatient() {
    setPatientForm({ name: '', nhi: '', dob: '', notes: '' });
    setPatientModal({ mode: 'create' });
  }
  function openEditPatient(p: Patient) {
    setPatientForm({ name: p.name, nhi: p.nhi, dob: p.dob, notes: p.notes });
    setPatientModal({ mode: 'edit', patient: p });
  }
  async function savePatient() {
    const payload = { ...patientForm, nhi: nhiCheck.normalized };
    if (patientModal?.mode === 'create') {
      const match = findMatchingPatient(data.patients, payload);
      if (match) {
        const byNhi = match.kind === 'nhi';
        const ok = await confirm({
          title: byNhi ? 'Patient already exists' : 'Possible duplicate patient',
          message: byNhi ? (
            <p>
              A patient with NHI <strong>{match.patient.nhi}</strong> already exists (
              {match.patient.name}). Opening the existing record instead of creating a duplicate.
            </p>
          ) : (
            <p>
              <strong>{match.patient.name}</strong> (DOB {formatDate(match.patient.dob) || '—'})
              looks like the same person. Open the existing record instead of creating a duplicate?
            </p>
          ),
          confirmLabel: 'Open existing',
          cancelLabel: byNhi ? 'Cancel' : 'Create anyway',
        });
        if (ok) {
          setSelectedId(match.patient.id);
          setPatientModal(null);
          return;
        }
        if (byNhi) return; // hard block on NHI match
      }
      const id = addPatient(payload);
      setSelectedId(id);
      const idx = useStore.getState().data.patients.findIndex((p) => p.id === id);
      if (idx >= 0) setPage(Math.floor(idx / PATIENTS_PAGE_SIZE) + 1);
    } else if (patientModal?.patient) {
      const match = findMatchingPatient(data.patients, payload, {
        excludeId: patientModal.patient.id,
      });
      if (match?.kind === 'nhi') {
        const ok = await confirm({
          title: 'NHI already used',
          message: (
            <p>
              NHI <strong>{match.patient.nhi}</strong> belongs to {match.patient.name}. Saving this
              would create a duplicate identity — open the Check for duplicate patients tool to merge
              instead. Save anyway?
            </p>
          ),
          confirmLabel: 'Save anyway',
          destructive: true,
        });
        if (!ok) return;
      }
      updatePatient(patientModal.patient.id, payload);
    }
    setPatientModal(null);
  }
  async function deletePatient(p: Patient) {
    const ok = await confirm({
      title: 'Delete patient?',
      message: `Delete ${p.name} and all their claims, service lines and approvals? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete patient',
    });
    if (ok) {
      removePatient(p.id);
      if (selectedId === p.id) setSelectedId(null);
    }
  }

  async function checkDuplicatePatients() {
    const groups = findDuplicatePatientGroups(data.patients, data);
    const redundantCount = groups.reduce((sum, g) => sum + g.redundant.length, 0);
    const ok = await confirm({
      title: 'Check for duplicate patients',
      message:
        groups.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No duplicates found. Every patient has a unique NHI (or unique name + date of birth when
            NHI is blank).
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              Found <strong>{redundantCount}</strong> duplicate patient record(s) across{' '}
              <strong>{groups.length}</strong> group(s). Matching is by NHI first, then name + DOB.
              Merging keeps the suggested survivor (most linked claims/approvals), reattaches claims,
              approvals, documents, memos and declines, then removes the duplicate row. This cannot be
              undone from here — confirm carefully.
            </p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {groups.map((g) => (
                <div key={g.key} className="rounded-card p-2" style={{ background: 'var(--surface-2)' }}>
                  <div className="font-medium">
                    Keep {g.keep.name}
                    {g.keep.nhi ? ` · ${g.keep.nhi}` : ''}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    Merge {g.redundant.map((p) => p.name + (p.nhi ? ` (${p.nhi})` : '')).join(', ')}{' '}
                    into the survivor ({g.kind === 'nhi' ? 'same NHI' : 'same name + DOB'}).
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      confirmLabel: groups.length === 0 ? 'Close' : `Merge ${redundantCount} duplicate(s)`,
      destructive: groups.length > 0,
    });
    if (ok && groups.length > 0) {
      for (const g of groups) {
        mergePatients(
          g.keep.id,
          g.redundant.map((p) => p.id),
        );
      }
      if (selectedId && groups.some((g) => g.redundant.some((p) => p.id === selectedId))) {
        const survivor = groups.find((g) => g.redundant.some((p) => p.id === selectedId))?.keep;
        if (survivor) setSelectedId(survivor.id);
      }
      await appendAudit({
        action: 'patient-dedupe',
        entityType: 'patient',
        summary: `Merged ${redundantCount} duplicate patient(s) across ${groups.length} group(s)`,
      });
    }
  }

  const duplicateGroups = useMemo(
    () => findDuplicatePatientGroups(data.patients, data),
    [data],
  );
  const duplicateTotal = duplicateGroups.reduce((sum, g) => sum + g.redundant.length, 0);
  const dupBannerDismissed = data.settings.duplicatePatientsBannerDismissed;
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <div>
      <SectionTitle
        title="Patients & Cases"
        subtitle="Search patients and manage their claims, service lines and approvals."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <LetterImportButton opts={{ entryPoint: 'patients' }} title={LETTER_IMPORT_FULL_TOOLTIP} />
            <button
              className={`btn btn-sm${duplicateTotal > 0 ? ' btn-salmon' : ''}`}
              onClick={() => void checkDuplicatePatients()}
              title={
                duplicateTotal > 0
                  ? `${duplicateTotal} possible duplicate${duplicateTotal === 1 ? '' : 's'} detected — open the merge tool.`
                  : 'Find patients sharing an NHI (or the same name and date of birth), and merge duplicates into one survivor after review.'
              }
            >
              Check for duplicate patients
            </button>
            <button className="btn btn-primary" onClick={openCreatePatient}>
              <IconPlus /> New patient
            </button>
          </div>
        }
      />
      {duplicateTotal > 0 && !dupBannerDismissed && (
        <div
          className="assumption-banner mb-3"
          role="status"
          aria-label="Possible duplicate patients"
        >
          <span className="assumption-banner-icon" aria-hidden>
            !
          </span>
          <p className="assumption-banner-body">
            <strong>{duplicateGroups.length}</strong> possible duplicate patient group
            {duplicateGroups.length === 1 ? '' : 's'} detected ({duplicateTotal} redundant record
            {duplicateTotal === 1 ? '' : 's'}).{' '}
            <button
              type="button"
              className="underline"
              style={{ color: 'var(--accent)' }}
              onClick={() => void checkDuplicatePatients()}
            >
              Review and merge
            </button>
          </p>
          <button
            type="button"
            className="assumption-banner-dismiss"
            onClick={() => updateSettings({ duplicatePatientsBannerDismissed: true })}
          >
            Dismiss
          </button>
        </div>
      )}

      {data.patients.length === 0 ? (
        <EmptyState
          icon={<IconPatients width={32} height={32} />}
          title="No patients yet"
          message="Add a patient to start recording their claims and service lines."
          action={
            <button className="btn btn-primary" onClick={openCreatePatient}>
              <IconPlus /> New patient
            </button>
          }
        />
      ) : (
        <div
          className="grid gap-4 patients-layout-grid"
          style={{ gridTemplateColumns: '20rem minmax(0, 1fr)', alignItems: 'start' }}
        >
          <div className="card p-3 h-fit min-w-0">
            <div className="relative mb-2">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }}>
                <IconSearch width={15} height={15} />
              </span>
              <TextInput
                placeholder="Search name or NHI…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-1 flex-wrap mb-3" role="tablist" aria-label="Case filter">
              {(Object.keys(CASE_FILTER_LABEL) as CaseFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={caseFilter === f}
                  className="btn btn-sm"
                  data-active={caseFilter === f}
                  style={{
                    background:
                      caseFilter === f ? 'var(--accent-soft)' : undefined,
                    color: caseFilter === f ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setCaseFilter(f)}
                >
                  {CASE_FILTER_LABEL[f]}
                </button>
              ))}
            </div>
            {totalFiltered > 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                Showing {pageStart}–{pageEnd} of {totalFiltered.toLocaleString()}
                {search.trim() ? ` (filtered from ${data.patients.length.toLocaleString()})` : ''}
              </p>
            )}
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {pagePatients.map((p) => {
                const patientClaims = data.claims.filter((c) => c.patientId === p.id);
                const claimCount = patientClaims.length;
                // Pick the most-progressed active case stage for a compact badge.
                const openClaim = patientClaims.find((c) => isOpenCase(c));
                const stage = openClaim?.caseStage;
                const lastPurpose = openClaim?.lastMemoPurpose;
                return (
                  <button
                    key={p.id}
                    className="nav-item w-full text-left"
                    data-active={selected?.id === p.id}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium truncate">{p.name}</span>
                      <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>
                        {p.nhi || 'no NHI'} · {claimCount} claim{claimCount === 1 ? '' : 's'}
                        {stage ? ` · ${CASE_STAGE_LABEL[stage]}` : ''}
                        {lastPurpose ? ` · ${MEMO_PURPOSE_LABEL[lastPurpose]}` : ''}
                      </span>
                    </span>
                    <IconChevron width={14} height={14} />
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="text-sm py-4 text-center" style={{ color: 'var(--muted)' }}>
                  No patients match “{search}”.
                </p>
              )}
            </div>
            {totalFiltered > PATIENTS_PAGE_SIZE && (
              <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  Prev
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  Next
                </button>
              </div>
            )}
          </div>

          <div className="min-w-0">
            {selected ? (
              <PatientDetail
                key={selected.id}
                patient={selected}
                onEdit={() => openEditPatient(selected)}
                onDelete={() => void deletePatient(selected)}
              />
            ) : (
              <Card>
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  Select a patient to view their details.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      <Modal
        open={!!patientModal}
        title={patientModal?.mode === 'create' ? 'New patient' : 'Edit patient'}
        onClose={() => setPatientModal(null)}
        footer={
          <>
            <LetterImportButton
              label={PREFILL_FROM_LETTER_LABEL}
              opts={{
                prefillOnly: true,
                entryPoint: 'prefill',
                onPrefill: (p) => {
                  if (p.patient) {
                    setPatientForm((prev) => ({
                      ...prev,
                      name: p.patient!.name || prev.name,
                      nhi: p.patient!.nhi || prev.nhi,
                      dob: p.patient!.dob || prev.dob,
                    }));
                  }
                },
              }}
            />
            <button className="btn" onClick={() => setPatientModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={savePatient} disabled={!patientForm.name}>
              Save
            </button>
          </>
        }
      >
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{PREFILL_BUTTON_HINT}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Full name" required>
            <TextInput value={patientForm.name} onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })} />
          </Field>
          <Field label="NHI" error={patientForm.nhi && !nhiCheck.ok ? nhiCheck.warning : undefined}>
            <TextInput value={patientForm.nhi} onChange={(e) => setPatientForm({ ...patientForm, nhi: e.target.value })} />
          </Field>
          <Field label="Date of birth">
            <DateInput value={patientForm.dob} onChange={(e) => setPatientForm({ ...patientForm, dob: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <TextArea rows={3} value={patientForm.notes} onChange={(e) => setPatientForm({ ...patientForm, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}

function PatientDetail({
  patient,
  onEdit,
  onDelete,
}: {
  patient: Patient;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const data = useStore((s) => s.data);
  const addClaim = useStore((s) => s.addClaim);
  const updateClaim = useStore((s) => s.updateClaim);
  const removeClaim = useStore((s) => s.removeClaim);
  const [confirm, confirmDialog] = useConfirm();

  const claims = data.claims.filter((c) => c.patientId === patient.id);
  const findings = useMemo(
    () => filterFindingsForPatient(getComplianceFindings(data), patient.id),
    [data, patient.id],
  );

  const [claimModal, setClaimModal] = useState<{ mode: 'create' | 'edit'; claim?: Claim } | null>(null);
  const [claimForm, setClaimForm] = useState<Omit<Claim, 'id'>>(blankClaim(patient.id));

  function openCreateClaim(type: ClaimType = 'original', parentClaimId?: string, day1?: string) {
    setClaimForm({ ...blankClaim(patient.id), type, parentClaimId, day1Date: day1 ?? todayISO() });
    setClaimModal({ mode: 'create' });
  }
  function openEditClaim(c: Claim) {
    setClaimForm({ ...c });
    setClaimModal({ mode: 'edit', claim: c });
  }
  function saveClaim() {
    if (claimModal?.mode === 'create') addClaim(claimForm);
    else if (claimModal?.claim) updateClaim(claimModal.claim.id, claimForm);
    setClaimModal(null);
  }
  async function deleteClaim(c: Claim) {
    const ok = await confirm({
      title: 'Delete claim?',
      message: `Delete claim ${c.claimNumber} and its service lines and approvals?`,
      destructive: true,
      confirmLabel: 'Delete claim',
    });
    if (ok) removeClaim(c.id);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3 min-w-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate" title={patient.name}>
              {patient.name}
            </h2>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              NHI {patient.nhi || '—'} · DOB {formatDate(patient.dob) || '—'}
            </div>
            {patient.notes && <p className="text-sm mt-2 whitespace-pre-wrap">{patient.notes}</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button className="btn btn-icon" onClick={onEdit} aria-label="Edit patient">
              <IconEdit width={16} height={16} />
            </button>
            <button className="btn btn-icon btn-icon-danger" onClick={onDelete} aria-label="Delete patient">
              <IconTrash width={16} height={16} />
            </button>
          </div>
        </div>
        <MemoPanel patient={patient} />
      </Card>

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Claims / Episodes</h3>
        <button className="btn" onClick={() => openCreateClaim()}>
          <IconPlus width={15} height={15} /> Add claim
        </button>
      </div>

      {claims.length === 0 ? (
        <EmptyState
          title="No claims for this patient"
          message="Add a claim to record service lines and approvals."
          action={
            <button className="btn btn-primary" onClick={() => openCreateClaim()}>
              <IconPlus width={15} height={15} /> Add claim
            </button>
          }
        />
      ) : (
        claims.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
            findings={findings.filter((f) => f.claimId === claim.id)}
            onEdit={() => openEditClaim(claim)}
            onDelete={() => void deleteClaim(claim)}
            onAddSubsequent={() =>
              openCreateClaim('subsequent', claim.id, todayISO())
            }
          />
        ))
      )}

      <Modal
        open={!!claimModal}
        title={claimModal?.mode === 'create' ? 'New claim' : 'Edit claim'}
        onClose={() => setClaimModal(null)}
        size="lg"
        footer={
          <>
            <LetterImportButton
              label={PREFILL_FROM_LETTER_LABEL}
              opts={{
                context: { patientId: patient.id, claimId: claimModal?.claim?.id },
                prefillOnly: true,
                entryPoint: 'prefill',
                onPrefill: (p) => {
                  setClaimForm((prev) => ({
                    ...prev,
                    claimNumber: p.claim.claimNumber || prev.claimNumber,
                    acc45Number: p.claim.acc45Number || prev.acc45Number,
                    poNumber: p.claim.poNumber || prev.poNumber,
                    injuryDescription: p.claim.injuryDescription || prev.injuryDescription,
                    day1Date: p.claim.day1Date || prev.day1Date,
                  }));
                },
              }}
            />
            <button className="btn" onClick={() => setClaimModal(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={saveClaim} disabled={!claimForm.claimNumber}>
              Save
            </button>
          </>
        }
      >
        <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>{PREFILL_BUTTON_HINT}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Claim number" required>
            <TextInput value={claimForm.claimNumber} onChange={(e) => setClaimForm({ ...claimForm, claimNumber: e.target.value })} />
          </Field>
          <Field label="ACC45 number">
            <TextInput value={claimForm.acc45Number} onChange={(e) => setClaimForm({ ...claimForm, acc45Number: e.target.value })} />
          </Field>
          <Field label="Purchase Order number">
            <TextInput value={claimForm.poNumber} onChange={(e) => setClaimForm({ ...claimForm, poNumber: e.target.value })} />
          </Field>
          <Field label="Day 1 date">
            <DateInput value={claimForm.day1Date} onChange={(e) => setClaimForm({ ...claimForm, day1Date: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={claimForm.type} onChange={(e) => setClaimForm({ ...claimForm, type: e.target.value as ClaimType })}>
              <option value="original">Original / primary</option>
              <option value="subsequent">Subsequent injury</option>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={claimForm.status} onChange={(e) => setClaimForm({ ...claimForm, status: e.target.value as Claim['status'] })}>
              <option value="active">Active</option>
              <option value="discharged">Discharged</option>
            </Select>
          </Field>
          {claimForm.type === 'subsequent' && (
            <Field label="Parent (original) claim">
              <Select value={claimForm.parentClaimId ?? ''} onChange={(e) => setClaimForm({ ...claimForm, parentClaimId: e.target.value || undefined })}>
                <option value="">None</option>
                {claims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.claimNumber}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="sm:col-span-2">
            <Field label="Injury description">
              <TextArea rows={2} value={claimForm.injuryDescription} onChange={(e) => setClaimForm({ ...claimForm, injuryDescription: e.target.value })} />
            </Field>
          </div>
        </div>
        {claimForm.type === 'subsequent' && (
          <p className="text-xs mt-3" style={{ color: 'var(--warn-fg)' }}>
            Subsequent injury Day 1 is the reassessment date (not backdated). NS06 consults before
            reassessment do not count toward the new package.
          </p>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}

// Memos are a first-class, countable, timestamped record of follow-up
// questions sent to nurses — distinct from Patient.notes (free-text, not
// individually countable). Lives on the patient card, near the notes UI.
//
// A memo always opens (or continues) a case on a claim. The user must
// EXPLICITLY choose whether to renew on an existing claim (same_claim) or
// start a new claim approval (new_claim). We suggest a default based on the
// selected MemoPurpose (see `defaultMemoTarget`) but never decide silently.
function MemoPanel({ patient }: { patient: Patient }) {
  const data = useStore((s) => s.data);
  const memos = data.memos ?? [];
  const sendMemoStartingCase = useStore((s) => s.sendMemoStartingCase);
  const resolveMemo = useStore((s) => s.resolveMemo);
  const removeMemo = useStore((s) => s.removeMemo);
  const [confirm, confirmDialog] = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{
    text: string;
    to: string;
    purpose: MemoPurpose;
    target: 'same_claim' | 'new_claim';
    claimId: string;
    parentClaimId: string;
    memoFile?: File;
  }>({ ...MEMO_EMPTY, target: 'same_claim', claimId: '', parentClaimId: '' });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const memoFileInput = useRef<HTMLInputElement>(null);

  const patientClaims = useMemo(
    () => data.claims.filter((c) => c.patientId === patient.id),
    [data.claims, patient.id],
  );

  useEffect(() => {
    // Default the target based on the chosen purpose, and pre-select the
    // first claim if the user has one and hasn't picked yet. If the patient
    // has no claims at all, force `new_claim` so the "Send memo" button is
    // never trapped in the disabled-because-no-claim-picked state.
    setForm((prev) => {
      const suggested = defaultMemoTarget(prev.purpose);
      let target = prev.target;
      if (!prev.claimId) target = suggested;
      if (patientClaims.length === 0) target = 'new_claim';
      let claimId = prev.claimId;
      if (target === 'same_claim' && !claimId && patientClaims[0]) {
        claimId = patientClaims[0].id;
      }
      return { ...prev, target, claimId };
    });
  }, [form.purpose, patientClaims]);

  const patientMemos = useMemo(
    () => memos.filter((m) => m.patientId === patient.id).sort((a, b) => b.createdAt - a.createdAt),
    [memos, patient.id],
  );
  const unresolvedCount = patientMemos.filter((m) => !m.resolved).length;

  async function submit() {
    const text = form.text.trim();
    if (!text) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      // If patient has no claims, the store guards us anyway; we route through
      // the case-workflow entry point so a claim is created for `new_claim`.
      if (patientClaims.length === 0 || form.target === 'new_claim') {
        await sendMemoStartingCase({
          patientId: patient.id,
          target: 'new_claim',
          parentClaimId: form.parentClaimId || undefined,
          purpose: form.purpose,
          text,
          to: form.to.trim() || undefined,
          memoFile: form.memoFile
            ? { blob: form.memoFile, fileName: form.memoFile.name, mimeType: form.memoFile.type }
            : undefined,
        });
      } else {
        await sendMemoStartingCase({
          patientId: patient.id,
          target: 'same_claim',
          claimId: form.claimId,
          purpose: form.purpose,
          text,
          to: form.to.trim() || undefined,
          memoFile: form.memoFile
            ? { blob: form.memoFile, fileName: form.memoFile.name, mimeType: form.memoFile.type }
            : undefined,
        });
      }
      setForm({ ...MEMO_EMPTY, target: 'same_claim', claimId: '', parentClaimId: '' });
      setAdding(false);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function del(id: string) {
    const ok = await confirm({
      title: 'Delete memo?',
      message: 'Delete this memo? This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeMemo(id);
  }

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          Memos to nurses
          {patientMemos.length > 0 &&
            ` (${patientMemos.length}${unresolvedCount > 0 ? `, ${unresolvedCount} unresolved` : ''})`}
        </h4>
        <button className="btn btn-sm" onClick={() => setAdding((v) => !v)}>
          <IconPlus width={14} height={14} /> Add memo
        </button>
      </div>
      {adding && (
        <div className="rounded-lg p-3 mb-2 space-y-2" style={{ background: 'var(--surface-2)' }}>
          <Field label="Purpose" hint="Suggests same-claim vs new-claim default; you can override.">
            <Select
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value as MemoPurpose })}
            >
              {(Object.keys(MEMO_PURPOSE_LABEL) as MemoPurpose[]).map((p) => (
                <option key={p} value={p}>
                  {MEMO_PURPOSE_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Target" required hint="Locked decision — memos are never silent auto-only.">
            <div className="flex items-center gap-2 flex-wrap">
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name={`memo-target-${patient.id}`}
                  checked={form.target === 'same_claim'}
                  disabled={patientClaims.length === 0}
                  onChange={() => setForm({ ...form, target: 'same_claim' })}
                />
                Renewal on this claim
              </label>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="radio"
                  name={`memo-target-${patient.id}`}
                  checked={form.target === 'new_claim'}
                  onChange={() => setForm({ ...form, target: 'new_claim' })}
                />
                New claim approval
              </label>
            </div>
          </Field>
          {form.target === 'same_claim' && patientClaims.length > 0 && (
            <Field label="Claim" required>
              <Select
                value={form.claimId}
                onChange={(e) => setForm({ ...form, claimId: e.target.value })}
              >
                <option value="">Select claim…</option>
                {patientClaims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.claimNumber || c.id}
                    {c.caseStage && c.caseStage !== 'not_started'
                      ? ` — ${CASE_STAGE_LABEL[c.caseStage]}`
                      : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {form.target === 'new_claim' && patientClaims.length > 0 && (
            <Field label="Parent claim (optional)" hint="Link a subsequent-injury claim to its parent.">
              <Select
                value={form.parentClaimId}
                onChange={(e) => setForm({ ...form, parentClaimId: e.target.value })}
              >
                <option value="">No parent (original)</option>
                {patientClaims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.claimNumber || c.id}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Memo text" required>
            <TextArea
              rows={2}
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              placeholder="Follow-up question for the nurse…"
            />
          </Field>
          <Field label="To (optional)" hint="Free-text — nurse or team name.">
            <TextInput value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="e.g. district nurse team" />
          </Field>
          <Field label="Attach memo file (optional)" hint="You can attach later without changing stage.">
            <input
              ref={memoFileInput}
              type="file"
              onChange={(e) => setForm({ ...form, memoFile: e.target.files?.[0] })}
            />
          </Field>
          {submitError && (
            <p className="text-xs" style={{ color: 'var(--danger-fg)' }}>
              {submitError}
            </p>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button
              className="btn btn-sm"
              onClick={() => {
                setAdding(false);
                setForm({ ...MEMO_EMPTY, target: 'same_claim', claimId: '', parentClaimId: '' });
                setSubmitError(null);
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void submit()}
              disabled={
                !form.text.trim() ||
                submitting ||
                (form.target === 'same_claim' && !form.claimId)
              }
            >
              {submitting ? 'Sending…' : 'Send memo'}
            </button>
          </div>
        </div>
      )}
      {patientMemos.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No memos sent for this patient yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {patientMemos.map((m) => (
            <div
              key={m.id}
              className="rounded-lg p-2.5 flex items-start justify-between gap-3"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="min-w-0">
                <p className="text-sm whitespace-pre-wrap">{m.text}</p>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {m.to ? `To ${m.to} · ` : ''}
                  {new Date(m.createdAt).toLocaleString('en-NZ')}
                  {m.resolved && m.resolvedAt ? ` · resolved ${new Date(m.resolvedAt).toLocaleString('en-NZ')}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                <Badge tone={m.resolved ? 'good' : 'salmon'}>{m.resolved ? 'Resolved' : 'Unresolved'}</Badge>
                <button className="btn btn-sm" onClick={() => resolveMemo(m.id, !m.resolved)}>
                  {m.resolved ? 'Reopen' : 'Mark resolved'}
                </button>
                <button
                  className="btn btn-icon btn-icon-danger"
                  onClick={() => void del(m.id)}
                  aria-label="Delete memo"
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

const BILLING_PILL: Record<BillingState, { label: string; tone: 'good' | 'salmon' | 'neutral' | 'accent' }> = {
  ready: { label: 'Safe to bill now', tone: 'good' },
  waiting: { label: 'In progress', tone: 'neutral' },
  'blocked-on-approval': { label: 'Blocked on approval/PO', tone: 'salmon' },
  billed: { label: 'Billed', tone: 'accent' },
};

function ClaimCard({
  claim,
  findings,
  onEdit,
  onDelete,
  onAddSubsequent,
}: {
  claim: Claim;
  findings: ComplianceFinding[];
  onEdit: () => void;
  onDelete: () => void;
  onAddSubsequent: () => void;
}) {
  const data = useStore((s) => s.data);
  const addServiceLine = useStore((s) => s.addServiceLine);
  const updateServiceLine = useStore((s) => s.updateServiceLine);
  const removeServiceLine = useStore((s) => s.removeServiceLine);
  const addApproval = useStore((s) => s.addApproval);
  const generateInvoiceLinesForClaim = useStore((s) => s.generateInvoiceLinesForClaim);
  const setFocus = useStore((s) => s.setFocus);
  const [confirm, confirmDialog] = useConfirm();

  const lines = data.serviceLines.filter((s) => s.claimId === claim.id);
  const approvals = data.approvals.filter((a) => a.claimId === claim.id);
  const [expanded, setExpanded] = useState(false);
  const billingApprovals = approvals.filter(isBillingApproval);
  const historicalApprovals = approvals.filter((a) => !isBillingApproval(a));
  const hasCurrentBillingApproval = billingApprovals.some((a) => a.recordStatus !== 'historical');

  // Match this claim's invoice lines (by claim/ACC45 number) for billing state.
  const claimInvoices = data.invoiceLines.filter((i) => {
    const key = (claim.claimNumber || '').trim().toUpperCase();
    const acc = (claim.acc45Number || '').trim().toUpperCase();
    return (
      (key && (i.claimNumber || '').trim().toUpperCase() === key) ||
      (acc && (i.acc45Number || '').trim().toUpperCase() === acc)
    );
  });
  const billing = claimBillingState(claim, lines, approvals, claimInvoices);
  const violationCount = findings.filter((f) => f.severity === 'violation').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  function generateBilling() {
    const created = generateInvoiceLinesForClaim(claim.id);
    if (created > 0) setFocus({ module: 'billing', claimId: claim.id });
  }

  const [lineModal, setLineModal] = useState<{ mode: 'create' | 'edit'; line?: ServiceLine } | null>(null);
  const [lineForm, setLineForm] = useState<Omit<ServiceLine, 'id'>>(blankLine(claim.id, claim.day1Date));
  const [showCalc, setShowCalc] = useState(false);
  // Inline "create new approval" fields, used when the code is NS04/NS05 and the
  // user chooses to create an approval rather than link an existing one.
  const [newApproval, setNewApproval] = useState<NewApprovalForm>(blankNewApproval());

  // NS04/NS05 are approval-based, not duration packages. Sentinel used in the
  // approval <select> to mean "create a new approval on save".
  const NEW_APPROVAL = '__new__';
  const isApprovalCode = lineForm.serviceCode === 'NS04' || lineForm.serviceCode === 'NS05';

  function openCreateLine() {
    setLineForm(blankLine(claim.id, claim.day1Date));
    setNewApproval(blankNewApproval(claim.poNumber));
    setShowCalc(false);
    setLineModal({ mode: 'create' });
  }
  function openEditLine(line: ServiceLine) {
    setLineForm({ ...line });
    setNewApproval(blankNewApproval(claim.poNumber));
    setShowCalc(false);
    setLineModal({ mode: 'edit', line });
  }

  // Deep-link from a compliance fix (e.g. "Set override to NS02"): open the
  // referenced service line in edit mode with the suggested override applied.
  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);
  useEffect(() => {
    if (!focus || focus.module !== 'patients' || focus.claimId !== claim.id) return;
    const prefill = focus.prefill ?? {};
    const lineId = prefill.serviceLineId as string | undefined;
    if (lineId) {
      const line = lines.find((l) => l.id === lineId);
      if (line) {
        setLineForm({
          ...line,
          overridePackage: (prefill.overridePackage as ServiceCode | undefined) ?? line.overridePackage,
        });
        setNewApproval(blankNewApproval(claim.poNumber));
        setShowCalc(false);
        setLineModal({ mode: 'edit', line });
      }
    }
    clearFocus();
  }, [focus, claim.id, claim.poNumber, lines, clearFocus]);
  function saveLine() {
    const approvalCode = lineForm.serviceCode === 'NS04' || lineForm.serviceCode === 'NS05';
    if (approvalCode) {
      let approvalId = lineForm.approvalId;
      if (approvalId === NEW_APPROVAL) {
        approvalId = addApproval({
          patientId: claim.patientId,
          claimId: claim.id,
          serviceCode: lineForm.serviceCode as ApprovalServiceCode,
          approvalStartDate: newApproval.approvalStartDate,
          approvalEndDate: newApproval.approvalEndDate,
          approvedHoursOrConsults: newApproval.approvedHoursOrConsults,
          consultsUsed: undefined,
          accEmailedRenewalDate: undefined,
          poNumber: newApproval.poNumber,
          notes: '',
        });
      }
      const payload = { ...lineForm, approvalId, recommendedPackage: lineForm.serviceCode };
      if (lineModal?.mode === 'create') addServiceLine(payload);
      else if (lineModal?.line) updateServiceLine(lineModal.line.id, payload);
      setLineModal(null);
      return;
    }
    const det = determinePackage(
      {
        day1: lineForm.day1Date,
        lastConsult: lineForm.lastConsultDate || undefined,
        consultCount: lineForm.consultCount,
        interruptions: lineForm.interruptions,
      },
      data.settings.serviceRates,
    );
    const recommended = det.recommendedCodes.join(' + ');
    // Package codes never carry an approval link.
    const payload = { ...lineForm, recommendedPackage: recommended, approvalId: undefined };
    if (lineModal?.mode === 'create') addServiceLine(payload);
    else if (lineModal?.line) updateServiceLine(lineModal.line.id, payload);
    setLineModal(null);
  }
  async function deleteLine(line: ServiceLine) {
    const ok = await confirm({
      title: 'Delete service line?',
      message: `Delete the ${line.serviceCode} service line?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeServiceLine(line.id);
  }

  const liveDet =
    lineModal && !isApprovalCode
      ? determinePackage(
          {
            day1: lineForm.day1Date,
            lastConsult: lineForm.lastConsultDate || undefined,
            consultCount: lineForm.consultCount,
            interruptions: lineForm.interruptions,
          },
          data.settings.serviceRates,
        )
      : null;

  const linkedApproval =
    isApprovalCode && lineForm.approvalId && lineForm.approvalId !== NEW_APPROVAL
      ? approvals.find((a) => a.id === lineForm.approvalId)
      : undefined;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{claim.claimNumber}</span>
            <Badge tone={claim.type === 'subsequent' ? 'warn' : 'neutral'}>
              {claim.type === 'subsequent' ? 'Subsequent' : 'Original'}
            </Badge>
            <Badge tone={claim.status === 'active' ? 'good' : 'neutral'}>{claim.status}</Badge>
            <Badge tone={BILLING_PILL[billing.state].tone}>{BILLING_PILL[billing.state].label}</Badge>
            {violationCount > 0 && (
              <Badge tone="danger">
                {violationCount} flag{violationCount === 1 ? '' : 's'}
              </Badge>
            )}
            {violationCount === 0 && warningCount > 0 && (
              <Badge tone="salmon">
                {warningCount} warning{warningCount === 1 ? '' : 's'}
              </Badge>
            )}
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Day 1 {formatDate(claim.day1Date)} · ACC45 {claim.acc45Number || '—'} · PO {claim.poNumber || '—'}
          </div>
          <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
            {billing.reason}
          </div>
          {claim.injuryDescription && <p className="text-sm mt-1">{claim.injuryDescription}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
          {!hasCurrentBillingApproval && (
            <LetterImportButton
              opts={{ context: { patientId: claim.patientId, claimId: claim.id }, entryPoint: 'claim-documents' }}
            />
          )}
          {billing.state === 'ready' && violationCount === 0 && (
            <button className="btn btn-primary btn-sm" onClick={generateBilling}>
              Generate invoice lines
            </button>
          )}
          <button className="btn btn-icon" onClick={onEdit} aria-label="Edit claim">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-icon btn-icon-danger" onClick={onDelete} aria-label="Delete claim">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      </div>

      {/* Case workflow panel — step tracker + actions + timeline */}
      <CasePanel claim={claim} />

      {/* Service lines */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            Service lines
          </h4>
          <button className="btn btn-sm" onClick={openCreateLine}>
            <IconPlus width={14} height={14} /> Add line
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No service lines.
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => {
              const lineApprovalCode = line.serviceCode === 'NS04' || line.serviceCode === 'NS05';
              const det = lineApprovalCode
                ? null
                : determinePackage(
                    {
                      day1: line.day1Date,
                      lastConsult: line.lastConsultDate || undefined,
                      consultCount: line.consultCount,
                      interruptions: line.interruptions,
                    },
                    data.settings.serviceRates,
                  );
              const linked =
                lineApprovalCode && line.approvalId
                  ? data.approvals.find((a) => a.id === line.approvalId)
                  : undefined;
              const linkedComputed = linked ? computeApproval(linked, data.settings.expiryThresholdDays) : null;
              const unit = lineApprovalCode && line.serviceCode === 'NS05' ? 'hour' : 'consult';
              return (
                <div
                  key={line.id}
                  className="rounded-lg p-2.5 flex items-start justify-between gap-3"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge tone="neutral">{line.serviceCode}</Badge>
                      <span className="text-sm">
                        {line.consultCount} {unit}{line.consultCount === 1 ? '' : 's'}
                      </span>
                      {lineApprovalCode ? (
                        linked ? (
                          <span className="text-xs" style={{ color: 'var(--muted)' }}>
                            PO {linked.poNumber || '—'} · expires {formatDate(linked.approvalEndDate)}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--salmon-fg)' }}>
                            No approval linked
                          </span>
                        )
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          Day 1 {formatDate(line.day1Date)}
                          {line.lastConsultDate ? ` → ${formatDate(line.lastConsultDate)}` : ' · ongoing'}
                        </span>
                      )}
                    </div>
                    {lineApprovalCode ? (
                      <div className="text-xs mt-1 flex items-center gap-2 flex-wrap">
                        {linkedComputed ? (
                          linkedComputed.status === 'EXPIRED' ? (
                            <Badge tone="danger">Approval EXPIRED</Badge>
                          ) : linkedComputed.status !== 'Active' ? (
                            <Badge tone="salmon">Approval expiring</Badge>
                          ) : (
                            <Badge tone="good">Approval active</Badge>
                          )
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Edit the line to link an approval.</span>
                        )}
                      </div>
                    ) : (
                      det && (
                        <div className="text-xs mt-1">
                          <span style={{ color: 'var(--muted)' }}>Recommended: </span>
                          <span className="font-medium" style={{ color: 'var(--accent)' }}>
                            {line.overridePackage ? `${line.overridePackage} (override)` : det.recommendedCodes.join(' + ')}
                          </span>{' '}
                          · {formatCurrency(effectivePackageValue(det, line.overridePackage, line.consultCount, data.settings.serviceRates))}
                        </div>
                      )
                    )}
                    {line.overrideReason && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        Override: {line.overrideReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="btn btn-icon" onClick={() => openEditLine(line)} aria-label="Edit line">
                      <IconEdit width={14} height={14} />
                    </button>
                    <button className="btn btn-icon btn-icon-danger" onClick={() => void deleteLine(line)} aria-label="Delete line">
                      <IconTrash width={14} height={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Approvals on this claim */}
      {billingApprovals.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--muted)' }}>
            Approvals
          </h4>
          <div className="space-y-1">
            {billingApprovals.map((a) => {
              const c = computeApproval(a, data.settings.expiryThresholdDays);
              return (
                <div key={a.id} className="text-sm flex items-center gap-2 flex-wrap">
                  <Badge tone="accent">{a.serviceCode}</Badge>
                  <span>PO {a.poNumber || '—'}</span>
                  <span style={{ color: 'var(--muted)' }}>expires {formatDate(a.approvalEndDate)}</span>
                  {c.status === 'EXPIRED' ? (
                    <Badge tone="danger">EXPIRED</Badge>
                  ) : c.status !== 'Active' ? (
                    <Badge tone="salmon">Expiring</Badge>
                  ) : (
                    <Badge tone="good">Active</Badge>
                  )}
                  {a.autoAccepted && (
                    <Badge tone="neutral">
                      <span title="Filed by Auto-accept ready — created without individual human review.">
                        Auto-accepted
                      </span>
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
          {historicalApprovals.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setExpanded((v) => !v)}
              >
                {historicalApprovals.length} earlier period{historicalApprovals.length === 1 ? '' : 's'} on file
                <IconChevron className={expanded ? 'rotate-180' : ''} width={14} height={14} />
              </button>
              {expanded && (
                <div className="space-y-1 mt-1 pl-2 border-l-2" style={{ borderColor: 'var(--border)' }}>
                  {historicalApprovals.map((a) => (
                    <div key={a.id} className="text-xs flex items-center gap-2 flex-wrap" style={{ color: 'var(--muted)' }}>
                      <Badge tone="neutral">{a.serviceCode}</Badge>
                      <span>
                        {formatDate(a.approvalStartDate)} – {formatDate(a.approvalEndDate)}
                      </span>
                      <Badge tone="neutral">Historical</Badge>
                      {a.autoAccepted && <Badge tone="neutral">Auto-accepted</Badge>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Documents: ACC approval letters received + approval requests we sent */}
      <ClaimDocuments claimId={claim.id} />

      <div className="mt-3 flex items-center gap-2">
        {claim.type === 'original' && (
          <button className="btn btn-sm" onClick={onAddSubsequent}>
            <IconPlus width={14} height={14} /> Reclassify subsequent injury → new primary
          </button>
        )}
      </div>

      <Modal
        open={!!lineModal}
        title={lineModal?.mode === 'create' ? 'New service line' : 'Edit service line'}
        onClose={() => setLineModal(null)}
        size="xl"
        footer={
          <>
            <button className="btn" onClick={() => setLineModal(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={saveLine}
              disabled={isApprovalCode && lineForm.approvalId === NEW_APPROVAL && !newApproval.approvalEndDate}
            >
              Save
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Service code">
            <Select value={lineForm.serviceCode} onChange={(e) => setLineForm({ ...lineForm, serviceCode: e.target.value as ServiceCode })}>
              {visibleServiceCodes(data.settings, lineForm.serviceCode).map((c) => (
                <option key={c} value={c}>
                  {serviceCodeLabel(c)}
                </option>
              ))}
            </Select>
          </Field>

          {isApprovalCode ? (
            <Field label="Approval" hint="NS04/NS05 bill against an ACC approval, not a package duration.">
              <Select
                value={lineForm.approvalId ?? ''}
                onChange={(e) => setLineForm({ ...lineForm, approvalId: e.target.value || undefined })}
              >
                <option value="">Select approval…</option>
                {billingApprovals.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.serviceCode} · PO {a.poNumber || '—'} · expires {formatDate(a.approvalEndDate)}
                  </option>
                ))}
                <option value={NEW_APPROVAL}>+ Create new approval…</option>
              </Select>
            </Field>
          ) : (
            <>
              <Field label="Day 1 date">
                <DateInput value={lineForm.day1Date} onChange={(e) => setLineForm({ ...lineForm, day1Date: e.target.value })} />
              </Field>
              <Field label="Last consult date (blank = ongoing)">
                <DateInput value={lineForm.lastConsultDate ?? ''} onChange={(e) => setLineForm({ ...lineForm, lastConsultDate: e.target.value || undefined })} />
              </Field>
            </>
          )}

          <Field label={isApprovalCode ? (lineForm.serviceCode === 'NS05' ? 'Hours' : 'Consults') : 'Consult count'}>
            <NumberInput min={0} value={lineForm.consultCount} onChange={(e) => setLineForm({ ...lineForm, consultCount: Math.max(0, Number(e.target.value)) })} />
          </Field>
          <Field label="Override package (optional)">
            <Select value={lineForm.overridePackage ?? ''} onChange={(e) => setLineForm({ ...lineForm, overridePackage: (e.target.value || undefined) as ServiceCode | undefined })}>
              <option value="">No override</option>
              {visibleServiceCodes(data.settings, lineForm.overridePackage).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Override reason">
            <TextInput value={lineForm.overrideReason ?? ''} onChange={(e) => setLineForm({ ...lineForm, overrideReason: e.target.value || undefined })} />
          </Field>
        </div>

        {isApprovalCode && lineForm.approvalId === NEW_APPROVAL && (
          <div className="mt-3 rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
            <div className="text-sm font-semibold mb-2">New approval</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="PO Number">
                <TextInput value={newApproval.poNumber} onChange={(e) => setNewApproval({ ...newApproval, poNumber: e.target.value })} />
              </Field>
              <Field label={lineForm.serviceCode === 'NS05' ? 'Approved hours' : 'Approved consults'}>
                <NumberInput
                  min={0}
                  value={newApproval.approvedHoursOrConsults}
                  onChange={(e) => setNewApproval({ ...newApproval, approvedHoursOrConsults: Math.max(0, Number(e.target.value)) })}
                />
              </Field>
              <Field label="Approval start date">
                <DateInput value={newApproval.approvalStartDate} onChange={(e) => setNewApproval({ ...newApproval, approvalStartDate: e.target.value })} />
              </Field>
              <Field label="Approval end date / PO expiry" required>
                <DateInput value={newApproval.approvalEndDate} onChange={(e) => setNewApproval({ ...newApproval, approvalEndDate: e.target.value })} />
              </Field>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              This creates a record in the Approvals module and links this service line to it, which
              also clears the dashboard coverage-gap warning for this claim.
            </p>
          </div>
        )}

        {linkedApproval && (
          <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            {(() => {
              const c = computeApproval(linkedApproval, data.settings.expiryThresholdDays);
              return (
                <>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">Linked approval:</span>
                    <Badge tone="accent">{linkedApproval.serviceCode}</Badge>
                    <span>PO {linkedApproval.poNumber || '—'}</span>
                    <span style={{ color: 'var(--muted)' }}>expires {formatDate(linkedApproval.approvalEndDate)}</span>
                    {c.status === 'EXPIRED' ? (
                      <Badge tone="danger">EXPIRED</Badge>
                    ) : c.status !== 'Active' ? (
                      <Badge tone="salmon">Expiring</Badge>
                    ) : (
                      <Badge tone="good">Active</Badge>
                    )}
                  </div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {c.daysUntilExpiry < 0
                      ? `Expired ${Math.abs(c.daysUntilExpiry)} day(s) ago.`
                      : `${c.daysUntilExpiry} day(s) until expiry.`}
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {!isApprovalCode && liveDet && (
          <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold">Recommendation:</span>
              {(lineForm.overridePackage ? [lineForm.overridePackage] : liveDet.recommendedCodes).map((c) => (
                <Badge key={c} tone="accent">
                  {c}
                  {lineForm.overridePackage ? ' (override)' : ''}
                </Badge>
              ))}
              <span className="font-semibold">
                {formatCurrency(effectivePackageValue(liveDet, lineForm.overridePackage, lineForm.consultCount, data.settings.serviceRates))}
              </span>
            </div>
            <div style={{ color: 'var(--muted)' }}>{liveDet.reason}</div>
          </div>
        )}

        {!isApprovalCode && (
          <>
            <button className="btn btn-sm mt-3" onClick={() => setShowCalc((v) => !v)}>
              {showCalc ? 'Hide' : 'Open'} full calculator
            </button>
            {showCalc && (
              <div className="mt-3">
                <PackageCalculatorPanel
                  initial={{
                    day1: lineForm.day1Date,
                    lastConsult: lineForm.lastConsultDate,
                    consultCount: lineForm.consultCount,
                    interruptions: lineForm.interruptions,
                  }}
                />
              </div>
            )}
          </>
        )}
      </Modal>

      {confirmDialog}
    </Card>
  );
}

/**
 * Case workflow panel: shows the step tracker for the claim, an event
 * timeline, and quick action buttons for the legal next transitions.
 * Actions call `advanceCaseStage` / `recordCaseChase` / `attachCaseDocument`
 * on the store; the pure workflow lib decides which transitions are legal.
 */
function CasePanel({ claim }: { claim: Claim }) {
  const advanceCaseStage = useStore((s) => s.advanceCaseStage);
  const recordCaseChase = useStore((s) => s.recordCaseChase);
  const attachCaseDocument = useStore((s) => s.attachCaseDocument);
  const [confirm, confirmDialog] = useConfirm();
  const [returnModal, setReturnModal] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<'docs_received' | 'corrected_docs_received' | 'submitted_to_acc' | null>(null);
  const [attachKind, setAttachKind] = useState<DocumentKind>('other');
  const attachInputAny = useRef<HTMLInputElement>(null);

  const stage = claim.caseStage ?? 'not_started';
  const events = claim.caseEvents ?? [];

  async function runTransition(kind: Parameters<typeof advanceCaseStage>[0]['kind']) {
    setError(null);
    setBusy(true);
    try {
      await advanceCaseStage({ claimId: claim.id, kind });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runTransitionWithFile(
    kind: 'docs_received' | 'corrected_docs_received' | 'submitted_to_acc',
    file: File,
  ) {
    setError(null);
    setBusy(true);
    try {
      await advanceCaseStage({
        claimId: claim.id,
        kind,
        documentBlob: { blob: file, fileName: file.name, mimeType: file.type },
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmClose() {
    const ok = await confirm({
      title: 'Close this case?',
      message:
        'Mark this case as closed without an ACC decision. Use this only when the case has been abandoned or superseded.',
      confirmLabel: 'Close case',
      destructive: true,
    });
    if (ok) await runTransition('closed');
  }

  return (
    <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          Case workflow
        </h4>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          Nurse due: {claim.nurseFollowUpDue ? formatDate(claim.nurseFollowUpDue) : '—'} · ACC due:{' '}
          {claim.accFollowUpDue ? formatDate(claim.accFollowUpDue) : '—'}
        </span>
      </div>
      <CaseStepTracker stage={stage} />

      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--danger-fg)' }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {stage === 'awaiting_nurse_docs' || stage === 'docs_returned' ? (
          <>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setPendingKind(stage === 'docs_returned' ? 'corrected_docs_received' : 'docs_received')}
            >
              <IconPlus width={14} height={14} />{' '}
              {stage === 'docs_returned' ? 'Corrected docs received' : 'Docs received'}
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => recordCaseChase(claim.id, 'nurse')}
            >
              Chase nurse
            </button>
          </>
        ) : null}
        {stage === 'docs_received' && (
          <>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setPendingKind('submitted_to_acc')}
            >
              Submitted to ACC
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setReturnModal(true)}
            >
              Return for correction
            </button>
          </>
        )}
        {stage === 'awaiting_acc' && (
          <>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void runTransition('acc_approved')}
            >
              Mark approved
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void runTransition('acc_declined')}
            >
              Mark declined
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={() => recordCaseChase(claim.id, 'acc')}
            >
              Chase ACC
            </button>
          </>
        )}
        {(stage === 'awaiting_nurse_docs' ||
          stage === 'docs_received' ||
          stage === 'docs_returned' ||
          stage === 'awaiting_acc') && (
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => void confirmClose()}
          >
            Close case
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy}
          onClick={() => attachInputAny.current?.click()}
          title="Attach a document to this case without changing stage"
        >
          Attach file
        </button>
        <Select
          className="text-xs py-1"
          value={attachKind}
          onChange={(e) => setAttachKind(e.target.value as DocumentKind)}
          aria-label="Attachment type"
        >
          <option value="nurse-memo">Memo to nurse</option>
          <option value="nursing-docs">Nursing docs</option>
          <option value="nursing-docs-corrected">Nursing docs (corrected)</option>
          <option value="acc-submission">ACC submission bundle</option>
          <option value="other">Other</option>
        </Select>
        <input
          ref={attachInputAny}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              setBusy(true);
              setError(null);
              attachCaseDocument(
                claim.id,
                { kind: attachKind, fileName: f.name, mimeType: f.type },
                f,
              )
                .catch((err) => setError((err as Error).message))
                .finally(() => {
                  setBusy(false);
                  if (attachInputAny.current) attachInputAny.current.value = '';
                });
            }
          }}
        />
      </div>

      {/* Hidden file input for pendingKind (docs received / corrected / submitted). */}
      <input
        ref={attachInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          const kind = pendingKind;
          setPendingKind(null);
          if (attachInput.current) attachInput.current.value = '';
          if (f && kind) void runTransitionWithFile(kind, f);
        }}
      />

      {pendingKind && (
        <Modal
          open={!!pendingKind}
          title={
            pendingKind === 'submitted_to_acc'
              ? 'Submitted to ACC'
              : pendingKind === 'corrected_docs_received'
                ? 'Corrected docs received'
                : 'Docs received'
          }
          onClose={() => setPendingKind(null)}
          size="sm"
          footer={
            <>
              <button className="btn" onClick={() => setPendingKind(null)}>
                Cancel
              </button>
              <button
                className="btn"
                onClick={() => {
                  const kind = pendingKind;
                  setPendingKind(null);
                  if (kind) void runTransition(kind);
                }}
                disabled={busy}
              >
                Advance without attaching
              </button>
              <button
                className="btn btn-primary"
                onClick={() => attachInput.current?.click()}
                disabled={busy}
              >
                Attach a file
              </button>
            </>
          }
        >
          <p className="text-sm" style={{ color: 'var(--text)' }}>
            {pendingKind === 'submitted_to_acc'
              ? 'Attach your ACC submission bundle (optional). You can also add it later.'
              : 'Attach the nursing documents you received (optional). You can also add them later.'}
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            Nursing Services QA reminders: ACC179 must reflect the initial consult, not Day 1; NS04 covers
            visits 26+; NS05 starts the day after the prior period expires; claim must be accepted in
            eBusiness before submitting.
          </p>
        </Modal>
      )}

      <Modal
        open={returnModal}
        title="Return docs for correction"
        onClose={() => setReturnModal(false)}
        size="sm"
        footer={
          <>
            <button className="btn" onClick={() => setReturnModal(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                if (!returnReason.trim()) return;
                setError(null);
                setBusy(true);
                try {
                  await advanceCaseStage({
                    claimId: claim.id,
                    kind: 'docs_returned',
                    note: returnReason.trim(),
                  });
                  setReturnReason('');
                  setReturnModal(false);
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              disabled={!returnReason.trim() || busy}
            >
              Return for correction
            </button>
          </>
        }
      >
        <Field label="Reason" required hint="Required — nurse needs to know what to fix.">
          <TextArea
            rows={3}
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            placeholder="e.g. ACC179 initial-consult date missing"
          />
        </Field>
      </Modal>

      {events.length > 0 && (
        <div className="mt-3">
          <h5 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Timeline
          </h5>
          <ul className="mt-1 space-y-1">
            {events
              .slice()
              .reverse()
              .map((evt) => (
                <li
                  key={evt.id}
                  className="text-xs flex items-start gap-2 rounded-lg p-2"
                  style={{ background: 'var(--surface-2)' }}
                >
                  <span className="font-mono shrink-0" style={{ color: 'var(--muted)' }}>
                    {new Date(evt.at).toLocaleString('en-NZ', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{CASE_EVENT_LABEL[evt.kind] ?? evt.kind}</span>
                    {evt.note ? <span style={{ color: 'var(--muted)' }}> · {evt.note}</span> : null}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}

      {confirmDialog}
    </div>
  );
}

const CASE_EVENT_LABEL: Record<string, string> = {
  memo_sent: 'Memo sent',
  nurse_chased: 'Chased nurse',
  docs_received: 'Docs received',
  docs_returned: 'Docs returned for correction',
  corrected_docs_received: 'Corrected docs received',
  submitted_to_acc: 'Submitted to ACC',
  acc_chased: 'Chased ACC',
  acc_approved: 'ACC approved',
  acc_declined: 'ACC declined',
  closed: 'Case closed',
  note: 'Note',
  attachment_added: 'Attachment added',
};

function blankClaim(patientId: string): Omit<Claim, 'id'> {
  return {
    patientId,
    acc45Number: '',
    claimNumber: '',
    poNumber: '',
    injuryDescription: '',
    type: 'original',
    parentClaimId: undefined,
    status: 'active',
    day1Date: todayISO(),
  };
}

const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  'acc-approval-letter': 'ACC approval letter',
  'acc-decline-letter': 'ACC decline letter',
  'approval-request': 'Approval request (sent)',
  'nurse-memo': 'Memo to nurse',
  'nursing-docs': 'Nursing docs',
  'nursing-docs-corrected': 'Nursing docs (corrected)',
  'acc-submission': 'ACC submission bundle',
  other: 'Other',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Files attached to a claim: ACC approval letters received and the approval
// requests we sent. Bytes live in IndexedDB; only metadata is in `data`.
function ClaimDocuments({ claimId }: { claimId: string }) {
  const data = useStore((s) => s.data);
  const addDocument = useStore((s) => s.addDocument);
  const updateDocument = useStore((s) => s.updateDocument);
  const removeDocument = useStore((s) => s.removeDocument);
  const getDocumentBlob = useStore((s) => s.getDocumentBlob);
  const reparseDocument = useStore((s) => s.reparseDocument);
  const undoHrqAcceptFromDocument = useStore((s) => s.undoHrqAcceptFromDocument);
  const showTopBarFlash = useStore((s) => s.showTopBarFlash);
  const iDriveRootPath = useStore((s) => s.data.settings.iDriveRootPath);
  const iDriveStagingSubfolder = useStore((s) => s.data.settings.iDriveStagingSubfolder);
  const [confirm, confirmDialog] = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('acc-approval-letter');
  const [busy, setBusy] = useState(false);
  const [stageBusyId, setStageBusyId] = useState<string | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  const docs = data.documents.filter((d) => d.claimId === claimId);
  const claim = data.claims.find((c) => c.id === claimId);
  const patientName =
    data.patients.find((p) => p.id === claim?.patientId)?.name?.trim() || 'Unknown';

  async function handleFiles(files: FileList) {
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        const resolvedKind = await inferDocumentKindForPdf(file, kind);
        await addDocument(
          {
            claimId,
            kind: resolvedKind,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          },
          file,
        );
      }
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function openDoc(doc: ClaimDocument) {
    const blob = await getDocumentBlob(doc.id);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    // Release the object URL after the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function download(doc: ClaimDocument) {
    const blob = await getDocumentBlob(doc.id);
    if (!blob) return;
    downloadBlob(doc.fileName, blob);
  }

  async function del(doc: ClaimDocument) {
    const ok = await confirm({
      title: 'Delete document?',
      message: `Delete "${doc.fileName}"? This permanently removes the stored file.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) await removeDocument(doc.id);
  }

  async function stageToIDrive(doc: ClaimDocument) {
    setStageError(null);
    setStageBusyId(doc.id);
    try {
      const blob = await getDocumentBlob(doc.id);
      if (!blob) {
        setStageError('The original file is missing from local storage — cannot stage to I-drive.');
        return;
      }
      const live = buildAdminIDriveRelativePath({
        patientName,
        claimNumber: claim?.claimNumber || undefined,
        letterDate: doc.addedDate?.slice(0, 10),
        sourceFileName: doc.fileName,
        documentKind: doc.kind,
      });
      const stagingRel = buildStagingRelativePath(
        live.relativePath,
        iDriveStagingSubfolder || '_Staging',
      );
      const buf = await blob.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const filed = await postFileToIDrive({
        relativePath: stagingRel,
        fileBase64: btoa(binary),
        rootPath: iDriveRootPath,
      });
      if (!filed.ok) {
        setStageError(
          bridgeIDriveWriteFailedMessage({
            isDev: import.meta.env.DEV,
            error: filed.error,
          }),
        );
        return;
      }
      updateDocument(doc.id, {
        lastIDriveFiling: {
          relativePath: stagingRel,
          filedAt: todayISO(),
        },
      });
      showTopBarFlash(`Staged to I-drive: ${stagingRel}`);
    } catch (err) {
      setStageError((err as Error).message || 'Stage to I-drive failed');
    } finally {
      setStageBusyId(null);
    }
  }

  async function undoAccept(doc: ClaimDocument) {
    const ok = await confirm({
      title: 'Undo this accept?',
      message: (
        <div className="space-y-2 text-sm">
          <p>
            Removes this document and any approvals/decline created from it, and puts the letter
            back in the Review Queue when the soft-deleted staging row is still available.
          </p>
          {doc.lastIDriveFiling ? (
            <p>
              This document was also staged on I-drive under{' '}
              <span className="font-mono text-xs">{doc.lastIDriveFiling.relativePath}</span>. The suite
              cannot delete that file — remove it in Explorer if you no longer need it.
            </p>
          ) : null}
          <p>Outlook mail is never moved or reopened by undo.</p>
        </div>
      ),
      confirmLabel: 'Undo accept',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const undo = await undoHrqAcceptFromDocument(doc.id);
      showTopBarFlash(
        undo.restoredStaging
          ? 'Accept undone — letter is back in the review queue.'
          : 'Accept undone — created records removed (queue item was already gone).',
      );
    } catch (err) {
      await confirm({
        title: 'Undo failed',
        message: String(err instanceof Error ? err.message : err),
        confirmLabel: 'OK',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          Documents
        </h4>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as DocumentKind)}
            className="text-xs py-1"
            aria-label="Document type"
          >
            {(Object.keys(DOCUMENT_KIND_LABELS) as DocumentKind[]).map((k) => (
              <option key={k} value={k}>
                {DOCUMENT_KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <LetterImportButton
            disabled={busy}
            opts={{ context: { patientId: claim?.patientId, claimId }, entryPoint: 'claim-documents' }}
          />
          <button
            className="btn btn-sm"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            <IconPlus width={14} height={14} /> {busy ? 'Adding…' : 'Add file'}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
            }}
          />
        </div>
      </div>
      <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
        Approval or decline letter — parser auto-detects type, files records, and keeps the PDF on this claim.
      </p>
      {stageError && (
        <p className="text-xs mb-2" style={{ color: 'var(--danger-fg)' }}>
          {stageError}
        </p>
      )}
      {docs.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No documents. Attach the ACC approval letter or the approval request you sent.
        </p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg p-2.5 flex items-start justify-between gap-3"
              style={{ background: 'var(--surface-2)' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    tone={
                      doc.kind === 'acc-approval-letter'
                        ? 'good'
                        : doc.kind === 'acc-decline-letter'
                          ? 'danger'
                          : doc.kind === 'approval-request'
                            ? 'accent'
                            : 'neutral'
                    }
                  >
                    {DOCUMENT_KIND_LABELS[doc.kind]}
                  </Badge>
                  {doc.fromReviewAccept && <Badge tone="accent">From Review Queue</Badge>}
                  <span className="text-sm truncate">{doc.fileName}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {formatBytes(doc.sizeBytes)} · added {formatDate(doc.addedDate.slice(0, 10))}
                  {doc.lastIDriveFiling ? (
                    <>
                      {' · '}
                      I-drive: <span className="font-mono break-all">{doc.lastIDriveFiling.relativePath}</span>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap">
                {needsInitialAdminIDriveStaging(doc) && (
                  <HelperTip tipId="tip-stage-later">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy || stageBusyId === doc.id}
                      title="Writes under _Staging only; does not overwrite live I-drive folders"
                      onClick={() => void stageToIDrive(doc)}
                    >
                      {stageBusyId === doc.id ? 'Staging…' : 'Stage to I-drive'}
                    </button>
                  </HelperTip>
                )}
                {doc.fromReviewAccept && doc.stagingItemId && (
                  <HelperTip tipId="tip-undo-accept">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busy}
                      onClick={() => void undoAccept(doc)}
                      title="Undo this accept"
                    >
                      Undo this accept
                    </button>
                  </HelperTip>
                )}
                {(doc.kind === 'acc-approval-letter' || doc.kind === 'acc-decline-letter') && (
                  <button className="btn btn-sm" onClick={() => void reparseDocument(doc.id)}>
                    Re-extract
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => void openDoc(doc)}>
                  Open
                </button>
                <button className="btn btn-sm" onClick={() => void download(doc)}>
                  Download
                </button>
                <button
                  className="btn btn-icon btn-icon-danger"
                  onClick={() => void del(doc)}
                  aria-label="Delete document"
                >
                  <IconTrash width={14} height={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function blankLine(claimId: string, day1: string): Omit<ServiceLine, 'id'> {
  return {
    claimId,
    serviceCode: 'NS01',
    day1Date: day1 || todayISO(),
    lastConsultDate: undefined,
    consultCount: 0,
    interruptions: [],
    recommendedPackage: undefined,
    overridePackage: undefined,
    overrideReason: undefined,
    approvalId: undefined,
  };
}

interface NewApprovalForm {
  poNumber: string;
  approvalStartDate: string;
  approvalEndDate: string;
  approvedHoursOrConsults: number;
}

function blankNewApproval(poNumber = ''): NewApprovalForm {
  return { poNumber, approvalStartDate: '', approvalEndDate: '', approvedHoursOrConsults: 0 };
}
