import { useState } from 'react';
import { useStore, isSampleData, wipeAllLocalStorage, hasSessionPassphrase } from '../state/store';
import { SectionTitle, Card, Field, NumberInput, Select, TextInput } from '../components/ui';
import { useConfirm } from '../components/useConfirm';
import { ACCENT_PRESETS } from '../lib/theme';
import type { DensityMode, ThemeName } from '../types';

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'clinical-light', label: 'Clinical Light' },
  { value: 'warm-light', label: 'Warm Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'high-contrast', label: 'High Contrast' },
];

export function SettingsModule() {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const updateSettings = useStore((s) => s.updateSettings);
  const setPassphrase = useStore((s) => s.setPassphrase);
  const saveNow = useStore((s) => s.saveNow);
  const clearSampleData = useStore((s) => s.clearSampleData);
  const resetToEmpty = useStore((s) => s.resetToEmpty);
  const [confirm, confirmDialog] = useConfirm();

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
      </div>

      {confirmDialog}
    </div>
  );
}
