import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Select, TextArea, Badge, EmptyState } from '../components/ui';
import { IconPaste } from '../components/icons';
import { HelperTip } from '../components/HelperTip';
import type { ModuleId } from '../components/Sidebar';
import type { InvoiceLine, InvoiceStatus, ServiceCode } from '../types';
import { ALL_SERVICE_CODES } from '../lib/serviceCodes';
import { isValidISODate } from '../lib/format';

type FieldKey = keyof Omit<InvoiceLine, 'id'> | 'ignore';

const FIELD_OPTIONS: { key: FieldKey; label: string }[] = [
  { key: 'ignore', label: '— Ignore —' },
  { key: 'patientName', label: 'Patient Name' },
  { key: 'nhi', label: 'Patient NHI' },
  { key: 'claimNumber', label: 'Claim Number' },
  { key: 'poNumber', label: 'Purchase Order Number' },
  { key: 'acc45Number', label: 'ACC45 Number' },
  { key: 'serviceCode', label: 'Service Code' },
  { key: 'invoiceSheet', label: 'Invoice Sheet' },
  { key: 'invoiceDate', label: 'Invoice Date' },
  { key: 'amountInvoiced', label: 'Amount Invoiced' },
  { key: 'datePaid', label: 'Date Paid' },
  { key: 'amountPaid', label: 'Amount Paid' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
];

function guessField(header: string): FieldKey {
  const h = header.trim().toLowerCase();
  if (/nhi/.test(h)) return 'nhi';
  if (/patient|name/.test(h)) return 'patientName';
  if (/po|purchase/.test(h)) return 'poNumber';
  if (/acc45|acc 45/.test(h)) return 'acc45Number';
  if (/claim/.test(h)) return 'claimNumber';
  if (/service|code/.test(h)) return 'serviceCode';
  if (/sheet/.test(h)) return 'invoiceSheet';
  if (/invoice date|inv date/.test(h)) return 'invoiceDate';
  if (/date paid|paid date/.test(h)) return 'datePaid';
  if (/amount invoiced|invoiced/.test(h)) return 'amountInvoiced';
  if (/amount paid|paid/.test(h)) return 'amountPaid';
  if (/status/.test(h)) return 'status';
  if (/note/.test(h)) return 'notes';
  if (/date/.test(h)) return 'invoiceDate';
  return 'ignore';
}

function detectDelimiter(text: string): '\t' | ',' {
  const firstLine = text.split(/\r?\n/)[0] ?? '';
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs >= commas ? '\t' : ',';
}

function parseDate(raw: string): string | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (isValidISODate(v)) return v;
  // dd/mm/yyyy or d/m/yy
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = `20${y}`;
    const iso = `${y.padStart(4, '0')}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (isValidISODate(iso)) return iso;
  }
  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString().slice(0, 10);
  return undefined;
}

function parseMoney(raw: string): number {
  const n = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function normaliseStatus(raw: string): InvoiceStatus {
  const v = raw.trim().toLowerCase();
  if (v.startsWith('bill')) return 'Billed';
  if (v.startsWith('remit')) return 'Remittance';
  return 'Awaiting Billing';
}

function normaliseCode(raw: string): ServiceCode {
  const v = raw.trim().toUpperCase();
  return (ALL_SERVICE_CODES as string[]).includes(v) ? (v as ServiceCode) : 'NS01';
}

export function QuickPaste({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const enabled = useStore((s) => s.data.settings.quickPasteInEnabled);
  const addInvoiceLines = useStore((s) => s.addInvoiceLines);

  const [raw, setRaw] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<FieldKey[]>([]);
  const [committed, setCommitted] = useState<number | null>(null);

  const { rows, headerCells } = useMemo(() => {
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { rows: [] as string[][], headerCells: [] as string[] };
    const delim = detectDelimiter(raw);
    const split = lines.map((l) => l.split(delim).map((c) => c.trim()));
    const header = hasHeader ? split[0] : split[0].map((_, i) => `Column ${i + 1}`);
    const body = hasHeader ? split.slice(1) : split;
    return { rows: body, headerCells: header };
  }, [raw, hasHeader]);

  // Initialise mapping when header changes.
  const effectiveMapping = useMemo(() => {
    if (mapping.length === headerCells.length && mapping.length > 0) return mapping;
    return headerCells.map((h) => guessField(h));
  }, [mapping, headerCells]);

  const parsedLines: Omit<InvoiceLine, 'id'>[] = useMemo(() => {
    return rows.map((cells) => {
      const line: Omit<InvoiceLine, 'id'> = {
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
      effectiveMapping.forEach((field, idx) => {
        const value = cells[idx] ?? '';
        switch (field) {
          case 'ignore':
            break;
          case 'amountInvoiced':
            line.amountInvoiced = parseMoney(value);
            break;
          case 'amountPaid':
            line.amountPaid = value ? parseMoney(value) : undefined;
            break;
          case 'invoiceDate':
            line.invoiceDate = parseDate(value) ?? '';
            break;
          case 'datePaid':
            line.datePaid = parseDate(value);
            break;
          case 'status':
            line.status = normaliseStatus(value);
            break;
          case 'serviceCode':
            line.serviceCode = normaliseCode(value);
            break;
          default:
            (line as Record<string, unknown>)[field] = value;
        }
      });
      return line;
    });
  }, [rows, effectiveMapping]);

  function setColumnMapping(idx: number, field: FieldKey) {
    const next = [...effectiveMapping];
    next[idx] = field;
    setMapping(next);
  }

  function commit() {
    addInvoiceLines(parsedLines);
    setCommitted(parsedLines.length);
    setRaw('');
    setMapping([]);
  }

  if (!enabled) {
    return (
      <div>
        <SectionTitle title="Quick Paste-In" />
        <EmptyState
          icon={<IconPaste width={32} height={32} />}
          title="Quick Paste-In is disabled"
          message="Enable it in Settings to paste rows from your billing report and map them to invoice lines."
          action={
            <button className="btn btn-primary" onClick={() => onNavigate('settings')}>
              Open Settings
            </button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <HelperTip tipId="tip-quick-paste" style={{ display: 'block', width: '100%' }}>
        <SectionTitle
          title="Quick Paste-In"
          subtitle="Paste tab- or comma-separated rows from your billing report, map the columns, then review before committing. Purely local — nothing is sent anywhere."
        />
      </HelperTip>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-2">1. Paste your rows</h3>
          <TextArea
            rows={10}
            placeholder="Paste rows here (copy straight from Excel or a CSV)…"
            value={raw}
            onChange={(e) => {
              setRaw(e.target.value);
              setMapping([]);
              setCommitted(null);
            }}
            className="font-mono text-xs"
          />
          <label className="flex items-center gap-2 text-sm mt-2">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            First row is a header
          </label>
          {committed != null && (
            <p className="text-sm mt-2 font-medium" style={{ color: 'var(--good-fg)' }}>
              Added {committed} invoice line{committed === 1 ? '' : 's'} to the Billing Log.
            </p>
          )}
        </Card>

        <Card>
          <h3 className="font-semibold mb-2">2. Map columns</h3>
          {headerCells.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Paste some rows to configure the column mapping.
            </p>
          ) : (
            <div className="space-y-2 max-h-[16rem] overflow-y-auto">
              {headerCells.map((h, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs w-28 truncate" title={h} style={{ color: 'var(--muted)' }}>
                    {h}
                  </span>
                  <Select value={effectiveMapping[idx]} onChange={(e) => setColumnMapping(idx, e.target.value as FieldKey)}>
                    {FIELD_OPTIONS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {parsedLines.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">3. Review ({parsedLines.length} rows)</h3>
            <button className="btn btn-primary" onClick={commit}>
              Commit {parsedLines.length} line{parsedLines.length === 1 ? '' : 's'}
            </button>
          </div>
          <div className="card overflow-auto" style={{ maxHeight: '40vh' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>NHI</th>
                  <th>Claim</th>
                  <th>Code</th>
                  <th>Sheet</th>
                  <th>Invoice Date</th>
                  <th className="text-right">Invoiced</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedLines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.patientName || <span style={{ color: 'var(--danger-fg)' }}>missing</span>}</td>
                    <td>{l.nhi}</td>
                    <td>{l.claimNumber}</td>
                    <td>
                      <Badge tone="neutral">{l.serviceCode}</Badge>
                    </td>
                    <td>{l.invoiceSheet}</td>
                    <td>{l.invoiceDate || '—'}</td>
                    <td className="text-right">{l.amountInvoiced.toFixed(2)}</td>
                    <td>{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
