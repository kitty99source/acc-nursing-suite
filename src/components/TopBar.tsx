import { useRef, useState, useEffect } from 'react';
import { useStore } from '../state/store';
import { IconSave, IconFolder, IconLock } from './icons';
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
      Auto-saved locally (IndexedDB){autosaved ? ` · ${autosaved}` : ''}
    </span>
  );
}

export function TopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const status = useStore((s) => s.status);
  const saveMyData = useStore((s) => s.saveMyData);
  const loadMyData = useStore((s) => s.loadMyData);
  const connectNewFile = useStore((s) => s.connectNewFile);
  const openExistingFile = useStore((s) => s.openExistingFile);
  const lock = useStore((s) => s.lock);
  const topBarFlash = useStore((s) => s.topBarFlash);
  const clearTopBarFlash = useStore((s) => s.clearTopBarFlash);

  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { flash, showFlash, clearFlash } = useFlash();

  useEffect(() => {
    if (!topBarFlash) return;
    showFlash(topBarFlash.text, topBarFlash.tone);
    const timer = window.setTimeout(() => clearTopBarFlash(), 4000);
    return () => window.clearTimeout(timer);
  }, [topBarFlash, showFlash, clearTopBarFlash]);

  async function handleSave() {
    setBusy(true);
    clearFlash();
    try {
      await saveMyData(SAVE_FILENAME);
      showFlash(`Downloaded ${SAVE_FILENAME}`, 'good');
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
      className="h-14 shrink-0 flex items-center justify-between gap-3 px-4 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {onMenuToggle && (
          <button className="btn btn-icon lg:hidden" onClick={onMenuToggle} aria-label="Open menu">
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

      <div className="flex items-center gap-2">
        {flash && (
          <span
            className="text-xs max-w-[14rem] truncate"
            style={{ color: flash.tone === 'good' ? 'var(--good-fg)' : flash.tone === 'danger' ? 'var(--danger-fg)' : 'var(--warn-fg)' }}
            title={flash.text}
          >
            {flash.text}
          </span>
        )}

        {/* Primary, always-visible persistence (works on file://). */}
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void handleSave()}
          title={`Download a backup of all your data (${SAVE_FILENAME})`}
        >
          <IconSave /> Save my data
        </button>
        <button
          className="btn"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          title="Load your data back from a saved file"
        >
          <IconFolder /> Load my data
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
            className="flex items-center gap-1 pl-2 ml-1 border-l"
            style={{ borderColor: 'var(--border)' }}
            title="Advanced: silent autosave to a file you choose (requires the localhost launcher)"
          >
            <button
              className="btn text-xs"
              disabled={busy}
              onClick={() => void runFsa(openExistingFile, 'Open')}
              title="Advanced: open an existing .accdata file with autosave"
            >
              Open
            </button>
            <button
              className="btn text-xs"
              disabled={busy}
              onClick={() => void runFsa(connectNewFile, 'Save to file')}
              title="Advanced: choose a file to autosave into"
            >
              {status.hasFileHandle ? 'Save As…' : 'Save to file…'}
            </button>
          </div>
        )}

        <button className="btn btn-icon" onClick={lock} title="Lock the app">
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
