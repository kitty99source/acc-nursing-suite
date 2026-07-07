import { useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { useConfirm } from './useConfirm';
import { readFileAsText } from '../lib/storage';

export function RecoveryModal() {
  const recovery = useStore((s) => s.recovery);
  const settings = useStore((s) => s.data.settings);
  const resolveRecoveryEmpty = useStore((s) => s.resolveRecoveryEmpty);
  const resolveRecoverySample = useStore((s) => s.resolveRecoverySample);
  const resolveRecoveryFromAccdata = useStore((s) => s.resolveRecoveryFromAccdata);
  const resolveRecoveryFromZip = useStore((s) => s.resolveRecoveryFromZip);
  const [confirm, confirmDialog] = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const accdataInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);

  if (!recovery) return null;

  async function handleAccdata(file: File) {
    setBusy(true);
    setError('');
    try {
      const text = await readFileAsText(file);
      await resolveRecoveryFromAccdata(text);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (accdataInput.current) accdataInput.current.value = '';
    }
  }

  async function handleZip(file: File) {
    setBusy(true);
    setError('');
    try {
      await resolveRecoveryFromZip(file);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (zipInput.current) zipInput.current.value = '';
    }
  }

  async function handleEmpty() {
    const ok = await confirm({
      title: 'Start with empty data?',
      message: 'Your corrupt browser working copy will be cleared. Any .accdata file on disk is untouched.',
      confirmLabel: 'Start empty',
      destructive: true,
    });
    if (ok) {
      setBusy(true);
      try {
        await resolveRecoveryEmpty();
      } finally {
        setBusy(false);
      }
    }
  }

  async function handleSample() {
    const ok = await confirm({
      title: 'Load sample data?',
      message: 'For development/demo only. Replaces the corrupt working copy with bundled sample patients.',
      confirmLabel: 'Load sample',
    });
    if (ok) {
      setBusy(true);
      try {
        await resolveRecoverySample();
      } finally {
        setBusy(false);
      }
    }
  }

  return (
    <>
      <Modal
        open
        title="Data recovery required"
        onClose={() => {}}
        size="lg"
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => zipInput.current?.click()}>
              Restore from ZIP
            </button>
            <button className="btn" disabled={busy} onClick={() => accdataInput.current?.click()}>
              Restore from .accdata
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => void handleEmpty()}>
              Start empty
            </button>
            {settings.productionMode === false && (
              <button className="btn" disabled={busy} onClick={() => void handleSample()}>
                Load sample (dev)
              </button>
            )}
          </>
        }
      >
        <p className="text-sm mb-3" style={{ color: 'var(--danger-fg)' }}>
          Your browser&apos;s saved working copy could not be read. Your data was <strong>not</strong> replaced
          automatically.
        </p>
        <p className="text-sm mb-3" style={{ color: 'var(--muted)' }}>
          {recovery.error}
        </p>
        <ul className="text-sm space-y-2 list-disc pl-5 mb-3" style={{ color: 'var(--text)' }}>
          <li>
            If you have a <span className="font-mono">.accdata</span> backup, use <strong>Restore from .accdata</strong>{' '}
            (TopBar → Save my data creates these).
          </li>
          <li>
            For a full archive with PDF attachments, use <strong>Restore from ZIP</strong> (Export Center → Full backup).
          </li>
          <li>
            <strong>Start empty</strong> clears only this browser&apos;s corrupt copy — disk backups are safe.
          </li>
        </ul>
        {recovery.integrityWarnings && recovery.integrityWarnings.length > 0 && (
          <div className="text-xs p-3 rounded mb-3" style={{ background: 'var(--surface-2)', color: 'var(--warn-fg)' }}>
            <p className="font-semibold mb-1">Integrity warnings ({recovery.integrityWarnings.length})</p>
            <ul className="list-disc pl-4 max-h-24 overflow-y-auto">
              {recovery.integrityWarnings.slice(0, 10).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <p className="text-sm font-medium" style={{ color: 'var(--danger-fg)' }}>
            {error}
          </p>
        )}
        <input
          ref={accdataInput}
          type="file"
          accept=".accdata,.json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleAccdata(f);
          }}
        />
        <input
          ref={zipInput}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleZip(f);
          }}
        />
      </Modal>
      {confirmDialog}
    </>
  );
}
