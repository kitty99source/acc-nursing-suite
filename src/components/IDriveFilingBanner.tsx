import { useStore } from '../state/store';
import { AssumptionBanner } from './AssumptionBanner';

/**
 * Surfaces I-drive `_Staging` writeback as an open assumption until confirmed.
 */
export function IDriveFilingBanner() {
  const dismissed = useStore((s) => s.data.settings.iDriveFilingBannerDismissed);
  const staging = useStore((s) => s.data.settings.iDriveStagingSubfolder) || '_Staging';
  const updateSettings = useStore((s) => s.updateSettings);
  if (dismissed) return null;

  return (
    <AssumptionBanner
      title="Confirm I-drive staging."
      onDismiss={() => updateSettings({ iDriveFilingBannerDismissed: true })}
    >
      Optional Accept writeback lands under <span className="font-mono">{staging}</span> that mirrors
      District Nursing <span className="font-mono">Letters\…</span> or{' '}
      <span className="font-mono">Approval Requests\…</span> paths (by document kind) — not the live
      archive. Moving files into the live tree stays a manual Explorer step.
    </AssumptionBanner>
  );
}
