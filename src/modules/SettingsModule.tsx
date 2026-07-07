import { useState, useEffect } from 'react';
import { useStore, isSampleData, wipeAllLocalStorage, hasSessionPassphrase } from '../state/store';
import { SectionTitle, Card, Field, NumberInput, Select, TextInput } from '../components/ui';
import { useConfirm } from '../components/useConfirm';
import { ACCENT_PRESETS } from '../lib/theme';
import { ALL_SERVICE_CODES, SERVICE_CODES } from '../lib/serviceCodes';
import { readRecentAudit, type AuditEntry } from '../lib/auditLog';
import { compareDocumentBlobs } from '../lib/integrity';
import { listDocumentIds } from '../lib/idb';
import { STORAGE_QUOTA_GUIDANCE } from '../lib/storageQuota';
import type { DensityMode, ServiceCode, ThemeName } from '../types';

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'clinical-light', label: 'Clinical Light' },
  { value: 'warm-light', label: 'Warm Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High Contrast' },
];

function rateBasisLabel(code: ServiceCode): string {
  switch (SERVICE_CODES[code].basis) {
    case 'package':
      return 'per package';
    case 'consult':
      return 'per consult';
    case 'hour':
      return 'per hour';
    case 'km':
      return 'per km';
    case 'night':
      return 'per night';
    case 'actual':
      return 'actual cost';
    default:
      return '';
  }
}

