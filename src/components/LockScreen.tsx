import { useState } from 'react';
import { useStore } from '../state/store';
import { IconLock } from './icons';

export function LockScreen() {
  const needsPassphrase = useStore((s) => s.needsPassphrase);
  const unlock = useStore((s) => s.unlock);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    setBusy(true);
    setError('');
    const ok = await unlock(needsPassphrase ? passphrase : undefined);
    setBusy(false);
    if (!ok) {
      setError('Incorrect passphrase. Please try again.');
      setPassphrase('');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'var(--bg)' }}
    >
      <div className="card p-8 w-full max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-full mx-auto flex items-center justify-center mb-4"
          style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
        >
          <IconLock width={26} height={26} />
        </div>
        <h1 className="text-lg font-bold">ACC District Nursing Admin Suite</h1>
        <p className="text-sm mt-1 mb-5" style={{ color: 'var(--muted)' }}>
          {needsPassphrase
            ? 'This data is encrypted. Enter your passphrase to unlock.'
            : 'The app is locked due to inactivity.'}
        </p>

        {needsPassphrase && (
          <input
            type="password"
            className="input mb-3"
            placeholder="Passphrase"
            value={passphrase}
            autoFocus
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleUnlock();
            }}
          />
        )}

        {error && (
          <p className="text-sm mb-3 font-medium" style={{ color: 'var(--danger-fg)' }}>
            {error}
          </p>
        )}

        <button
          className="btn btn-primary w-full"
          disabled={busy || (needsPassphrase && !passphrase)}
          onClick={() => void handleUnlock()}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
    </div>
  );
}
