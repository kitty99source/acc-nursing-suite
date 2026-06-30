import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card } from '../components/ui';
import { IconExport, IconBilling, IconFolder } from '../components/icons';
import { buildWorkbookBlob } from '../lib/excel';
import { downloadBlob, readFileAsText } from '../lib/storage';

export function ExportCenter() {
  const data = useStore((s) => s.data);
  const exportJsonDownload = useStore((s) => s.exportJsonDownload);
  const importJsonText = useStore((s) => s.importJsonText);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);

  async function exportExcel() {
    setBusy(true);
    setMessage(null);
    try {
      const blob = await buildWorkbookBlob(data);
      const stamp = new Date().toISOString().slice(0, 10);
      downloadBlob(`ACC-Nursing-Toolkit-${stamp}.xlsx`, blob);
      setMessage({ text: 'Excel workbook exported.', tone: 'good' });
    } catch (err) {
      setMessage({ text: `Excel export failed: ${(err as Error).message}`, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  }

  async function handleImportFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await readFileAsText(file);
      const ok = await importJsonText(text);
      setMessage(
        ok
          ? { text: 'Backup restored successfully.', tone: 'good' }
          : { text: 'Could not read that file. If it is encrypted, open it from the top bar instead.', tone: 'danger' },
      );
    } catch (err) {
      setMessage({ text: `Import failed: ${(err as Error).message}`, tone: 'danger' });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const counts = {
    patients: data.patients.length,
    claims: data.claims.length,
    invoices: data.invoiceLines.length,
    approvals: data.approvals.length,
    complex: data.complexCases.length,
    declines: data.declines.length,
  };

  return (
    <div>
      <SectionTitle
        title="Export Center"
        subtitle="One-click Excel workbook (replaces your toolkit) and JSON backup / restore. Everything stays on this machine."
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-2">
            <IconBilling />
            <h3 className="font-semibold">Excel workbook (.xlsx)</h3>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Exports all six tabs (Start Here, Billing Log, Year Summary, NS04-NS05 Approvals, Complex
            Cases, Decline Tracker) with dropdowns, conditional formatting and computed totals — opens
            clean in Excel.
          </p>
          <button className="btn btn-primary" onClick={() => void exportExcel()} disabled={busy}>
            <IconExport /> Export Excel workbook
          </button>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-2">
            <IconFolder />
            <h3 className="font-semibold">JSON backup &amp; restore</h3>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Download a plain-JSON backup of everything, or restore from a backup / unencrypted
            <span className="font-mono"> .accdata</span> file. Restoring replaces all current data.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={exportJsonDownload} disabled={busy}>
              <IconExport /> Download JSON backup
            </button>
            <button className="btn" onClick={() => fileInput.current?.click()} disabled={busy}>
              <IconFolder /> Restore from JSON…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.accdata,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImportFile(f);
              }}
            />
          </div>
        </Card>
      </div>

      {message && (
        <p
          className="text-sm mt-4 font-medium"
          style={{ color: message.tone === 'good' ? 'var(--good-fg)' : 'var(--danger-fg)' }}
        >
          {message.text}
        </p>
      )}

      <Card className="mt-4">
        <h3 className="font-semibold mb-3">Current data</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Stat label="Patients" value={counts.patients} />
          <Stat label="Claims" value={counts.claims} />
          <Stat label="Invoice lines" value={counts.invoices} />
          <Stat label="Approvals" value={counts.approvals} />
          <Stat label="Complex cases" value={counts.complex} />
          <Stat label="Declines" value={counts.declines} />
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-2)' }}>
      <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}
