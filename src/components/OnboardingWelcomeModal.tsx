import { Modal } from './Modal';
import { isSampleData } from '../lib/sampleData';
import type { AppData } from '../types';

/**
 * Slim first-run welcome (md). Replaces auto-opening the Help Center FAQ/guide wall.
 * See docs/onboarding-plan.md.
 */
export function OnboardingWelcomeModal({
  open,
  data,
  onExplore,
  onClearAndImport,
  onOpenHelp,
  onClose,
}: {
  open: boolean;
  data: AppData;
  onExplore: () => void;
  onClearAndImport: () => void;
  onOpenHelp: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const sample = isSampleData(data);

  return (
    <Modal open title="Welcome to ACC District Nursing Admin Suite" onClose={onClose} size="md" footer={null}>
      <div className="space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
          File ACC letters, track NS04/NS05 approvals, and chase billing — offline on this PC. Help stays
          in the top bar when you want it — no FAQ wall on day one.
        </p>

        {sample ? (
          <p
            className="text-sm rounded-card px-3 py-2"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            <strong style={{ color: 'var(--text)' }}>Demo data is loaded</strong> — synthetic patients,
            claims, and approvals. Explore freely, then clear before real ACC letters.
          </p>
        ) : (
          <p
            className="text-sm rounded-card px-3 py-2"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--muted)' }}
          >
            Start in Review Queue (accept letters), then Approvals for NS04/NS05 periods. Drop a PDF/Word
            letter anywhere, or use ACC Inbox sync when the helper is up.
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <button type="button" className="btn btn-primary flex-1" onClick={onExplore} autoFocus>
            Explore the demo
          </button>
          <button type="button" className="btn flex-1" onClick={onClearAndImport}>
            {sample ? 'Clear sample & import' : 'Open Review Queue'}
          </button>
        </div>

        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          Deep help anytime:{' '}
          <button
            type="button"
            className="underline font-semibold"
            style={{ color: 'var(--accent)' }}
            onClick={onOpenHelp}
          >
            Open the guide
          </button>
          {' '}
          (also Help in the top bar). Helper Mode (?) adds hover tips.
        </p>
      </div>
    </Modal>
  );
}
