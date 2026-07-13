import { useStore } from '../state/store';
import { AssumptionBanner } from './AssumptionBanner';

/**
 * Surfaces the seeded ACC Inbox sender allowlist / subject patterns as an
 * open assumption until a coworker confirms them in Settings.
 */
export function AccInboxConfigBanner() {
  const dismissed = useStore((s) => s.data.settings.accInboxConfigBannerDismissed);
  const updateSettings = useStore((s) => s.updateSettings);
  if (dismissed) return null;

  return (
    <AssumptionBanner
      title="Confirm ACC Inbox filters."
      onDismiss={() => updateSettings({ accInboxConfigBannerDismissed: true })}
    >
      Sender allowlist and subject patterns in Settings were seeded from office
      defaults — confirm they match the live ACCDistrictNursing mailbox before
      relying on sync triage.
    </AssumptionBanner>
  );
}
