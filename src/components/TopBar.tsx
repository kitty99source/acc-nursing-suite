import { useState } from 'react';
import { useStore } from '../state/store';
import { IconSave, IconFolder, IconLock } from './icons';
import { formatDate } from '../lib/format';

function SaveIndicator() {
  const status = useStore((s) => s.status);
  const map = {
    idle: { text: 'Not saved yet', color: 'var(--muted)' },
    saving: { text: 'Saving…', color: 'var(--muted)' },
    saved: { text: 'All changes saved', color: 'var(--good-fg)' },
    error: { text: `Save error`, color: 'var(--danger-fg)' },
  } as const;
  const s = map[status.saveState];
  return (
    <span className="text-xs flex items-center gap-1.5" style={{ color: s.color }} title={status.saveError}>
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{ background: status.saveState === 'saved' ? 'var(--good-fg)' : status.saveState === 'error' ? 'var(--danger-fg)' : 'var(--muted)' }}
      />
      {s.text}
    </span>
  );
}

export function TopBar() {
  const status = useStore((s) => s.status);
  const connectNewFile = useStore((s) => s.connectNewFile);
  const openExistingFile = useStore((s) => s.openExistingFile);
  const saveNow = useStore((s) => s.saveNow);
  const lock = useStore((s) => s.lock);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>('');

  async function run(fn: () => Promise<void>, label: string) {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (err) {
      const e = err as Error;
      if (e.name !== 'AbortError') setMsg(`${label}: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header
      className="h-14 shrink-0 flex items-center justify-between gap-3 px-4 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {status.fileName ? status.fileName : 'No data file connected'}
          </div>
          <div className="text-xs flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <SaveIndicator />
            {status.lastSavedAt && (
              <span>· {new Date(status.lastSavedAt).toLocaleTimeString('en-NZ')}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {msg && (
          <span className="text-xs max-w-xs truncate" style={{ color: 'var(--danger-fg)' }} title={msg}>
            {msg}
          </span>
        )}
        {status.fsaSupported ? (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(openExistingFile, 'Open')}
              title="Open an existing .accdata file"
            >
              <IconFolder /> Open
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(connectNewFile, 'Save to file')}
              title="Choose where to save your .accdata file (autosave will keep it updated)"
            >
              <IconSave /> {status.hasFileHandle ? 'Save As…' : 'Save to file…'}
            </button>
          </>
        ) : (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Use Export Center for backups
          </span>
        )}
        <button className="btn" disabled={busy} onClick={() => run(saveNow, 'Save')} title="Save now">
          Save now
        </button>
        <button className="btn btn-ghost" onClick={lock} title="Lock the app">
          <IconLock />
        </button>
      </div>
    </header>
  );
}

export function lastSavedLabel(ts?: number): string {
  return ts ? formatDate(new Date(ts).toISOString().slice(0, 10)) : '';
}
