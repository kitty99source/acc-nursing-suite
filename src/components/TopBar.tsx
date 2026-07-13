import { useRef, useState, useEffect } from 'react';
import { useStore } from '../state/store';
import { IconSave, IconFolder, IconLock, IconHelp } from './icons';
import { formatDate } from '../lib/format';
import { readFileAsText, PassphraseRequiredError, WrongPassphraseError } from '../lib/storage';
import { Modal } from './Modal';
import { useFlash } from '../hooks/useFlash';

const SAVE_FILENAME = 'acc-nursing-data.accdata';

/** Manual-save status line: distinguishes IndexedDB autosave vs exported file. */
function SaveStatus() {
  const status = useStore((s) => s.status);
  if (status.dirty) {
    return (
      <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--warn-fg)' }}>
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--warn-fg)' }} />
        Unsaved changes — export to .accdata recommended
      </span>
    );
  }
  if (status.lastExportAt) {
    const when = new Date(status.lastExportAt).toLocaleString('en-NZ');
    return (
      <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--good-fg)' }}>
        <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--good-fg)' }} />
        Exported to .accdata · {when}
      </span>
    );
  }
  const autosaved =
    status.lastSavedAt != null
      ? new Date(status.lastSavedAt).toLocaleTimeString('en-NZ')
      : '';
  return (
    <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--accent)' }} />
      Auto-saved on this computer{autosaved ? ` · ${autosaved}` : ''}
    </span>
  );
}

