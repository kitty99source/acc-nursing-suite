import { useState } from 'react';
import { useStore } from '../state/store';
import { DataTable, customColumns, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import {
  SectionTitle,
  Badge,
  Field,
  DateInput,
  Select,
  TextInput,
  TextArea,
  EmptyState,
} from '../components/ui';
import { IconPlus, IconEdit, IconTrash, IconDecline } from '../components/icons';
import { formatDate, daysBetween, todayISO } from '../lib/format';
import type { Decline, DeclineStatus } from '../types';

const STATUSES: DeclineStatus[] = [
  'Awaiting nursing docs for resubmission',
  'Awaiting response from ACC',
  'Accepted',
  'Declined again',
];

function emptyDecline(): Omit<Decline, 'id'> {
  return {
    patientName: '',
    claimNumber: '',
    declineReceivedDate: todayISO(),
    servicePeriodDeclined: '',
    reason: '',
    dateNurseEmailed: undefined,
    dateResubmissionRequested: undefined,
    outcome: undefined,
    dateOutcomeReceived: undefined,
    status: 'Awaiting nursing docs for resubmission',
    notes: '',
  };
}

function isOpen(d: Decline): boolean {
  return d.status === 'Awaiting nursing docs for resubmission' || d.status === 'Awaiting response from ACC';
}

function statusTone(s: DeclineStatus): 'good' | 'danger' | 'warn' | 'salmon' {
  if (s === 'Accepted') return 'good';
  if (s === 'Declined again') return 'danger';
  if (s === 'Awaiting response from ACC') return 'warn';
  return 'salmon';
}

export function Declines() {
  const data = useStore((s) => s.data);
  const addDecline = useStore((s) => s.addDecline);
  const updateDecline = useStore((s) => s.updateDecline);
  const removeDecline = useStore((s) => s.removeDecline);
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Decline | null>(null);
  const [form, setForm] = useState<Omit<Decline, 'id'>>(emptyDecline());

  function openCreate() {
    setForm(emptyDecline());
    setCreating(true);
  }
  function openEdit(d: Decline) {
    setForm({ ...d });
    setEditing(d);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }
  function save() {
    if (creating) addDecline(form);
    else if (editing) updateDecline(editing.id, form);
    close();
  }
  async function del(d: Decline) {
    const ok = await confirm({
      title: 'Delete decline?',
      message: `Delete the decline record for ${d.patientName || 'this patient'}?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeDecline(d.id);
  }

  const columns: Column<Decline>[] = [
    { key: 'patient', header: 'Patient', sortable: true, sortValue: (r) => r.patientName, render: (r) => <span className="font-medium">{r.patientName || '—'}</span> },
    { key: 'claim', header: 'Claim', sortable: true, sortValue: (r) => r.claimNumber, render: (r) => r.claimNumber || '—' },
    { key: 'received', header: 'Received', sortable: true, sortValue: (r) => r.declineReceivedDate, render: (r) => formatDate(r.declineReceivedDate) },
    { key: 'period', header: 'Service/Period', render: (r) => <span className="block max-w-[12rem] whitespace-pre-wrap">{r.servicePeriodDeclined}</span> },
    { key: 'reason', header: 'Reason', render: (r) => <span className="block max-w-xs whitespace-pre-wrap">{r.reason}</span> },
    { key: 'nurse', header: 'Nurse emailed', render: (r) => formatDate(r.dateNurseEmailed) || '—' },
    { key: 'resub', header: 'Resubmitted', render: (r) => formatDate(r.dateResubmissionRequested) || '—' },
    {
      key: 'age',
      header: 'Age (days)',
      align: 'right',
      sortable: true,
      sortValue: (r) => daysBetween(r.declineReceivedDate, todayISO()),
      render: (r) => (isOpen(r) ? daysBetween(r.declineReceivedDate, todayISO()) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button className="btn btn-ghost p-1.5" onClick={() => openEdit(r)} aria-label="Edit">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-ghost p-1.5" onClick={() => void del(r)} aria-label="Delete">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      ),
    },
  ];

  // Append any imported custom columns just before the actions column.
  const extraColumns = customColumns(data.declines, (r) => r.customFields);
  if (extraColumns.length) columns.splice(columns.length - 1, 0, ...extraColumns);

  return (
    <div>
      <SectionTitle
        title="Decline Tracker"
        subtitle="Decline received → nurse emailed → resubmission → outcome."
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            <IconPlus /> New decline
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={data.declines}
        rowKey={(r) => r.id}
        rowClassName={(r) => (isOpen(r) ? 'row-salmon' : '')}
        initialSort={{ key: 'received', dir: 'desc' }}
        emptyState={
          <EmptyState
            icon={<IconDecline width={32} height={32} />}
            title="No declines tracked"
            message="Log declines as they arrive and track them through resubmission to outcome."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                <IconPlus /> New decline
              </button>
            }
          />
        }
      />

      <Modal
        open={creating || !!editing}
        title={creating ? 'New decline' : 'Edit decline'}
        onClose={close}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={close}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={save} disabled={!form.patientName}>
              Save
            </button>
          </>
        }
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Patient name" required>
            <TextInput value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} />
          </Field>
          <Field label="Claim number">
            <TextInput value={form.claimNumber} onChange={(e) => setForm({ ...form, claimNumber: e.target.value })} />
          </Field>
          <Field label="Decline received date">
            <DateInput value={form.declineReceivedDate} onChange={(e) => setForm({ ...form, declineReceivedDate: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as DeclineStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Service / period declined">
            <TextInput value={form.servicePeriodDeclined} onChange={(e) => setForm({ ...form, servicePeriodDeclined: e.target.value })} />
          </Field>
          <Field label="Date nurse emailed">
            <DateInput value={form.dateNurseEmailed ?? ''} onChange={(e) => setForm({ ...form, dateNurseEmailed: e.target.value || undefined })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason for decline">
              <TextArea rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
          </div>
          <Field label="Date resubmission requested">
            <DateInput value={form.dateResubmissionRequested ?? ''} onChange={(e) => setForm({ ...form, dateResubmissionRequested: e.target.value || undefined })} />
          </Field>
          <Field label="Date outcome received">
            <DateInput value={form.dateOutcomeReceived ?? ''} onChange={(e) => setForm({ ...form, dateOutcomeReceived: e.target.value || undefined })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Outcome">
              <TextInput value={form.outcome ?? ''} onChange={(e) => setForm({ ...form, outcome: e.target.value || undefined })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Notes">
              <TextArea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>

      {confirmDialog}
    </div>
  );
}
