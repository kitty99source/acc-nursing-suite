import { useEffect, useMemo, useState } from 'react';
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
import { IconPlus, IconEdit, IconTrash, IconBilling, IconSearch } from '../components/icons';
import { LetterImportButton } from '../components/LetterImportButton';
import { formatCurrency, visibleServiceCodes } from '../lib/serviceCodes';
import { formatDate } from '../lib/format';
import type { InvoiceLine, InvoiceStatus, ServiceCode } from '../types';

const STATUSES: InvoiceStatus[] = ['Awaiting Billing', 'Billed', 'Remittance'];

function emptyLine(): Omit<InvoiceLine, 'id'> {
  return {
    patientName: '',
    nhi: '',
    claimNumber: '',
    poNumber: '',
    acc45Number: '',
    serviceCode: 'NS01',
    invoiceSheet: '',
    invoiceDate: '',
    amountInvoiced: 0,
    datePaid: undefined,
    amountPaid: undefined,
    status: 'Awaiting Billing',
    notes: '',
  };
}

function rowClass(status: InvoiceStatus): string {
  if (status === 'Billed') return 'row-good';
  return 'row-salmon'; // Awaiting Billing & Remittance
}

export function Billing() {
  const data = useStore((s) => s.data);
  const addInvoiceLine = useStore((s) => s.addInvoiceLine);
  const updateInvoiceLine = useStore((s) => s.updateInvoiceLine);
  const removeInvoiceLine = useStore((s) => s.removeInvoiceLine);
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InvoiceLine | null>(null);
  const [form, setForm] = useState<Omit<InvoiceLine, 'id'>>(emptyLine());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [codeFilter, setCodeFilter] = useState<'all' | ServiceCode>('all');
  const [sheetFilter, setSheetFilter] = useState('');

  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);
  const generateInvoiceLinesForClaim = useStore((s) => s.generateInvoiceLinesForClaim);

  // Consume a billing fix intent: optionally auto-generate the invoice lines
  // for a ready claim, then filter the log down to that claim so the result is
  // immediately visible.
  useEffect(() => {
    if (!focus || focus.module !== 'billing') return;
    const claim = focus.claimId ? data.claims.find((c) => c.id === focus.claimId) : undefined;
    if (focus.intent === 'generate-invoices' && focus.claimId) {
      generateInvoiceLinesForClaim(focus.claimId);
    }
    const q = (focus.prefill?.claimNumber as string) || claim?.claimNumber || '';
    if (q) {
      setStatusFilter('all');
      setCodeFilter('all');
      setSheetFilter('');
      setSearch(q);
    }
    clearFocus();
  }, [focus, data.claims, clearFocus, generateInvoiceLinesForClaim]);

  const sheets = useMemo(
    () => Array.from(new Set(data.invoiceLines.map((i) => i.invoiceSheet).filter(Boolean))).sort(),
    [data.invoiceLines],
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.invoiceLines.filter((i) => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (codeFilter !== 'all' && i.serviceCode !== codeFilter) return false;
      if (sheetFilter && i.invoiceSheet !== sheetFilter) return false;
      if (q) {
        const hay = `${i.patientName} ${i.nhi} ${i.claimNumber} ${i.poNumber} ${i.acc45Number}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data.invoiceLines, search, statusFilter, codeFilter, sheetFilter]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    for (const r of rows) {
      invoiced += r.amountInvoiced || 0;
      paid += r.amountPaid || 0;
    }
    return { invoiced, paid, outstanding: invoiced - paid };
  }, [rows]);

  function openCreate() {
    setForm(emptyLine());
    setCreating(true);
  }
  function openEdit(line: InvoiceLine) {
    setForm({ ...line });
    setEditing(line);
  }
  function close() {
    setCreating(false);
    setEditing(null);
  }
  function save() {
    if (creating) addInvoiceLine(form);
    else if (editing) updateInvoiceLine(editing.id, form);
    close();
  }
  async function del(line: InvoiceLine) {
    const ok = await confirm({
      title: 'Delete invoice line?',
      message: `Delete the ${line.serviceCode} line for ${line.patientName || 'this patient'}?`,
      destructive: true,
      confirmLabel: 'Delete',
    });
    if (ok) removeInvoiceLine(line.id);
  }

  const columns: Column<InvoiceLine>[] = [
    {
      key: 'patientName',
      header: 'Patient',
      sortable: true,
      sortValue: (r) => r.patientName,
      render: (r) => (
        <div>
          <div className="font-medium">{r.patientName || '—'}</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {r.nhi}
          </div>
        </div>
      ),
    },
    { key: 'claimNumber', header: 'Claim', sortable: true, sortValue: (r) => r.claimNumber, render: (r) => r.claimNumber || '—' },
    { key: 'code', header: 'Code', sortable: true, sortValue: (r) => r.serviceCode, render: (r) => <Badge tone="neutral">{r.serviceCode}</Badge> },
    { key: 'sheet', header: 'Invoice Sheet', sortable: true, sortValue: (r) => r.invoiceSheet, render: (r) => r.invoiceSheet || '—' },
    { key: 'invDate', header: 'Invoice Date', sortable: true, sortValue: (r) => r.invoiceDate, render: (r) => formatDate(r.invoiceDate) || '—' },
    {
      key: 'invoiced',
      header: 'Invoiced',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.amountInvoiced || 0,
      render: (r) => formatCurrency(r.amountInvoiced),
    },
    { key: 'paidDate', header: 'Date Paid', sortable: true, sortValue: (r) => r.datePaid ?? '', render: (r) => formatDate(r.datePaid) || '—' },
    {
      key: 'paid',
      header: 'Paid',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.amountPaid ?? 0,
      render: (r) => (r.amountPaid != null ? formatCurrency(r.amountPaid) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <select
          className="select py-1 text-xs"
          value={r.status}
          onChange={(e) => updateInvoiceLine(r.id, { status: e.target.value as InvoiceStatus })}
          onClick={(e) => e.stopPropagation()}
          style={{ minWidth: 130 }}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
  const extraColumns = customColumns(data.invoiceLines, (r) => r.customFields);
  if (extraColumns.length) columns.splice(columns.length - 1, 0, ...extraColumns);

  return (
    <div>
      <SectionTitle
        title="Billing Log"
        subtitle="The core ledger. Salmon = awaiting billing or remittance (follow up); green = billed."
        actions={
          <div className="flex items-center gap-2">
            <LetterImportButton />
            <button className="btn btn-primary" onClick={openCreate}>
              <IconPlus /> New invoice line
            </button>
          </div>
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
            Invoiced (filtered)
          </div>
          <div className="text-xl font-bold">{formatCurrency(totals.invoiced)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
            Paid (filtered)
          </div>
          <div className="text-xl font-bold" style={{ color: 'var(--good-fg)' }}>
            {formatCurrency(totals.paid)}
          </div>
        </div>
        <div className="card p-3">
          <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
            Outstanding (filtered)
          </div>
          <div className="text-xl font-bold" style={{ color: 'var(--salmon-fg)' }}>
            {formatCurrency(totals.outstanding)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }}>
            <IconSearch width={15} height={15} />
          </span>
          <TextInput
            placeholder="Search patient, claim, PO…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 w-64"
          />
        </div>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-auto">
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={codeFilter} onChange={(e) => setCodeFilter(e.target.value as typeof codeFilter)} className="w-auto">
          <option value="all">All codes</option>
          {visibleServiceCodes(data.settings).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={sheetFilter} onChange={(e) => setSheetFilter(e.target.value)} className="w-auto">
          <option value="">All invoice sheets</option>
          {sheets.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowClassName={(r) => rowClass(r.status)}
        initialSort={{ key: 'invDate', dir: 'desc' }}
        emptyState={
          <EmptyState
            icon={<IconBilling width={32} height={32} />}
            title="No invoice lines"
            message="Add invoice lines manually, or use Quick Paste-In to import rows from your billing report."
            action={
              <button className="btn btn-primary" onClick={openCreate}>
                <IconPlus /> New invoice line
              </button>
            }
          />
        }
      />

      <Modal
        open={creating || !!editing}
        title={creating ? 'New invoice line' : 'Edit invoice line'}
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
            <TextInput value={form.patientName} onChange={(e) => setForm({ ...form, patientName: e.target.value })} list="patient-names" />
            <datalist id="patient-names">
              {data.patients.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Patient NHI">
            <TextInput value={form.nhi} onChange={(e) => setForm({ ...form, nhi: e.target.value })} />
          </Field>
          <Field label="Claim number">
            <TextInput value={form.claimNumber} onChange={(e) => setForm({ ...form, claimNumber: e.target.value })} />
          </Field>
          <Field label="Purchase Order number">
            <TextInput value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
          </Field>
          <Field label="ACC45 number">
            <TextInput value={form.acc45Number} onChange={(e) => setForm({ ...form, acc45Number: e.target.value })} />
          </Field>
          <Field label="Service code">
            <Select value={form.serviceCode} onChange={(e) => setForm({ ...form, serviceCode: e.target.value as ServiceCode })}>
              {visibleServiceCodes(data.settings, form.serviceCode).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice sheet" hint="e.g. EXTMAR26">
            <TextInput value={form.invoiceSheet} onChange={(e) => setForm({ ...form, invoiceSheet: e.target.value })} />
          </Field>
          <Field label="Invoice date">
            <DateInput value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} />
          </Field>
          <Field label="Amount invoiced (excl GST)">
            <NumberInput
              step="0.01"
              min={0}
              value={form.amountInvoiced}
              onChange={(e) => setForm({ ...form, amountInvoiced: Number(e.target.value) })}
            />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as InvoiceStatus })}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date paid">
            <DateInput
              value={form.datePaid ?? ''}
              onChange={(e) => setForm({ ...form, datePaid: e.target.value || undefined })}
            />
          </Field>
          <Field label="Amount paid">
            <NumberInput
              step="0.01"
              min={0}
              value={form.amountPaid ?? ''}
              onChange={(e) => setForm({ ...form, amountPaid: e.target.value === '' ? undefined : Number(e.target.value) })}
            />
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
