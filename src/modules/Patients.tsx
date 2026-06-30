import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
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
import { determinePackage } from '../lib/calculator';
import { computeApproval } from '../lib/analytics';
import { ALL_SERVICE_CODES, formatCurrency, serviceCodeLabel } from '../lib/serviceCodes';
import { formatDate, todayISO } from '../lib/format';
import type { Claim, ClaimType, Patient, ServiceLine, ServiceCode } from '../types';

export function Patients() {
  const data = useStore((s) => s.data);
  const addPatient = useStore((s) => s.addPatient);
  const updatePatient = useStore((s) => s.updatePatient);
  const removePatient = useStore((s) => s.removePatient);
  const [confirm, confirmDialog] = useConfirm();

  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(data.patients[0]?.id ?? null);

  // patient modal
  const [patientModal, setPatientModal] = useState<{ mode: 'create' | 'edit'; patient?: Patient } | null>(null);
  const [patientForm, setPatientForm] = useState<Omit<Patient, 'id'>>({ name: '', nhi: '', dob: '', notes: '' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data.patients;
    return data.patients.filter((p) =>
      `${p.name} ${p.nhi}`.toLowerCase().includes(q),
    );
  }, [data.patients, search]);

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
          <button className="btn btn-primary" onClick={openCreatePatient}>
            <IconPlus /> New patient
          </button>
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
        <div className="grid lg:grid-cols-[20rem_1fr] gap-4">
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
            <div className="space-y-1 max-h-[60vh] overflow-y-auto">
              {filtered.map((p) => {
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
            <button className="btn btn-ghost p-1.5" onClick={onEdit} aria-label="Edit patient">
              <IconEdit width={16} height={16} />
            </button>
            <button className="btn btn-ghost p-1.5" onClick={onDelete} aria-label="Delete patient">
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
        <EmptyState title="No claims for this patient" message="Add a claim to record service lines and approvals." />
      ) : (
        claims.map((claim) => (
          <ClaimCard
            key={claim.id}
            claim={claim}
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

function ClaimCard({
  claim,
  onEdit,
  onDelete,
  onAddSubsequent,
}: {
  claim: Claim;
  onEdit: () => void;
  onDelete: () => void;
  onAddSubsequent: () => void;
}) {
  const data = useStore((s) => s.data);
  const addServiceLine = useStore((s) => s.addServiceLine);
  const updateServiceLine = useStore((s) => s.updateServiceLine);
  const removeServiceLine = useStore((s) => s.removeServiceLine);
  const [confirm, confirmDialog] = useConfirm();

  const lines = data.serviceLines.filter((s) => s.claimId === claim.id);
  const approvals = data.approvals.filter((a) => a.claimId === claim.id);

  const [lineModal, setLineModal] = useState<{ mode: 'create' | 'edit'; line?: ServiceLine } | null>(null);
  const [lineForm, setLineForm] = useState<Omit<ServiceLine, 'id'>>(blankLine(claim.id, claim.day1Date));
  const [showCalc, setShowCalc] = useState(false);

  function openCreateLine() {
    setLineForm(blankLine(claim.id, claim.day1Date));
    setShowCalc(false);
    setLineModal({ mode: 'create' });
  }
  function openEditLine(line: ServiceLine) {
    setLineForm({ ...line });
    setShowCalc(false);
    setLineModal({ mode: 'edit', line });
  }
  function saveLine() {
    const det = determinePackage({
      day1: lineForm.day1Date,
      lastConsult: lineForm.lastConsultDate || undefined,
      consultCount: lineForm.consultCount,
      interruptions: lineForm.interruptions,
    });
    const recommended = det.recommendedCodes.join(' + ');
    const payload = { ...lineForm, recommendedPackage: recommended };
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

  const liveDet = lineModal
    ? determinePackage({
        day1: lineForm.day1Date,
        lastConsult: lineForm.lastConsultDate || undefined,
        consultCount: lineForm.consultCount,
        interruptions: lineForm.interruptions,
      })
    : null;

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
          </div>
          <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Day 1 {formatDate(claim.day1Date)} · ACC45 {claim.acc45Number || '—'} · PO {claim.poNumber || '—'}
          </div>
          {claim.injuryDescription && <p className="text-sm mt-1">{claim.injuryDescription}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button className="btn btn-ghost p-1.5" onClick={onEdit} aria-label="Edit claim">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-ghost p-1.5" onClick={onDelete} aria-label="Delete claim">
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
          <button className="btn btn-ghost text-xs py-1 px-2" onClick={openCreateLine}>
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
              const det = determinePackage({
                day1: line.day1Date,
                lastConsult: line.lastConsultDate || undefined,
                consultCount: line.consultCount,
                interruptions: line.interruptions,
              });
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
                        {line.consultCount} consult{line.consultCount === 1 ? '' : 's'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        Day 1 {formatDate(line.day1Date)}
                        {line.lastConsultDate ? ` → ${formatDate(line.lastConsultDate)}` : ' · ongoing'}
                      </span>
                    </div>
                    <div className="text-xs mt-1">
                      <span style={{ color: 'var(--muted)' }}>Recommended: </span>
                      <span className="font-medium" style={{ color: 'var(--accent)' }}>
                        {line.overridePackage ? `${line.overridePackage} (override)` : det.recommendedCodes.join(' + ')}
                      </span>{' '}
                      · {formatCurrency(det.totalValue)}
                    </div>
                    {line.overrideReason && (
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                        Override: {line.overrideReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button className="btn btn-ghost p-1.5" onClick={() => openEditLine(line)} aria-label="Edit line">
                      <IconEdit width={14} height={14} />
                    </button>
                    <button className="btn btn-ghost p-1.5" onClick={() => void deleteLine(line)} aria-label="Delete line">
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
      {approvals.length > 0 && (
        <div className="mt-3">
          <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--muted)' }}>
            Approvals
          </h4>
          <div className="space-y-1">
            {approvals.map((a) => {
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
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {claim.type === 'original' && (
          <button className="btn btn-ghost text-xs py-1 px-2" onClick={onAddSubsequent}>
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
            <button className="btn btn-primary" onClick={saveLine}>
              Save
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Service code">
            <Select value={lineForm.serviceCode} onChange={(e) => setLineForm({ ...lineForm, serviceCode: e.target.value as ServiceCode })}>
              {ALL_SERVICE_CODES.map((c) => (
                <option key={c} value={c}>
                  {serviceCodeLabel(c)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Day 1 date">
            <DateInput value={lineForm.day1Date} onChange={(e) => setLineForm({ ...lineForm, day1Date: e.target.value })} />
          </Field>
          <Field label="Last consult date (blank = ongoing)">
            <DateInput value={lineForm.lastConsultDate ?? ''} onChange={(e) => setLineForm({ ...lineForm, lastConsultDate: e.target.value || undefined })} />
          </Field>
          <Field label="Consult count">
            <NumberInput min={0} value={lineForm.consultCount} onChange={(e) => setLineForm({ ...lineForm, consultCount: Math.max(0, Number(e.target.value)) })} />
          </Field>
          <Field label="Override package (optional)">
            <Select value={lineForm.overridePackage ?? ''} onChange={(e) => setLineForm({ ...lineForm, overridePackage: (e.target.value || undefined) as ServiceCode | undefined })}>
              <option value="">No override</option>
              {ALL_SERVICE_CODES.map((c) => (
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

        {liveDet && (
          <div className="mt-3 rounded-lg p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-semibold">Recommendation:</span>
              {liveDet.recommendedCodes.map((c) => (
                <Badge key={c} tone="accent">
                  {c}
                </Badge>
              ))}
              <span className="font-semibold">{formatCurrency(liveDet.totalValue)}</span>
            </div>
            <div style={{ color: 'var(--muted)' }}>{liveDet.reason}</div>
          </div>
        )}

        <button className="btn btn-ghost text-xs mt-3" onClick={() => setShowCalc((v) => !v)}>
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
  };
}
