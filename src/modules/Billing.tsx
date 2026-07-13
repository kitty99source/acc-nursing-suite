import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { DataTable, customColumns, type Column } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { useConfirm } from '../components/useConfirm';
import { HelperTip } from '../components/HelperTip';
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
import { IconPlus, IconEdit, IconTrash, IconBilling, IconSearch, IconFolder, IconWarning } from '../components/icons';
import { formatCurrency, visibleServiceCodes } from '../lib/serviceCodes';
import { formatDate } from '../lib/format';
import type { InvoiceLine, InvoiceStatus, ServiceCode } from '../types';
import { readFileAsText, readFileAsArrayBuffer } from '../lib/storage';
import {
  parseInvoiceScheduleCsv,
  parseInvoiceScheduleXlsx,
  toInvoiceLineCandidate,
  type ParsedInvoiceSchedule,
} from '../lib/invoiceScheduleImport';
import { parseRemittanceCsv, parseRemittanceXlsx, type ParsedRemittanceSheet } from '../lib/remittanceImport';
import { lookupReasonCode } from '../lib/reasonCodes';
import type { RemittanceImportSummary } from '../lib/billingReconcile';
import { invoiceNeedsBillingAttention, pinAttentionFirst } from '../lib/sidebarBadges';
import { PAGE_SIZE_OPTIONS, paginate, type PageSize } from '../lib/listPagination';

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

function rowClass(line: InvoiceLine): string {
  if (line.needsReview) return 'row-salmon attention-row-danger';
  if (line.status === 'Billed') return 'row-good';
  return 'row-salmon attention-row'; // Awaiting Billing & Remittance
}

function sheetNameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function Billing() {
  const data = useStore((s) => s.data);
  const addInvoiceLine = useStore((s) => s.addInvoiceLine);
  const updateInvoiceLine = useStore((s) => s.updateInvoiceLine);
  const removeInvoiceLine = useStore((s) => s.removeInvoiceLine);
  const importInvoiceSchedule = useStore((s) => s.importInvoiceSchedule);
  const importRemittanceBatch = useStore((s) => s.importRemittanceBatch);
  const removeRemittanceImport = useStore((s) => s.removeRemittanceImport);
  const [confirm, confirmDialog] = useConfirm();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InvoiceLine | null>(null);
  const [form, setForm] = useState<Omit<InvoiceLine, 'id'>>(emptyLine());

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | InvoiceStatus>('all');
  const [codeFilter, setCodeFilter] = useState<'all' | ServiceCode>('all');
  const [sheetFilter, setSheetFilter] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);

  // Invoice-schedule import.
  const scheduleInput = useRef<HTMLInputElement>(null);
  const [scheduleFileName, setScheduleFileName] = useState('');
  const [schedulePreview, setSchedulePreview] = useState<ParsedInvoiceSchedule | null>(null);
  const [scheduleSheetLabel, setScheduleSheetLabel] = useState('');
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleResult, setScheduleResult] = useState<{ created: number; updated: number } | null>(null);

  // Remittance import.
  const remittanceInput = useRef<HTMLInputElement>(null);
  const [remittancePreview, setRemittancePreview] = useState<ParsedRemittanceSheet | null>(null);
  const [remittanceFileName, setRemittanceFileName] = useState('');
  const [remittanceError, setRemittanceError] = useState<string | null>(null);
  const [remittanceResult, setRemittanceResult] = useState<RemittanceImportSummary | null>(null);
  const [removeFlash, setRemoveFlash] = useState<string | null>(null);
  const [tab, setTab] = useState<'invoices' | 'review' | 'imports'>('invoices');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);

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
    if (focus.intent === 'stale-remittance' || focus.intent === 'review-duplicate') {
      setStatusFilter('Remittance');
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
    const filtered = data.invoiceLines.filter((i) => {
      if (statusFilter !== 'all' && i.status !== statusFilter) return false;
      if (codeFilter !== 'all' && i.serviceCode !== codeFilter) return false;
      if (sheetFilter && i.invoiceSheet !== sheetFilter) return false;
      if (reviewOnly && !i.needsReview) return false;
      if (q) {
        const hay = `${i.patientName} ${i.nhi} ${i.claimNumber} ${i.poNumber} ${i.acc45Number}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return pinAttentionFirst(filtered, invoiceNeedsBillingAttention);
  }, [data.invoiceLines, search, statusFilter, codeFilter, sheetFilter, reviewOnly]);

  const remittanceImports = data.remittanceImports ?? [];
  const needsReviewCount = useMemo(
    () => data.invoiceLines.filter((i) => i.needsReview).length,
    [data.invoiceLines],
  );
  const displayRows = useMemo(() => {
    if (tab === 'review') return rows.filter((r) => Boolean(r.needsReview));
    return rows;
  }, [rows, tab]);
  const pageSlice = useMemo(() => paginate(displayRows, page, pageSize), [displayRows, page, pageSize]);
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, codeFilter, sheetFilter, reviewOnly, tab, pageSize]);

  const totals = useMemo(() => {
    let invoiced = 0;
    let paid = 0;
    let needsReview = 0;
    for (const r of rows) {
      invoiced += r.amountInvoiced || 0;
      paid += r.amountPaid || 0;
      if (r.needsReview) needsReview += 1;
    }
    return { invoiced, paid, outstanding: invoiced - paid, needsReview };
  }, [rows]);

  async function handleScheduleFile(file: File) {
    setScheduleError(null);
    setScheduleResult(null);
    setScheduleFileName(file.name);
    setScheduleSheetLabel(sheetNameFromFile(file.name));
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const parsed = isXlsx
        ? await parseInvoiceScheduleXlsx(await readFileAsArrayBuffer(file), sheetNameFromFile(file.name))
        : parseInvoiceScheduleCsv(await readFileAsText(file), sheetNameFromFile(file.name));
      if (parsed.unrecognised) {
        setScheduleError("Couldn't find a claim-number and amount column in that file. Check it's an invoice-schedule export (CSV or .xlsx).");
        return;
      }
      setSchedulePreview(parsed);
    } catch (err) {
      setScheduleError(`Could not read that file: ${(err as Error).message}`);
    } finally {
      if (scheduleInput.current) scheduleInput.current.value = '';
    }
  }

  function confirmScheduleImport() {
    if (!schedulePreview) return;
    const rowsToImport = schedulePreview.lines.map((l) =>
      toInvoiceLineCandidate({ ...l, invoiceSheet: scheduleSheetLabel || l.invoiceSheet }),
    );
    const result = importInvoiceSchedule(rowsToImport);
    setScheduleResult(result);
    setSchedulePreview(null);
  }

  async function handleRemittanceFile(file: File) {
    setRemittanceError(null);
    setRemittanceResult(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const parsed = isXlsx
        ? await parseRemittanceXlsx(await readFileAsArrayBuffer(file))
        : parseRemittanceCsv(await readFileAsText(file));
      if (parsed.unrecognised) {
        setRemittanceError("Couldn't recognise that as a remittance export — no claim-number + paid-amount block was found.");
        return;
      }
      setRemittanceFileName(file.name);
      setRemittancePreview(parsed);
    } catch (err) {
      setRemittanceError(`Could not read that file: ${(err as Error).message}`);
    } finally {
      if (remittanceInput.current) remittanceInput.current.value = '';
    }
  }

  function confirmRemittanceImport() {
    if (!remittancePreview) return;
    const result = importRemittanceBatch(remittancePreview.lines, { fileName: remittanceFileName });
    setRemittanceResult(result);
    setRemittancePreview(null);
    setRemittanceFileName('');
  }

  async function handleRemoveRemittanceBatch(batchId: string, fileName: string) {
    const ok = await confirm({
      title: 'Remove remittance import?',
      message: (
        <p className="text-sm">
          Remove <strong>{fileName}</strong>? Payment lines from this import are dropped and only the
          invoices that batch touched are re-checked. Other remittance imports stay.
        </p>
      ),
      confirmLabel: 'Remove import',
      destructive: true,
    });
    if (!ok) return;
    const result = removeRemittanceImport(batchId);
    if (!result.ok) {
      setRemoveFlash(result.error ?? 'Could not remove that import.');
      return;
    }
    setRemoveFlash(
      `Removed "${result.fileName}" (${result.removedLineCount ?? 0} payment line(s), ${result.affectedInvoiceCount ?? 0} invoice(s) re-reconciled).`,
    );
    window.setTimeout(() => setRemoveFlash(null), 8000);
  }

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

  // Fixed % widths so the log fits a typical laptop (~1280–1440) without H-scroll.
  const columns: Column<InvoiceLine>[] = [
    {
      key: 'patientName',
      header: 'Patient',
      width: '13%',
      sortable: true,
      sortValue: (r) => r.patientName,
      render: (r) => (
        <div className="min-w-0 max-w-full">
          <div className="font-medium text-xs truncate" title={r.patientName || undefined}>
            {r.patientName || '—'}
          </div>
          <div className="text-[0.65rem] truncate" style={{ color: 'var(--muted)' }} title={r.nhi}>
            {r.nhi}
          </div>
        </div>
      ),
    },
    {
      key: 'claimNumber',
      header: 'Claim',
      width: '9%',
      sortable: true,
      sortValue: (r) => r.claimNumber,
      render: (r) => (
        <span className="text-xs truncate block font-mono" title={r.claimNumber || undefined}>
          {r.claimNumber || '—'}
        </span>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      width: '6%',
      sortable: true,
      sortValue: (r) => r.serviceCode,
      render: (r) => <Badge tone="neutral">{r.serviceCode}</Badge>,
    },
    {
      key: 'sheet',
      header: 'Sheet',
      width: '10%',
      sortable: true,
      sortValue: (r) => r.invoiceSheet,
      render: (r) => (
        <span className="text-xs truncate block" title={r.invoiceSheet || undefined}>
          {r.invoiceSheet || '—'}
        </span>
      ),
    },
    {
      key: 'invDate',
      header: 'Inv. date',
      width: '8%',
      sortable: true,
      sortValue: (r) => r.invoiceDate,
      render: (r) => (
        <span className="text-xs whitespace-nowrap">{formatDate(r.invoiceDate) || '—'}</span>
      ),
    },
    {
      key: 'invoiced',
      header: 'Invoiced',
      width: '8%',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.amountInvoiced || 0,
      render: (r) => <span className="text-xs whitespace-nowrap">{formatCurrency(r.amountInvoiced)}</span>,
    },
    {
      key: 'paidDate',
      header: 'Paid date',
      width: '8%',
      sortable: true,
      sortValue: (r) => r.datePaid ?? '',
      render: (r) => (
        <span className="text-xs whitespace-nowrap">{formatDate(r.datePaid) || '—'}</span>
      ),
    },
    {
      key: 'paid',
      header: 'Paid',
      width: '7%',
      align: 'right',
      sortable: true,
      sortValue: (r) => r.amountPaid ?? 0,
      render: (r) => (
        <span className="text-xs whitespace-nowrap">
          {r.amountPaid != null ? formatCurrency(r.amountPaid) : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '11%',
      sortable: true,
      sortValue: (r) => r.status,
      render: (r) => (
        <select
          className="select py-0.5 px-1 text-[0.65rem] leading-tight"
          value={r.status}
          onChange={(e) => updateInvoiceLine(r.id, { status: e.target.value as InvoiceStatus })}
          onClick={(e) => e.stopPropagation()}
          title={r.status}
          style={{ width: '100%', maxWidth: '7.25rem' }}
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
      key: 'review',
      header: 'Review',
      width: '12%',
      render: (r) => {
        if (!r.needsReview) return null;
        const info = lookupReasonCode(r.heldReasonCode);
        const label = info?.label ?? r.heldReasonCode ?? 'Needs review';
        return (
          <span
            className="block min-w-0 max-w-full"
            title={info ? `${info.description} ${info.action}` : r.heldReason || 'Held or short-paid by ACC'}
          >
            <Badge tone="salmon">
              <span className="inline-flex items-center gap-0.5 min-w-0 max-w-full">
                <IconWarning width={11} height={11} />
                <span className="truncate text-[0.65rem]">{label}</span>
              </span>
            </Badge>
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: '8%',
      render: (r) => (
        <div className="flex items-center gap-0.5 justify-end">
          <button className="btn btn-icon" onClick={() => openEdit(r)} aria-label="Edit">
            <IconEdit width={14} height={14} />
          </button>
          <button className="btn btn-icon btn-icon-danger" onClick={() => void del(r)} aria-label="Delete">
            <IconTrash width={14} height={14} />
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
        subtitle="The core ledger. Salmon = awaiting billing, remittance, or needs review; green = billed. Import ACC letters from Patients or Approvals — not from Billing."
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => scheduleInput.current?.click()}>
              <IconFolder width={15} height={15} /> Import invoice schedule
            </button>
            <button className="btn" onClick={() => remittanceInput.current?.click()}>
              <IconFolder width={15} height={15} /> Import remittance
            </button>
            <button className="btn btn-primary" onClick={openCreate}>
              <IconPlus /> New invoice line
            </button>
          </div>
        }
      />

      <div className="subview-tabs mb-4" role="tablist" aria-label="Billing views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'invoices'}
          className="subview-tab"
          onClick={() => setTab('invoices')}
        >
          Invoice lines ({data.invoiceLines.length})
        </button>
        <HelperTip tipId="tip-needs-review">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'review'}
            className="subview-tab"
            onClick={() => setTab('review')}
          >
            Needs review ({needsReviewCount})
            {needsReviewCount > 0 && (
              <span className="subview-tab-count" data-tone="danger">
                {needsReviewCount}
              </span>
            )}
          </button>
        </HelperTip>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'imports'}
          className="subview-tab"
          onClick={() => setTab('imports')}
        >
          Import tools &amp; history
        </button>
      </div>

      <input
        ref={scheduleInput}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleScheduleFile(f);
        }}
      />
      <input
        ref={remittanceInput}
        type="file"
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleRemittanceFile(f);
        }}
      />

      {removeFlash && (
        <p className="text-sm mb-3 font-medium" style={{ color: 'var(--good-fg)' }} role="status">
          {removeFlash}
        </p>
      )}

      {tab === 'imports' && remittanceImports.length > 0 && (
        <div className="card p-4 mb-4">
          <h3 className="card-title mb-1">Remittance imports history</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Wrong, duplicate, or test file? Use <strong>Remove import</strong> on that batch to drop its payment
            lines and re-check only the invoices it touched.
          </p>
          <ul className="space-y-2">
            {[...remittanceImports].reverse().map((batch) => (
              <li
                key={batch.id}
                className="flex flex-wrap items-center gap-2 text-sm justify-between border-b pb-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{batch.sourceFileName}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    {new Date(batch.importedAt).toLocaleString('en-NZ')} · {batch.matchedCount}/{batch.lineCount}{' '}
                    matched
                    {batch.unmatchedClaimNumbers.length
                      ? ` · ${batch.unmatchedClaimNumbers.length} unmatched`
                      : ''}
                  </div>
                </div>
                <HelperTip tipId="tip-remove-remittance">
                  <button
                    type="button"
                    className="btn btn-sm btn-sm-danger shrink-0"
                    onClick={() => void handleRemoveRemittanceBatch(batch.id, batch.sourceFileName)}
                  >
                    Remove import
                  </button>
                </HelperTip>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(scheduleError || scheduleResult) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            {scheduleError && (
              <p className="text-sm font-medium" style={{ color: 'var(--danger-fg)' }}>
                {scheduleError}
              </p>
            )}
            {scheduleResult && (
              <p className="text-sm font-medium" style={{ color: 'var(--good-fg)' }}>
                Invoice schedule imported: {scheduleResult.created} new line(s), {scheduleResult.updated} updated.
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm shrink-0"
            onClick={() => {
              setScheduleError(null);
              setScheduleResult(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {(remittanceError || remittanceResult) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            {remittanceError && (
              <p className="text-sm font-medium" style={{ color: 'var(--danger-fg)' }}>
                {remittanceError}
              </p>
            )}
            {remittanceResult && (
              <p className="text-sm font-medium" style={{ color: remittanceResult.unmatchedCount ? 'var(--warn-fg)' : 'var(--good-fg)' }}>
                Remittance imported: {remittanceResult.matchedCount} matched ({remittanceResult.paidInFullCount} paid in full,{' '}
                {remittanceResult.heldCount} need review){remittanceResult.unmatchedCount ? `, ${remittanceResult.unmatchedCount} unmatched — see below` : '.'}
              </p>
            )}
            {remittanceResult && remittanceResult.unmatched.length > 0 && (
              <div className="card p-3 mt-2">
                <div className="text-sm font-semibold mb-2">Unmatched remittance lines (no invoice line for this claim)</div>
                <ul className="text-sm space-y-1">
                  {remittanceResult.unmatched.map((u, i) => (
                    <li key={i}>
                      <span className="font-mono">{u.claimNumber || '(no claim number)'}</span>
                      {u.clientName ? ` — ${u.clientName}` : ''} — {formatCurrency(u.amountPaid)} paid
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm shrink-0"
            onClick={() => {
              setRemittanceError(null);
              setRemittanceResult(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid sm:grid-cols-4 gap-3 mb-4">
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
        <button
          className="card p-3 text-left clickable-card"
          onClick={() => {
            setReviewOnly(true);
            setStatusFilter('all');
          }}
        >
          <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
            Needs review (filtered)
          </div>
          <div className="text-xl font-bold" style={{ color: totals.needsReview ? 'var(--danger-fg)' : undefined }}>
            {totals.needsReview}
          </div>
        </button>
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
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          Needs review only
        </label>
      </div>

      {(tab === 'invoices' || tab === 'review') && (
      <>
      <DataTable
        columns={columns}
        rows={pageSlice.pageItems}
        rowKey={(r) => r.id}
        rowClassName={(r) => rowClass(r)}
        tableLayout="fixed"
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

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3 text-sm" style={{ color: 'var(--muted)' }}>
        <span>
          Showing {pageSlice.from}–{pageSlice.to} of {pageSlice.total}
        </span>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            className="w-auto"
            onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </Select>
          <button type="button" className="btn btn-sm" disabled={pageSlice.page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </button>
          <span>
            Page {pageSlice.page}/{pageSlice.pageCount}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={pageSlice.page >= pageSlice.pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>
      </>
      )}

      {tab === 'imports' && (
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
          Use the import buttons above to load an ACC invoice schedule or remittance CSV/XLSX. Remittance
          import history (with Remove import) appears here when batches exist.
        </p>
      )}

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

      <Modal
        open={!!schedulePreview}
        title="Preview invoice schedule import"
        onClose={() => setSchedulePreview(null)}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={() => setSchedulePreview(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmScheduleImport} disabled={!schedulePreview?.lines.length}>
              Import {schedulePreview?.lines.length ?? 0} line(s)
            </button>
          </>
        }
      >
        {schedulePreview && (
          <div className="space-y-3">
            <Field label="Invoice sheet label" hint={`From ${scheduleFileName || 'the filename'} — edit if needed`}>
              <TextInput value={scheduleSheetLabel} onChange={(e) => setScheduleSheetLabel(e.target.value)} />
            </Field>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Found {schedulePreview.lines.length} line(s). Rows are matched to existing invoice lines by claim number +
              service code + invoice sheet; a match updates the amount, a new claim/code/sheet combination creates a new
              line with status "Awaiting Billing".
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ background: 'var(--surface-2)' }}>
                    <th className="p-2">Patient</th>
                    <th className="p-2">Claim</th>
                    <th className="p-2">Code</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {schedulePreview.lines.slice(0, 200).map((l, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2">{l.patientName || '—'}</td>
                      <td className="p-2 font-mono">{l.claimNumber}</td>
                      <td className="p-2">{l.serviceCode || '—'}</td>
                      <td className="p-2 text-right">{formatCurrency(l.amountInvoiced)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {schedulePreview.lines.length > 200 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Showing the first 200 of {schedulePreview.lines.length} rows; all will be imported.
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={!!remittancePreview}
        title="Preview remittance import"
        onClose={() => setRemittancePreview(null)}
        size="lg"
        footer={
          <>
            <button className="btn" onClick={() => setRemittancePreview(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={confirmRemittanceImport} disabled={!remittancePreview?.lines.length}>
              Import {remittancePreview?.lines.length ?? 0} line(s)
            </button>
          </>
        }
      >
        {remittancePreview && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Found {remittancePreview.lines.length} line(s){' '}
              {remittancePreview.summaryOnlyLineCount ? `(plus ${remittancePreview.summaryOnlyLineCount} coarse summary row(s), not matched individually)` : ''}. Each line
              is matched to an invoice line by its ACC45/claim number — never by name. Short-paid, unpaid or
              held/declined lines are flagged "Needs review" with ACC's reason (when a documented code is found).
            </p>
            <div className="max-h-64 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left" style={{ background: 'var(--surface-2)' }}>
                    <th className="p-2">Claim</th>
                    <th className="p-2">Client</th>
                    <th className="p-2 text-right">Paid</th>
                    <th className="p-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {remittancePreview.lines.slice(0, 200).map((l, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="p-2 font-mono">{l.claimNumber || '—'}</td>
                      <td className="p-2">{l.clientName || '—'}</td>
                      <td className="p-2 text-right">{formatCurrency(l.amountPaid)}</td>
                      <td className="p-2">
                        {l.lineNeedsReview ? (
                          <Badge tone="salmon">{lookupReasonCode(l.reasonCode)?.label ?? l.reasonText ?? 'Held/short-paid'}</Badge>
                        ) : (
                          <Badge tone="good">Paid in full</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {remittancePreview.lines.length > 200 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Showing the first 200 of {remittancePreview.lines.length} rows; all will be imported.
              </p>
            )}
          </div>
        )}
      </Modal>

      {confirmDialog}
    </div>
  );
}