export function SettingsModule() {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const status = useStore((s) => s.status);
  const integrityWarnings = useStore((s) => s.integrityWarnings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setPassphrase = useStore((s) => s.setPassphrase);
  const saveNow = useStore((s) => s.saveNow);
  const clearSampleData = useStore((s) => s.clearSampleData);
  const resetToEmpty = useStore((s) => s.resetToEmpty);
  const [confirm, confirmDialog] = useConfirm();
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [blobHealth, setBlobHealth] = useState<ReturnType<typeof compareDocumentBlobs> | null>(null);

  useEffect(() => {
    void readRecentAudit(50).then(setAuditEntries);
    void listDocumentIds().then((ids) => setBlobHealth(compareDocumentBlobs(data, ids)));
  }, [data]);

  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [passMsg, setPassMsg] = useState<{ text: string; tone: 'good' | 'danger' } | null>(null);

  const sampleLoaded = isSampleData(data);

  function enableEncryption() {
    if (!pass1 || pass1 !== pass2) {
      setPassMsg({ text: 'Passphrases must match and not be empty.', tone: 'danger' });
      return;
    }
    setPassphrase(pass1);
    updateSettings({ encryptionEnabled: true });
    setPass1('');
    setPass2('');
    setPassMsg({ text: 'Encryption enabled. Your data file is now encrypted on save.', tone: 'good' });
  }

  async function disableEncryption() {
    const ok = await confirm({
      title: 'Disable encryption?',
      message: 'Your data file will be saved as readable JSON from now on. Continue?',
      confirmLabel: 'Disable encryption',
    });
    if (ok) {
      updateSettings({ encryptionEnabled: false });
      await saveNow();
      setPassMsg({ text: 'Encryption disabled.', tone: 'good' });
    }
  }

  function updatePassphrase() {
    if (!pass1 || pass1 !== pass2) {
      setPassMsg({ text: 'Passphrases must match and not be empty.', tone: 'danger' });
      return;
    }
    setPassphrase(pass1);
    setPass1('');
    setPass2('');
    setPassMsg({ text: 'Passphrase updated. It will apply on the next save.', tone: 'good' });
  }

  async function handleClearSample() {
    const ok = await confirm({
      title: 'Clear sample data?',
      message: 'Remove all the obviously-fake SAMPLE patients, claims, invoices, cases and declines?',
      confirmLabel: 'Clear sample data',
      destructive: true,
    });
    if (ok) clearSampleData();
  }

  async function handleReset() {
    const ok = await confirm({
      title: 'Start a fresh empty file?',
      message: 'This deletes ALL data (keeping only your settings). This cannot be undone.',
      confirmLabel: 'Delete everything',
      destructive: true,
    });
    if (ok) resetToEmpty();
  }

  function toggleServiceCode(code: ServiceCode, enabled: boolean) {
    const current = new Set(settings.enabledServiceCodes);
    if (enabled) current.add(code);
    else current.delete(code);
    // Preserve canonical ordering.
    updateSettings({ enabledServiceCodes: ALL_SERVICE_CODES.filter((c) => current.has(c)) });
  }

  function setRate(code: ServiceCode, value: number) {
    updateSettings({ serviceRates: { ...settings.serviceRates, [code]: Math.max(0, value) } });
  }

  async function handleWipe() {
    const ok = await confirm({
      title: 'Wipe local storage?',
      message:
        'Removes the in-browser working copy and the remembered file handle. Your saved .accdata file on disk is NOT touched. The app will reload.',
      confirmLabel: 'Wipe & reload',
      destructive: true,
    });
    if (ok) {
      await wipeAllLocalStorage();
      location.reload();
    }
  }

  return (
    <div>
      <SectionTitle title="Settings" subtitle="Appearance, thresholds, security and data — all stored locally." />

      <Card className="mb-4">
        <h3 className="font-semibold mb-2">About</h3>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          ACC District Nursing Admin Suite · v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}
          {typeof __BUILD_DATE__ !== 'undefined' ? ` (build ${__BUILD_DATE__})` : ''}
        </p>
      </Card>

      <Card className="mb-4">
        <h3 className="font-semibold mb-2">How saving works</h3>
        <p className="text-sm mb-2" style={{ color: 'var(--text)' }}>
          <strong>IndexedDB autosave</strong> keeps a working copy in this browser after every edit (crash-safe).
          It does <strong>not</strong> clear the &quot;unsaved&quot; warning — that only clears when you{' '}
          <strong>Save my data</strong> to a <span className="font-mono">.accdata</span> file you control.
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Last export:{' '}
          {status.lastExportAt ? new Date(status.lastExportAt).toLocaleString('en-NZ') : 'never — export soon'}
          {' · '}
          Last IDB autosave:{' '}
          {status.lastSavedAt ? new Date(status.lastSavedAt).toLocaleString('en-NZ') : '—'}
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          <strong>How to launch:</strong> copy the built <span className="font-mono">dist/</span> folder to your shared drive, then double-click{' '}
          <span className="font-mono">Start ACC Suite.cmd</span> (Windows) — a small local server opens the app in your browser. Your{' '}
          <span className="font-mono">.accdata</span> file is separate; load it via TopBar after launch.
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          Letter import entry points: Approvals/Declines/Claim Documents for full save; Patients modals for prefill only.
          See <span className="font-mono">change-requests/LETTER_IMPORT_UX.md</span> in the project repo.
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
          {STORAGE_QUOTA_GUIDANCE}
        </p>
      </Card>

      {(integrityWarnings.length > 0 || (blobHealth && (blobHealth.missingBlobIds.length > 0 || blobHealth.orphanBlobIds.length > 0))) && (
        <Card className="mb-4">
          <h3 className="font-semibold mb-2">Data health</h3>
          {integrityWarnings.length > 0 && (
            <ul className="text-xs list-disc pl-4 mb-2 max-h-32 overflow-y-auto" style={{ color: 'var(--warn-fg)' }}>
              {integrityWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {blobHealth && (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Documents: {blobHealth.metadataCount} metadata · {blobHealth.blobCount} blobs in IDB
              {blobHealth.missingBlobIds.length > 0 && ` · ${blobHealth.missingBlobIds.length} missing blob(s)`}
              {blobHealth.orphanBlobIds.length > 0 && ` · ${blobHealth.orphanBlobIds.length} orphan blob(s)`}
            </p>
          )}
        </Card>
      )}

      {auditEntries.length > 0 && (
        <Card className="mb-4">
          <h3 className="font-semibold mb-2">Recent activity</h3>
          <div className="space-y-1 text-sm max-h-48 overflow-y-auto">
            {auditEntries.map((e) => (
              <div key={e.ts} className="flex justify-between gap-2 py-1 text-xs" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="truncate">{e.summary}</span>
                <span className="shrink-0" style={{ color: 'var(--muted)' }}>
                  {new Date(e.ts).toLocaleString('en-NZ')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {(data.importHistory?.length ?? 0) > 0 && (
        <Card className="mb-4">
          <h3 className="font-semibold mb-2">Recent ACC letter imports</h3>
          <div className="space-y-1 text-sm max-h-40 overflow-y-auto">
            {data.importHistory!.map((h) => (
              <div key={h.id} className="flex justify-between gap-2 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="truncate">{h.fileName}</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                  {h.kind} · {new Date(h.importedAt).toLocaleString('en-NZ')}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-3">Appearance</h3>
          <div className="space-y-3">
            <Field label="Theme">
              <Select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value as ThemeName })}>
                {THEMES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>

            <div>
              <span className="label">Accent colour</span>
              <div className="flex items-center gap-2 flex-wrap">
                {ACCENT_PRESETS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateSettings({ accentColor: c })}
                    aria-label={`Accent ${c}`}
                    className="w-7 h-7 rounded-full border-2"
                    style={{
                      background: c,
                      borderColor: settings.accentColor === c ? 'var(--text)' : 'transparent',
                    }}
                  />
                ))}
                <input
                  type="color"
                  value={settings.accentColor}
                  onChange={(e) => updateSettings({ accentColor: e.target.value })}
                  className="w-9 h-9 rounded cursor-pointer bg-transparent border"
                  style={{ borderColor: 'var(--border)' }}
                  aria-label="Custom accent colour"
                />
              </div>
            </div>

            <Field label="Density">
              <Select value={settings.densityMode} onChange={(e) => updateSettings({ densityMode: e.target.value as DensityMode })}>
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </Select>
            </Field>

            <Field label={`Font scale (${Math.round(settings.fontScale * 100)}%)`}>
              <input
                type="range"
                min={0.85}
                max={1.3}
                step={0.05}
                value={settings.fontScale}
                onChange={(e) => updateSettings({ fontScale: Number(e.target.value) })}
                className="w-full"
              />
            </Field>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Workflow thresholds</h3>
          <div className="space-y-3">
            <Field label="Approval expiry warning (days)" hint="Approvals within this many days are flagged salmon.">
              <NumberInput
                min={1}
                value={settings.expiryThresholdDays}
                onChange={(e) => updateSettings({ expiryThresholdDays: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
            <Field label="Idle auto-lock (minutes)" hint="0 disables auto-lock.">
              <NumberInput
                min={0}
                value={settings.idleLockMinutes}
                onChange={(e) => updateSettings({ idleLockMinutes: Math.max(0, Number(e.target.value)) })}
              />
            </Field>
            <Field label="Backup reminder (days without export)" hint="Default 7 (U-14).">
              <NumberInput
                min={1}
                value={settings.backupReminderDays}
                onChange={(e) => updateSettings({ backupReminderDays: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
            <Field label="Stale remittance threshold (days)" hint="Remittance lines older than this appear in the action queue.">
              <NumberInput
                min={1}
                value={settings.remittanceStaleDays ?? 60}
                onChange={(e) => updateSettings({ remittanceStaleDays: Math.max(1, Number(e.target.value)) })}
              />
            </Field>
            <Field label="Compliance rules version" hint="ACC Schedule / OG edition encoded in Flagged checks.">
              <TextInput value={settings.complianceRulesVersion ?? '2025-03'} readOnly />
            </Field>
            <label className="flex items-center justify-between gap-3 text-sm">
              <span>
                <span className="font-medium">Quick Paste-In</span>
                <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                  Show the paste-and-map importer in the sidebar.
                </span>
              </span>
              <input
                type="checkbox"
                checked={settings.quickPasteInEnabled}
                onChange={(e) => updateSettings({ quickPasteInEnabled: e.target.checked })}
                className="w-5 h-5"
              />
            </label>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Developer / testing</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Production mode disables letter auto-commit and sample-data recovery. Turn off only for fixture testing.
          </p>
          <label className="flex items-center justify-between gap-3 text-sm mb-2">
            <span className="font-medium">Production mode</span>
            <input
              type="checkbox"
              checked={settings.productionMode !== false}
              onChange={(e) => updateSettings({ productionMode: e.target.checked })}
              className="w-5 h-5"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">Letter import auto-commit</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                Requires production mode off. 100% confidence still needs dev flag.
              </span>
            </span>
            <input
              type="checkbox"
              checked={settings.letterImportAutoCommit === true}
              disabled={settings.productionMode !== false}
              onChange={(e) => updateSettings({ letterImportAutoCommit: e.target.checked })}
              className="w-5 h-5"
            />
          </label>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Security</h3>
          <label className="flex items-center justify-between gap-3 text-sm mb-3">
            <span>
              <span className="font-medium">Encrypt data file (AES-GCM)</span>
              <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                {settings.encryptionEnabled
                  ? hasSessionPassphrase()
                    ? 'Encryption is ON. Passphrase loaded for this session.'
                    : 'Encryption is ON.'
                  : 'Data file is readable JSON.'}
              </span>
            </span>
          </label>

          {!settings.encryptionEnabled ? (
            <div className="space-y-2">
              <Field label="Set passphrase">
                <TextInput type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} placeholder="Passphrase" />
              </Field>
              <Field label="Confirm passphrase">
                <TextInput type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Repeat passphrase" />
              </Field>
              <button className="btn btn-primary" onClick={enableEncryption}>
                Enable encryption
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Field label="Change passphrase">
                <TextInput type="password" value={pass1} onChange={(e) => setPass1(e.target.value)} placeholder="New passphrase" />
              </Field>
              <Field label="Confirm new passphrase">
                <TextInput type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder="Repeat new passphrase" />
              </Field>
              <div className="flex gap-2">
                <button className="btn" onClick={updatePassphrase}>
                  Update passphrase
                </button>
                <button className="btn btn-danger" onClick={() => void disableEncryption()}>
                  Disable encryption
                </button>
              </div>
            </div>
          )}
          {passMsg && (
            <p className="text-xs mt-2 font-medium" style={{ color: passMsg.tone === 'good' ? 'var(--good-fg)' : 'var(--danger-fg)' }}>
              {passMsg.text}
            </p>
          )}
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Data</h3>
          <div className="space-y-2">
            {sampleLoaded && (
              <button className="btn w-full" onClick={() => void handleClearSample()}>
                Clear sample data
              </button>
            )}
            <button className="btn w-full" onClick={() => void handleReset()}>
              Start a fresh empty file (keep settings)
            </button>
            <button className="btn btn-danger w-full" onClick={() => void handleWipe()}>
              Wipe local working copy &amp; reload
            </button>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Wiping only clears this browser’s working copy and the remembered file handle — any
              <span className="font-mono"> .accdata</span> file you saved to disk is untouched.
            </p>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-1">Service codes shown</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Untick codes your office never uses to hide them from the code pickers (service lines,
            billing, filters). Existing records keep their code even if it is hidden here.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {ALL_SERVICE_CODES.map((code) => (
              <label key={code} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={settings.enabledServiceCodes.includes(code)}
                  onChange={(e) => toggleServiceCode(code, e.target.checked)}
                  className="w-4 h-4 shrink-0"
                />
                <span className="truncate">
                  <span className="font-medium">{code}</span>
                  <span style={{ color: 'var(--muted)' }}> — {SERVICE_CODES[code].name}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h3 className="font-semibold mb-1">Contract pricing (excl GST)</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Edit any rate to match your contract. These feed the Package Calculator and the rate
            reference. Invoice amounts in the Billing Log are still entered manually and are not
            changed by these rates.
          </p>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {ALL_SERVICE_CODES.map((code) => (
              <div key={code} className="flex items-center gap-2">
                <span className="text-sm flex-1 min-w-0 truncate">
                  <span className="font-medium">{code}</span>
                  <span style={{ color: 'var(--muted)' }}> — {SERVICE_CODES[code].name}</span>
                  <span className="block text-xs" style={{ color: 'var(--muted)' }}>
                    {rateBasisLabel(code)}
                  </span>
                </span>
                <div className="w-28 shrink-0">
                  <NumberInput
                    min={0}
                    step={0.01}
                    value={settings.serviceRates[code] ?? 0}
                    onChange={(e) => setRate(code, Number(e.target.value))}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {confirmDialog}
    </div>
  );
}
