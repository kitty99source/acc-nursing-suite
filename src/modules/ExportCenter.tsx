import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card } from '../components/ui';
import { Modal } from '../components/Modal';
import { IconExport, IconBilling, IconFolder } from '../components/icons';
import { buildWorkbookBlob } from '../lib/excel';
import { parseWorkbook, type ImportMode, type ImportResult } from '../lib/excelImport';
import { downloadBlob, readFileAsText, readFileAsArrayBuffer } from '../lib/storage';

export function ExportCenter() {
  const data = useStore((s) => s.data);
  const exportJsonDownload = useStore((s) => s.exportJsonDownload);
  const importJsonText = useStore((s) => s.importJsonText);
  const importFromExcel = useStore((s) => s.importFromExcel);
  const fileInput = useRef<HTMLInputElement>(null);
  const excelInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);

  // Excel import preview state.
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('merge');

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

  async function handleExcelFile(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const buffer = await readFileAsArrayBuffer(file);
      const result = await parseWorkbook(buffer);
      setImportMode('merge');
      setPreview(result);
    } catch (err) {
      setMessage({
        text: `Could not read that Excel file: ${(err as Error).message}. Make sure it is a .xlsx workbook.`,
        tone: 'danger',
      });
    } finally {
      setBusy(false);
      if (excelInput.current) excelInput.current.value = '';
    }
  }

  function confirmImport() {
    if (!preview) return;
    importFromExcel(preview, importMode);
    const c = preview.summary.counts;
    setPreview(null);
    setMessage({
      text: `Imported ${c.invoiceLines} invoice line(s), ${c.approvals} approval(s), ${c.complexCases} complex case(s), ${c.declines} decline(s)${
        c.customSheets ? `, ${c.customSheets} custom table(s)` : ''
      } (${importMode}).`,
      tone: 'good',
    });
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
        subtitle="One-click Excel workbook (replaces your toolkit), Excel import, and JSON backup / restore. Everything stays on this machine."
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
            clean in Excel. Any custom fields/tables you imported are written back out too.
          </p>
          <button className="btn btn-primary" onClick={() => void exportExcel()} disabled={busy}>
            <IconExport /> Export Excel workbook
          </button>
        </Card>

        <Card>
          <div className="flex items-center gap-2 mb-2">
            <IconBilling />
            <h3 className="font-semibold">Import from Excel (.xlsx)</h3>
          </div>
          <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
            Read an Excel workbook back into the app. Recognised tabs (Billing Log, Approvals, Complex
            Cases, Decline Tracker) map to your data; unknown columns are kept as custom fields and
            unknown sheets as custom tables. You'll get a preview before anything changes.
          </p>
          <button className="btn btn-primary" onClick={() => excelInput.current?.click()} disabled={busy}>
            <IconFolder /> Choose Excel file…
          </button>
          <input
            ref={excelInput}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleExcelFile(f);
            }}
          />
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

      {preview && (
        <ImportPreview
          result={preview}
          mode={importMode}
          onModeChange={setImportMode}
          onCancel={() => setPreview(null)}
          onConfirm={confirmImport}
        />
      )}
    </div>
  );
}

function ImportPreview({
  result,
  mode,
  onModeChange,
  onCancel,
  onConfirm,
}: {
  result: ImportResult;
  mode: ImportMode;
  onModeChange: (m: ImportMode) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { summary } = result;
  const c = summary.counts;
  const newColEntries = Object.entries(summary.newColumnsBySheet).filter(([, cols]) => cols.length > 0);
  const nothing =
    c.invoiceLines + c.approvals + c.complexCases + c.declines + c.customSheets + c.patients === 0;

  return (
    <Modal
      open
      title="Preview Excel import"
      onClose={onCancel}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={nothing}>
            {mode === 'replace' ? 'Replace data' : 'Merge into my data'}
          </button>
        </>
      }
    >
      {nothing ? (
        <p className="text-sm" style={{ color: 'var(--danger-fg)' }}>
          No recognisable data was found in that workbook. Nothing will be imported.
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <h4 className="font-semibold text-sm mb-2">What was found</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              <PreviewStat label="Invoice lines" value={c.invoiceLines} />
              <PreviewStat label="Approvals" value={c.approvals} />
              <PreviewStat label="Complex cases" value={c.complexCases} />
              <PreviewStat label="Declines" value={c.declines} />
              <PreviewStat label="Patients (derived)" value={c.patients} />
              <PreviewStat label="Claims (derived)" value={c.claims} />
            </div>
          </div>

          {newColEntries.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-1">Extra columns</h4>
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                These columns aren't part of the standard schema — they'll be kept as custom fields and
                shown as extra columns in the tables.
              </p>
              <ul className="text-sm space-y-1">
                {newColEntries.map(([sheet, cols]) => (
                  <li key={sheet}>
                    <span className="font-medium">{sheet}:</span>{' '}
                    <span style={{ color: 'var(--muted)' }}>{cols.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.unrecognizedSheets.length > 0 && (
            <div>
              <h4 className="font-semibold text-sm mb-1">Unrecognised sheets</h4>
              <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
                These sheets aren't part of the standard set — each will be imported as a custom table
                (visible under “Imported Tables”).
              </p>
              <ul className="text-sm space-y-1">
                {summary.unrecognizedSheets.map((name) => {
                  const info = summary.sheets.find((s) => s.sheet === name);
                  return (
                    <li key={name}>
                      <span className="font-medium">{name}</span>{' '}
                      <span style={{ color: 'var(--muted)' }}>({info?.rows ?? 0} row(s))</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div>
            <h4 className="font-semibold text-sm mb-2">How to apply</h4>
            <div className="space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'merge'}
                  onChange={() => onModeChange('merge')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Merge</span> — add imported records to your existing
                  data, skipping exact duplicates. Recommended.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="import-mode"
                  checked={mode === 'replace'}
                  onChange={() => onModeChange('replace')}
                  className="mt-1"
                />
                <span className="text-sm">
                  <span className="font-medium">Replace</span> — clear billing, approvals, complex
                  cases, declines, patients, claims and custom tables first, then import. Keeps your
                  settings.
                </span>
              </label>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: 'var(--surface-2)' }}>
      <div className="text-xs uppercase font-semibold" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="text-lg font-bold">{value}</div>
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
