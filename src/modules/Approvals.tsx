import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DataTable, customColumns, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import {
  SectionTitle,
  Badge,
  Field,
  DateInput,
  NumberInput,
  Select,
  TextInput,
  TextArea,
  EmptyState,
} from '../components/ui';
import { IconPlus, IconEdit, IconTrash, IconApprovals } from '../components/icons';
import { LetterImportButton } from '../components/LetterImportButton';
import { HelperTip } from '../components/HelperTip';
import { computeApproval } from '../lib/analytics';
import { findDuplicateApprovalsByPO } from '../lib/approvals';
import { appendAudit } from '../lib/auditLog';
import { formatDate, daysUntil } from '../lib/format';
import type { Approval, ApprovalServiceCode } from '../types';

const EMPTY: Omit<Approval, 'id'> = {
  patientId: '',
  claimId: '',
  serviceCode: 'NS04',
  approvalStartDate: '',
  approvalEndDate: '',
  approvedHoursOrConsults: 0,
  consultsUsed: undefined,
  accEmailedRenewalDate: undefined,
  poNumber: '',
  renewalAssignee: undefined,
  notes: '',
};

export function Approvals() {
  const data = useStore((s) => s.data);
  const addApproval = useStore((s) => s.addApproval);
  const updateApproval = useStore((s) => s.updateApproval);
  const removeApproval = useStore((s) => s.removeApproval);
  const getDocumentBlob = useStore((s) => s.getDocumentBlob);
  const [confirm, confirmDialog] = useConfirm();
  const letterContext = useRef<{ claimId?: string; patientId?: string }>({});

  const [editing, setEditing] = useState<Approval | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Omit<Approval, 'id'>>(EMPTY);
  const [statusFilter, setStatusFilter] = useState<'all' | 'attention'>('all');
  const [codeFilter, setCodeFilter] = useState<'all' | 'NS04' | 'NS05'>('all');
  const [showHistorical, setShowHistorical] = useState(false);
  const [autoAcceptedFilter, setAutoAcceptedFilter] = useState<'all' | 'auto'>('all');

  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);

  // Consume a cross-module fix intent: open the New-approval modal pre-filled
  // with the patient, claim, service code and PO carried over from the flag.
  useEffect(() => {
    if (!focus || focus.module !== 'approvals') return;
    const claim = focus.claimId ? data.claims.find((c) => c.id === focus.claimId) : undefined;

    if (focus.intent === 'review-ns05' && focus.claimId) {
      const existing = data.approvals.find(
        (a) => a.claimId === focus.claimId && a.serviceCode === 'NS05' && a.recordStatus !== 'historical',
      );
      if (existing) {
        setForm({ ...existing });
        setEditing(existing);
        setCreating(false);
        clearFocus();
        return;
      }
    }

    const prefill = focus.prefill ?? {};
    const serviceCode = prefill.serviceCode === 'NS05' ? 'NS05' : 'NS04';
    setForm({
      ...EMPTY,
      patientId: focus.patientId || claim?.patientId || data.patients[0]?.id || '',
      claimId: focus.claimId ?? '',
      serviceCode: serviceCode as ApprovalServiceCode,
      poNumber: (prefill.poNumber as string) || claim?.poNumber || '',
    });
    setEditing(null);
    setCreating(true);
    clearFocus();
  }, [focus, data.claims, data.patients, clearFocus]);

  const threshold = data.settings.expiryThresholdDays;

  const autoAcceptedCount = useMemo(
    () => data.approvals.filter((a) => a.autoAccepted).length,
    [data.approvals],
  );

  const rows = useMemo(() => {
    return data.approvals
      .map((a) => ({ approval: a, computed: computeApproval(a, threshold) }))
      .filter((r) => (showHistorical ? true : r.approval.recordStatus !== 'historical'))
      .filter((r) => (codeFilter === 'all' ? true : r.approval.serviceCode === codeFilter))
      .filter((r) => (statusFilter === 'all' ? true : r.computed.status !== 'Active'))
      .filter((r) => (autoAcceptedFilter === 'auto' ? Boolean(r.approval.autoAccepted) : true));
  }, [data.approvals, threshold, codeFilter, statusFilter, showHistorical, autoAcceptedFilter]);

  function openCreate() {
    setForm({ ...EMPTY, patientId: data.patients[0]?.id ?? '' });
    setCreating(true);
  }
  function openEdit(a: Approval) {
    setForm({ ...a });
    setEditing(a);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }

  function save() {
    if (creating) addApproval(form);
    else if (editing) updateApproval(editing.id, form);
    close();
  }

  async function del(a: Approval) {
    const patient = data.patients.find((p) => p.id === a.patientId);
    const ok = await confirm({
      title: 'Delete approval?',
      message: `Delete the ${a.serviceCode} approval for ${patient?.name ?? 'this patient'}? This cannot be undone.`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeApproval(a.id);
  }

  async function checkDuplicateApprovals() {
    const groups = findDuplicateApprovalsByPO(data.approvals, data.documents, data.patients);
    const redundantCount = groups.reduce((sum, g) => sum + g.redundant.length, 0);
    const ok = await confirm({
      title: 'Check for duplicate approvals',
      message:
        groups.length === 0 ? (
          <p style={{ color: 'var(--muted)' }}>
            No duplicates found. Every approval has a unique combination of patient, service code and
            PO number.
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              Found <strong>{redundantCount}</strong> redundant approval(s) across <strong>{groups.length}</strong>{' '}
              patient/PO group(s) — the same patient, service code and PO number filed more than once
              (e.g. the same ACC decision emailed twice, a year apart). The newest record in each group
              is kept; only the older duplicate(s) would be removed. Approvals with different PO numbers
              are never touched — those are legitimate, distinct renewals.
            </p>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {groups.map((g) => {
                const p = data.patients.find((x) => x.id === g.patientId);
                return (
                  <div key={g.key} className="rounded-card p-2" style={{ background: 'var(--surface-2)' }}>
                    <div className="font-medium">
                      {p?.name ?? g.patientId} — {g.serviceCode} — PO {g.poNumber || '—'}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      Keeping the record ending {formatDate(g.keep.approvalEndDate)}; removing{' '}
                      {g.redundant.length} older duplicate(s).
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ),
      confirmLabel: groups.length === 0 ? 'Close' : `Remove ${redundantCount} duplicate(s)`,
      destructive: groups.length > 0,
    });
    if (ok && groups.length > 0) {
      for (const g of groups) {
        for (const a of g.redundant) removeApproval(a.id);
      }
      await appendAudit({
        action: 'approval-dedupe',
        entityType: 'approval',
        summary: `Removed ${redundantCount} duplicate approval(s) across ${groups.length} patient/PO group(s)`,
      });
    }
  }

  async function viewLetter(approval: Approval) {
    if (!approval.sourceDocumentId) return;
    const blob = await getDocumentBlob(approval.sourceDocumentId);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  type Row = (typeof rows)[number];
  const claimsForPatient = data.claims.filter((c) => c.patientId === form.patientId);

  const columns: Column<Row>[] = [
    {
      key: 'patient',
      header: 'Patient',
      width: '16%',
      sortable: true,
      sortValue: (r) => data.patients.find((p) => p.id === r.approval.patientId)?.name ?? '',
      render: (r) => {
        const p = data.patients.find((x) => x.id === r.approval.patientId);
        return (
          <div className="min-w-0">
            <div className="font-medium truncate" title={p?.name}>
              {p?.name ?? '—'}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--muted)' }}>
              {p?.nhi}
            </div>
          </div>
        );
      },
    },
    {
      key: 'code',
      header: 'Code',
      width: '9%',
      sortable: true,
      sortValue: (r) => r.approval.serviceCode,
      render: (r) => (
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          <Badge tone="accent">{r.approval.serviceCode}</Badge>
          {r.approval.autoAccepted && (
            <Badge tone="neutral">
              <span title="Filed by Auto-accept ready — created without individual human review.">
                Auto
              </span>
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'po',
      header: 'PO',
      width: '10%',
      sortable: true,
      sortValue: (r) => r.approval.poNumber,
      render: (r) => (
        <span className="truncate block" title={r.approval.poNumber}>
          {r.approval.poNumber || '—'}
        </span>
      ),
    },
    {
      key: 'start',
      header: 'Start',
      width: '9%',
      sortable: true,
      sortValue: (r) => r.approval.approvalStartDate,
      render: (r) => formatDate(r.approval.approvalStartDate),
    },
    {
      key: 'end',
      header: 'End',
      width: '9%',
      sortable: true,
      sortValue: (r) => r.approval.approvalEndDate,
      render: (r) => formatDate(r.approval.approvalEndDate),
    },
    {
      key: 'qty',
      header: 'Approved',
      width: '10%',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.approval.approvedHoursOrConsults,
      render: (r) => (
        <span className="truncate block" title={`${r.approval.approvedHoursOrConsults}${r.approval.serviceCode === 'NS05' ? ' hrs' : ' consults'}`}>
          {r.approval.approvedHoursOrConsults}
          {r.approval.serviceCode === 'NS05' ? 'h' : 'c'}
          {r.approval.consultsUsed != null && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {' '}
              ({r.approval.consultsUsed})
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Days',
      width: '7%',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.computed.daysUntilExpiry,
      render: (r) => r.computed.daysUntilExpiry,
    },
    {
      key: 'status',
      header: 'Status',
      width: '10%',
      sortable: true,
      sortValue: (r) => r.computed.status,
      render: (r) => {
        if (r.approval.recordStatus === 'historical') return <Badge tone="neutral">Historical</Badge>;
        if (r.computed.status === 'EXPIRED') return <Badge tone="danger">EXPIRED</Badge>;
        if (r.computed.status === 'Expiring Soon (<30 days)')
          return <Badge tone="salmon">Expiring</Badge>;
        return <Badge tone="good">Active</Badge>;
      },
    },
    {
      key: 'renewal',
      header: 'Renewed',
      width: '9%',
      render: (r) => (
        <span className="truncate block" title={formatDate(r.approval.accEmailedRenewalDate) || undefined}>
          {formatDate(r.approval.accEmailedRenewalDate) || '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: 148,
      sticky: 'right',
      render: (r) => (
        <div className="flex items-center gap-1 justify-end shrink-0">
          {r.approval.sourceDocumentId && (
            <button
              className="btn btn-sm"
              onClick={() => void viewLetter(r.approval)}
              title="View letter"
            >
              Letter
            </button>
          )}
          <button className="btn btn-icon" onClick={() => openEdit(r.approval)} aria-label="Edit">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-icon btn-icon-danger" onClick={() => void del(r.approval)} aria-label="Delete">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      ),
    },
  ];

  // Append any imported custom columns just before the actions column.
  const extraColumns = customColumns<Row>(rows, (r) => r.approval.customFields);
  if (extraColumns.length) columns.splice(columns.length - 1, 0, ...extraColumns);

  return (
    <div>
      <SectionTitle
        title="Approvals (NS04 / NS05)"
        subtitle="Track approval periods and PO expiry. Import approval PDFs here to file NS04/NS05 and attach the letter."
        actions={
          <div className="flex items-center gap-2">
            <HelperTip tipId="tip-approvals">
              <LetterImportButton opts={{ context: letterContext.current, entryPoint: 'approvals' }} />
            </HelperTip>
            <button
              className="btn btn-sm"
              onClick={() => void checkDuplicateApprovals()}
              title="Find approvals for the same patient, service code and PO number filed more than once (e.g. from a different email/year), and remove the older duplicate(s) after review."
            >
              Check for duplicate approvals
            </button>
            <button className="btn btn-primary" onClick={openCreate} disabled={data.patients.length === 0}>
              <IconPlus /> New approval
            </button>
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value as typeof codeFilter)} className="w-auto">
          <option value="all">All codes</option>
          <option value="NS04">NS04 only</option>
          <option value="NS05">NS05 only</option>
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="w-auto"
        >
          <option value="all">All statuses</option>
          <option value="attention">Needs attention (expiring/expired)</option>
        </Select>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={showHistorical}
            onChange={(e) => setShowHistorical(e.target.checked)}
          />
          Show historical records
        </label>
        {autoAcceptedCount > 0 && (
          <Select
            value={autoAcceptedFilter}
            onChange={(e) => setAutoAcceptedFilter(e.target.value as typeof autoAcceptedFilter)}
            className="w-auto"
            aria-label="Filter by auto-accepted"
            title="Auto-accepted approvals were filed by the Review Queue's Auto-accept ready action, without individual human review — review them here as a batch."
          >
            <option value="all">All approvals</option>
            <option value="auto">Auto-accepted only ({autoAcceptedCount})</option>
          </Select>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.approval.id}
        rowClassName={(r) => (r.computed.status !== 'Active' ? 'row-salmon' : '')}
        initialSort={{ key: 'days', dir: 'asc' }}
        tableLayout="fixed"
        emptyState={
          <EmptyState
            icon={<IconApprovals width={32} height={32} />}
            title="No approvals tracked"
            message={
              data.patients.length === 0
                ? 'Add a patient and claim first, then record their NS04/NS05 approvals here.'
                : 'Add an NS04 or NS05 approval to start tracking expiry dates.'
            }
            action={
              data.patients.length > 0 ? (
                <button className="btn btn-primary" onClick={openCreate}>
                  <IconPlus /> New approval
                </button>
              ) : undefined
            }
          />
        }
      />

      <Modal
        open={creating || !!editing}
        title={creating ? 'New approval' : 'Edit approval'}
        onClose={close}
        footer={
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={!form.patientId || !form.approvalEndDate}
            >
              Save
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Patient" required>
            <Select
              value={form.patientId}
              onChange={(e) => setForm({ ...form, patientId: e.target.value, claimId: '' })}
            >
              <option value="">Select patient…</option>
              {data.patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.nhi})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Claim">
            <Select
              value={form.claimId}
              onChange={(e) => {
                const claim = data.claims.find((c) => c.id === e.target.value);
                // Carry the claim's PO number across so it doesn't have to be
                // re-typed; keep any existing value if the claim has none.
                setForm({ ...form, claimId: e.target.value, poNumber: claim?.poNumber || form.poNumber });
              }}
            >
              <option value="">Select claim…</option>
              {claimsForPatient.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.claimNumber} — {c.injuryDescription}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service code" required>
            <Select
              value={form.serviceCode}
              onChange={(e) => setForm({ ...form, serviceCode: e.target.value as ApprovalServiceCode })}
            >
              <option value="NS04">NS04 — Extended Nursing</option>
              <option value="NS05">NS05 — Ongoing Nursing</option>
            </Select>
          </Field>
          <Field label="PO Number">
            <TextInput value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
          </Field>
          <Field label="Approval start date">
            <DateInput
              value={form.approvalStartDate}
              onChange={(e) => setForm({ ...form, approvalStartDate: e.target.value })}
            />
          </Field>
          <Field label="Approval end date / PO expiry" required>
            <DateInput
              value={form.approvalEndDate}
              onChange={(e) => setForm({ ...form, approvalEndDate: e.target.value })}
            />
          </Field>
          <Field label={form.serviceCode === 'NS05' ? 'Approved hours' : 'Approved consults'}>
            <NumberInput
              min={0}
              value={form.approvedHoursOrConsults}
              onChange={(e) => setForm({ ...form, approvedHoursOrConsults: Number(e.target.value) })}
            />
          </Field>
          <Field label={form.serviceCode === 'NS05' ? 'Hours used' : 'Consults used'}>
            <NumberInput
              min={0}
              value={form.consultsUsed ?? ''}
              onChange={(e) =>
                setForm({ ...form, consultsUsed: e.target.value === '' ? undefined : Number(e.target.value) })
              }
            />
          </Field>
          <Field label="ACC emailed renewal date">
            <DateInput
              value={form.accEmailedRenewalDate ?? ''}
              onChange={(e) =>
                setForm({ ...form, accEmailedRenewalDate: e.target.value || undefined })
              }
            />
          </Field>
          <Field label="Renewal assignee" hint="Local note — who is following up on renewal.">
            <TextInput
              value={form.renewalAssignee ?? ''}
              onChange={(e) => setForm({ ...form, renewalAssignee: e.target.value || undefined })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
        {form.approvalEndDate && (
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            {daysUntil(form.approvalEndDate) < 0
              ? `Expired ${Math.abs(daysUntil(form.approvalEndDate))} day(s) ago.`
              : `${daysUntil(form.approvalEndDate)} day(s) until expiry.`}
          </p>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
