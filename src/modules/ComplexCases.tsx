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
import { IconPlus, IconEdit, IconTrash, IconComplex } from '../components/icons';
import { formatDate, daysUntil, todayISO } from '../lib/format';
import type { ComplexCase, ComplexCaseStatus } from '../types';

const STATUSES: ComplexCaseStatus[] = ['Open', 'Monitoring', 'Resolved'];

function emptyCase(): Omit<ComplexCase, 'id'> {
  return {
    patientName: '',
    claimNumber: '',
    dateLogged: todayISO(),
    whatsUnusual: '',
    decisionMade: '',
    decidedBy: '',
    dateDecided: '',
    followUpNeeded: '',
    nextReviewDate: '',
    status: 'Open',
    notes: '',
  };
}

function reviewOverdue(c: ComplexCase): boolean {
  return c.status !== 'Resolved' && !!c.nextReviewDate && daysUntil(c.nextReviewDate) <= 0;
}

export function ComplexCases() {
  const data = useStore((s) => s.data);
  const addComplexCase = useStore((s) => s.addComplexCase);
  const updateComplexCase = useStore((s) => s.updateComplexCase);
  const removeComplexCase = useStore((s) => s.removeComplexCase);
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ComplexCase | null>(null);
  const [form, setForm] = useState<Omit<ComplexCase, 'id'>>(emptyCase());

  function openCreate() {
    setForm(emptyCase());
    setCreating(true);
  }
  function openEdit(c: ComplexCase) {
    setForm({ ...c });
    setEditing(c);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }
  function save() {
    if (creating) addComplexCase(form);
    else if (editing) updateComplexCase(editing.id, form);
    close();
  }
  async function del(c: ComplexCase) {
    const ok = await confirm({
      title: 'Delete complex case?',
      message: `Delete the complex case for ${c.patientName || 'this patient'}?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeComplexCase(c.id);
  }

  const columns: Column<ComplexCase>[] = [
    { key: 'patient', header: 'Patient', sortable: true, sortValue: (r) => r.patientName, render: (r) => <span className="font-medium">{r.patientName || '—'}</span> },
    { key: 'claim', header: 'Claim', sortable: true, sortValue: (r) => r.claimNumber, render: (r) => r.claimNumber || '—' },
    { key: 'logged', header: 'Logged', sortable: true, sortValue: (r) => r.dateLogged, render: (r) => formatDate(r.dateLogged) },
    {
      key: 'unusual',
      header: "What's unusual",
      render: (r) => <span className="block max-w-xs whitespace-pre-wrap">{r.whatsUnusual}</span>,
    },
    {
      key: 'decision',
      header: 'Decision',
      render: (r) => (
        <div className="max-w-xs">
          <div className="whitespace-pre-wrap">{r.decisionMade}</div>
          {r.decidedBy && (
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {r.decidedBy} {r.dateDecided && `· ${formatDate(r.dateDecided)}`}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'review',
      header: 'Next review',
      sortable: true,
      sortValue: (r) => r.nextReviewDate ?? '',
      render: (r) =>
        r.nextReviewDate ? (
          <span>
            {formatDate(r.nextReviewDate)}
            {reviewOverdue(r) && (
              <Badge tone="salmon">
                {daysUntil(r.nextReviewDate) === 0 ? 'Due today' : 'Overdue'}
              </Badge>
            )}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <Badge tone={r.status === 'Resolved' ? 'good' : r.status === 'Monitoring' ? 'warn' : 'neutral'}>
          {r.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center gap-1 justify-end">
          <button className="btn btn-icon" onClick={() => openEdit(r)} aria-label="Edit">
            <IconEdit width={15} height={15} />
          </button>
          <button className="btn btn-icon btn-icon-danger" onClick={() => void del(r)} aria-label="Delete">
            <IconTrash width={15} height={15} />
          </button>
        </div>
      ),
    },
  ];

  // Append any imported custom columns just before the actions column.
  const extraColumns = customColumns(data.complexCases, (r) => r.customFields);
  if (extraColumns.length) columns.splice(columns.length - 1, 0, ...extraColumns);

  return (
    <div>
      <SectionTitle
        title="Complex Cases"
        subtitle="Your 'don't make me re-research this' log. Rows highlight when a review date has passed."
        actions={
          <button className="btn btn-primary" onClick={openCreate}>
            <IconPlus /> New case
          </button>
        }
      />

      <DataTable
        columns={columns}
        rows={data.complexCases}
        rowKey={(r) => r.id}
        rowClassName={(r) => (reviewOverdue(r) ? 'row-salmon' : '')}
        initialSort={{ key: 'logged', dir: 'desc' }}
        emptyState={
          <EmptyState
            icon={<IconComplex width={32} height={32} />}
            title="No complex cases logged"
            message="Record unusual cases, the decision made and who made it, plus a review date so nothing slips."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                <IconPlus /> New case
              </button>
            }
          />
        }
      />

      <Modal
        open={creating || !!editing}
        title={creating ? 'New complex case' : 'Edit complex case'}
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
          <Field label="Date logged">
            <DateInput value={form.dateLogged} onChange={(e) => setForm({ ...form, dateLogged: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ComplexCaseStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="What's unusual">
              <TextArea rows={2} value={form.whatsUnusual} onChange={(e) => setForm({ ...form, whatsUnusual: e.target.value })} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Decision made">
              <TextArea rows={2} value={form.decisionMade} onChange={(e) => setForm({ ...form, decisionMade: e.target.value })} />
            </Field>
          </div>
          <Field label="Decided by">
            <TextInput value={form.decidedBy} onChange={(e) => setForm({ ...form, decidedBy: e.target.value })} />
          </Field>
          <Field label="Date decided">
            <DateInput value={form.dateDecided} onChange={(e) => setForm({ ...form, dateDecided: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Follow-up needed">
              <TextArea rows={2} value={form.followUpNeeded} onChange={(e) => setForm({ ...form, followUpNeeded: e.target.value })} />
            </Field>
          </div>
          <Field label="Next review date">
            <DateInput value={form.nextReviewDate} onChange={(e) => setForm({ ...form, nextReviewDate: e.target.value })} />
          </Field>
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
