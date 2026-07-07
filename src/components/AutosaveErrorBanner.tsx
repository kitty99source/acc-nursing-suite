import { useStore } from '../state/store';

/** Persistent banner when IndexedDB autosave fails (P3-002). */
export function AutosaveErrorBanner() {
  const saveError = useStore((s) => s.status.saveError);
  const saveNow = useStore((s) => s.saveNow);

  if (!saveError) return null;

  return (
    <div
      className="shrink-0 px-4 py-2 flex flex-wrap items-center justify-between gap-2 border-b text-sm"
      style={{
        background: 'var(--danger-bg, rgba(180,60,60,0.12))',
        borderColor: 'var(--danger-fg)',
        color: 'var(--danger-fg)',
      }}
      role="alert"
    >
      <span>
        <strong>Autosave failed:</strong> {saveError}. Export to .accdata soon — local changes may be lost if the browser storage is full.
      </span>
      <button type="button" className="btn btn-sm" onClick={() => void saveNow()}>
        Retry save
      </button>
    </div>
  );
}