export function TopBar({
  onMenuToggle,
  onOpenHelp,
}: {
  onMenuToggle?: () => void;
  onOpenHelp?: () => void;
}) {
  const status = useStore((s) => s.status);
  const saveMyData = useStore((s) => s.saveMyData);
  const loadMyData = useStore((s) => s.loadMyData);
  const connectNewFile = useStore((s) => s.connectNewFile);
  const openExistingFile = useStore((s) => s.openExistingFile);
  const saveIntoRecent = useStore((s) => s.saveIntoRecent);
  const recentFiles = useStore((s) => s.recentFiles);
  const lock = useStore((s) => s.lock);
  const topBarFlash = useStore((s) => s.topBarFlash);
  const clearTopBarFlash = useStore((s) => s.clearTopBarFlash);
  const helperModeEnabled = useStore((s) => s.data.settings.helperModeEnabled);
  const updateSettings = useStore((s) => s.updateSettings);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [saveIntoOpen, setSaveIntoOpen] = useState(false);
  const saveIntoRef = useRef<HTMLDivElement>(null);
  const { flash, showFlash, clearFlash } = useFlash();

  useEffect(() => {
    if (!topBarFlash) return;
    showFlash(topBarFlash.text, topBarFlash.tone);
    const timer = window.setTimeout(() => clearTopBarFlash(), 4000);
    return () => window.clearTimeout(timer);
  }, [topBarFlash, showFlash, clearTopBarFlash]);

  // Click-away to close the "Save into ▾" menu (same pattern as ReviewQueue).
  useEffect(() => {
    if (!saveIntoOpen) return;
    const onDown = (e: MouseEvent) => {
      if (saveIntoRef.current && !saveIntoRef.current.contains(e.target as Node)) {
        setSaveIntoOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSaveIntoOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [saveIntoOpen]);

  async function handleSaveInto(index: number) {
    setSaveIntoOpen(false);
    setBusy(true);
    clearFlash();
    try {
      const res = await saveIntoRecent(index);
      showFlash(`Saved into ${res.fileName}`, 'good');
    } catch (err) {
      showFlash((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    clearFlash();
    try {
      const res = await saveMyData(SAVE_FILENAME);
      showFlash(
        res.savedToFile ? `Saved to ${res.fileName}` : `Downloaded ${SAVE_FILENAME}`,
        'good',
      );
    } catch (err) {
      showFlash(`Save failed: ${(err as Error).message}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  /** Attempt to load file text, prompting for a passphrase if the file is encrypted. */
  async function attemptLoad(text: string, pass?: string) {
    try {
      await loadMyData(text, pass);
      setPendingText(null);
      setPassphrase('');
      setPassError('');
      showFlash('Your data was loaded.', 'good');
    } catch (err) {
      if (err instanceof PassphraseRequiredError) {
        setPendingText(text);
        setPassError('');
        return;
      }
      if (err instanceof WrongPassphraseError) {
        setPendingText(text);
        setPassphrase('');
        setPassError('Incorrect passphrase. Please try again.');
        return;
      }
      setPendingText(null);
      setLoadErrorText((err as Error).message);
      setLoadErrorOpen(true);
      showFlash(`Load failed: ${(err as Error).message}`, 'danger');
    }
  }

  async function handleLoadFile(file: File) {
    setBusy(true);
    clearFlash();
    try {
      const text = await readFileAsText(file);
      await attemptLoad(text);
    } catch (err) {
      showFlash(`Load failed: ${(err as Error).message}`, 'danger');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function submitPassphrase() {
    if (!pendingText || !passphrase) return;
    setPassBusy(true);
    await attemptLoad(pendingText, passphrase);
    setPassBusy(false);
  }

  async function runFsa(fn: () => Promise<void>, label: string) {
    setBusy(true);
    clearFlash();
    try {
      await fn();
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') showFlash(`${label}: ${e.message}`, 'danger');
    } finally {
      setBusy(false);
    }
  }

  const [pendingText, setPendingText] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [passError, setPassError] = useState('');
  const [passBusy, setPassBusy] = useState(false);
  const [loadErrorOpen, setLoadErrorOpen] = useState(false);
  const [loadErrorText, setLoadErrorText] = useState('');

  return (
    <header
      className="h-12 shrink-0 flex items-center justify-between gap-3 px-4 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {onMenuToggle && (
          <button className="btn btn-icon shrink-0 lg:hidden" onClick={onMenuToggle} aria-label="Open menu">
            ☰
          </button>
        )}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {status.hasFileHandle && status.fileName ? status.fileName : 'ACC District Nursing Admin Suite'}
          </div>
          <div className="text-xs flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <SaveStatus />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {flash && (
          <span
            className="text-xs max-w-[7rem] sm:max-w-[14rem] truncate"
            style={{ color: flash.tone === 'good' ? 'var(--good-fg)' : flash.tone === 'danger' ? 'var(--danger-fg)' : 'var(--warn-fg)' }}
            title={flash.text}
          >
            {flash.text}
          </span>
        )}

        {/* Primary, always-visible persistence (works on file://). At narrow widths the
            labels collapse to icon-only so the controls never overlap the ☰ toggle. */}
        <button
          className="btn btn-primary shrink-0"
          disabled={busy}
          onClick={() => void handleSave()}
          aria-label="Save my data"
          title={
            status.hasFileHandle && status.fileName
              ? `Save into ${status.fileName} (overwrites the same file)`
              : `Download a backup of all your data (${SAVE_FILENAME}). Tip: use “Save to file…” once to save into a fixed file instead of new downloads.`
          }
        >
          <IconSave />
          <span className="hidden sm:inline">
            {status.hasFileHandle ? 'Save' : 'Save my data'}
          </span>
        </button>
        <button
          className="btn shrink-0"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          aria-label="Load my data"
          title="Load your data back from a saved file"
        >
          <IconFolder />
          <span className="hidden sm:inline">Load my data</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".accdata,.json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleLoadFile(f);
          }}
        />

        {/* Optional/advanced: File System Access API (only on secure contexts). */}
        {status.fsaSupported && (
          <div
            className="hidden sm:flex items-center gap-1 pl-2 ml-1 border-l"
            style={{ borderColor: 'var(--border)' }}
            title="Advanced: silent autosave to a file you choose (requires the helper program running on this PC)"
          >
            <button
              className="btn text-xs"
              disabled={busy}
              onClick={() => void runFsa(openExistingFile, 'Open')}
              title="Open an existing .accdata file and save into it from now on (no more new downloads)"
            >
              Open
            </button>
            <button
              className="btn text-xs"
              disabled={busy}
              onClick={() => void runFsa(connectNewFile, 'Save to file')}
              title={
                status.hasFileHandle
                  ? 'Choose a different file to save into from now on'
                  : 'Choose one file to save into from now on (Save then overwrites it, no new downloads)'
              }
            >
              {status.hasFileHandle ? 'Save As…' : 'Save to file…'}
            </button>
          </div>
        )}

        {/* Recent files: overwrite one of several recently-used .accdata files
            without re-picking it. Only shown when FSA is available and there is
            at least one remembered file. */}
        {status.fsaSupported && recentFiles.length > 0 && (
          <div className="relative hidden sm:block shrink-0" ref={saveIntoRef}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              aria-haspopup="menu"
              aria-expanded={saveIntoOpen}
              onClick={() => setSaveIntoOpen((v) => !v)}
              title="Overwrite one of your recently-used files"
            >
              Save into ▾
            </button>
            {saveIntoOpen && (
              <div
                role="menu"
                className="absolute right-0 mt-1 z-20 flex flex-col gap-1 p-1.5 rounded-card"
                style={{
                  minWidth: 240,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                }}
              >
                {recentFiles.map((f, i) => {
                  const isConnected = status.hasFileHandle && status.fileName === f.name;
                  return (
                    <button
                      key={`${f.name}-${i}`}
                      type="button"
                      role="menuitem"
                      className="btn btn-sm w-full justify-start"
                      disabled={busy}
                      onClick={() => void handleSaveInto(i)}
                      title={`Overwrite ${f.name} with your current data`}
                    >
                      <span
                        aria-hidden
                        className="inline-block w-4 shrink-0"
                        style={{ color: 'var(--good-fg)' }}
                      >
                        {isConnected ? '✓' : ''}
                      </span>
                      <span className="truncate">{f.name}</span>
                      {isConnected && (
                        <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                          connected
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {onOpenHelp && (
          <button
            type="button"
            className="btn btn-sm shrink-0"
            onClick={onOpenHelp}
            title="Open instruction guide & FAQ"
            aria-label="Open Help Center"
          >
            Help
          </button>
        )}
        <button
          type="button"
          className="btn btn-icon shrink-0"
          onClick={() => updateSettings({ helperModeEnabled: !helperModeEnabled })}
          title={
            helperModeEnabled
              ? 'Helper Mode on — hover key controls for tips. Click to turn off.'
              : 'Helper Mode off — click to show short tips when you hover key controls.'
          }
          aria-label={helperModeEnabled ? 'Turn off Helper Mode' : 'Turn on Helper Mode'}
          aria-pressed={helperModeEnabled}
          style={
            helperModeEnabled
              ? { background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)' }
              : undefined
          }
        >
          <IconHelp />
        </button>
        <button className="btn btn-icon shrink-0" onClick={lock} title="Lock the app">
          <IconLock />
        </button>
      </div>

      <Modal
        open={pendingText !== null}
        title="Enter passphrase"
        size="sm"
        onClose={() => {
          setPendingText(null);
          setPassphrase('');
          setPassError('');
        }}
        footer={
          <>
            <button
              className="btn"
              onClick={() => {
                setPendingText(null);
                setPassphrase('');
                setPassError('');
              }}
            >
              Cancel
            </button>
            <button
              className="btn btn-primary"
              disabled={passBusy || !passphrase}
              onClick={() => void submitPassphrase()}
            >
              {passBusy ? 'Unlocking…' : 'Unlock & load'}
            </button>
          </>
        }
      >
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
          This file is encrypted. Enter the passphrase you used to save it.
        </p>
        <input
          type="password"
          className="input"
          placeholder="Passphrase"
          value={passphrase}
          autoFocus
          onChange={(e) => setPassphrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submitPassphrase();
          }}
        />
        {passError && (
          <p className="text-sm mt-2 font-medium" style={{ color: 'var(--danger-fg)' }}>
            {passError}
          </p>
        )}
      </Modal>

      <Modal
        open={loadErrorOpen}
        title="Could not load file"
        onClose={() => setLoadErrorOpen(false)}
        size="sm"
        footer={
          <button className="btn btn-primary" onClick={() => setLoadErrorOpen(false)}>
            OK
          </button>
        }
      >
        <p className="text-sm mb-2" style={{ color: 'var(--danger-fg)' }}>
          {loadErrorText}
        </p>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Your current working data was not changed.
        </p>
      </Modal>
    </header>
  );
}

export function lastSavedLabel(ts?: number): string {
  return ts ? formatDate(new Date(ts).toISOString().slice(0, 10)) : '';
}
