import { Modal } from './Modal';
import { saveBackupSnoozeUntil } from '../lib/idb';

const SNOOZE_MS = 24 * 60 * 60 * 1000;

export function BackupReminderModal({
  open,
  daysSinceExport,
  onGoToExport,
  onDismiss,
}: {
  open: boolean;
  daysSinceExport: number;
  onGoToExport: () => void;
  onDismiss: () => void;
}) {
  if (!open) return null;

  return (
    <Modal
      open
      title="Backup reminder"
      onClose={onDismiss}
      size="sm"
      footer={
        <>
          <button
            className="btn"
            onClick={() => {
              void saveBackupSnoozeUntil(Date.now() + SNOOZE_MS);
              onDismiss();
            }}
          >
            Remind me tomorrow
          </button>
          <button className="btn btn-primary" onClick={onGoToExport}>
            Open Export Center
          </button>
        </>
      }
    >
      <p className="text-sm" style={{ color: 'var(--text)' }}>
        It has been <strong>{daysSinceExport} days</strong> since you exported a{' '}
        <span className="font-mono">.accdata</span> backup. IndexedDB autosave protects against browser crashes, but
        not disk wipes or new PCs — export regularly.
      </p>
      <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
        Use <strong>Save my data</strong> in the top bar, or export a full ZIP from Export Center.
      </p>
    </Modal>
  );
}
