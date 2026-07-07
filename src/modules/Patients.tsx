import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { inferDocumentKindForPdf } from '../lib/letterImport';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
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
import { downloadBlob } from '../lib/storage';
import {
  LetterImportButton,
  LETTER_IMPORT_FULL_TOOLTIP,
  PREFILL_FROM_LETTER_LABEL,
} from '../components/LetterImportButton';
import type {
  ApprovalServiceCode,
  Claim,
  ClaimType,
  ClaimDocument,
  DocumentKind,
  Patient,
  ServiceLine,
  ServiceCode,
} from '../types';

const PATIENTS_PAGE_SIZE = 25;

export function Patients() {
  const data = useStore((s) => s.data);
  const addPatient = useStore((s) => s.addPatient);
  const updatePatient = useStore((s) => s.updatePatient);
  const removePatient = useStore((s) => s.removePatient);
  const [confirm, confirmDialog] = useConfirm();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(data.patients[0]?.id ?? null);

  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);

  // A "patients" fix intent selects the relevant patient. If it also carries a
  // deep intent (a specific service line), the matching ClaimCard consumes and
  // clears it; otherwise we clear it here once the patient is shown.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.patients;
    return data.patients.filter((p) =>
      `${p.name} ${p.nhi}`.toLowerCase().includes(q),
    );
  }, [data.patients, search]);

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
  }, [search]);

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

  const selected = data.patients.find((p) => p.id === selectedId) ?? filtered[0] ?? null;

  function openCreatePatient() {
    setPatientForm({ name: '', nhi: '', dob: '', notes: '' });
    setPatientModal({ mode: 'create' });
  }
  function openEditPatient(p: Patient) {
    setPatientForm({ name: p.name, nhi: p.nhi, dob: p.dob, notes: p.notes });
    setPatientModal({ mode: 'edit', patient: p });
  }
  function savePatient() {
    if (patientModal?.mode === 'create') {
      const id = addPatient(patientForm);
      setSelectedId(id);
      const idx = useStore.getState().data.patients.findIndex((p) => p.id === id);
      if (idx >= 0) setPage(Math.floor(idx / PATIENTS_PAGE_SIZE) + 1);
    } else if (patientModal?.patient) {
      updatePatient(patientModal.patient.id, patientForm);
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

  return (
    <div>
      <SectionTitle
        title="Patients & Cases"
        subtitle="Search patients and manage their claims, service lines and approvals."
        actions={
          <div className="flex items-center gap-2">
            <LetterImportButton opts={{ entryPoint: 'patients' }} title={LETTER_IMPORT_FULL_TOOLTIP} />
            <button className="btn btn-primary" onClick={openCreatePatient}>
              <IconPlus /> New patient
            </button>
          </div>
        }
      />

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
        <div className="grid lg:grid-cols-[20rem_1fr] gap-4 max-lg:grid-cols-1">
          <div className="card p-3 h-fit">
            <div className="relative mb-3">
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
            {totalFiltered > 0 && (
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                Showing {pageStart}–{pageEnd} of {totalFiltered.toLocaleString()}
                {search.trim() ? ` (filtered from ${data.patients.length.toLocaleString()})` : ''}
              </p>
            )}
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {pagePatients.map((p) => {
                const claimCount = data.claims.filter((c) => c.patientId === p.id).length;
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
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Full name" required>
            <TextInput value={patientForm.name} onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })} />
          </Field>
          <Field label="NHI">
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{patient.name}</h2>
            <div className="text-sm" style={{ color: 'var(--muted)' }}>
              NHI {patient.nhi || '—'} · DOB {formatDate(patient.dob) || '—'}
            </div>
            {patient.notes && <p className="text-sm mt-2 whitespace-pre-wrap">{patient.notes}</p>}
          </div>
          <div className="flex items-center gap-1">
            <button className="btn btn-icon" onClick={onEdit} aria-label="Edit patient">
              <IconEdit width={16} height={16} />
            </button>
            <button className="btn btn-icon btn-icon-danger" onClick={onDelete} aria-label="Delete patient">
              <IconTrash width={16} height={16} />
            </button>
          </div>
        </div>
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
      <div className="flex items-start justify-between gap-3">
        <div>
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
  const removeDocument = useStore((s) => s.removeDocument);
  const getDocumentBlob = useStore((s) => s.getDocumentBlob);
  const reparseDocument = useStore((s) => s.reparseDocument);
  const [confirm, confirmDialog] = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<DocumentKind>('acc-approval-letter');
  const [busy, setBusy] = useState(false);

  const docs = data.documents.filter((d) => d.claimId === claimId);
  const claim = data.claims.find((c) => c.id === claimId);

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

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <h4 className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
          Documents
        </h4>
        <div className="flex items-center gap-2">
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
                  <span className="text-sm truncate">{doc.fileName}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {formatBytes(doc.sizeBytes)} · added {formatDate(doc.addedDate.slice(0, 10))}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap">
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
