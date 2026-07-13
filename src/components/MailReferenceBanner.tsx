import { useStore } from '../state/store';
import { AssumptionBanner } from './AssumptionBanner';

/** Reminder that the Mail Reference Sheet was seeded from the 2024 PDF and may need edits. */
export function MailReferenceBanner() {
  const dismissed = useStore((s) => s.data.settings.mailReferenceBannerDismissed);
  const updateSettings = useStore((s) => s.updateSettings);

  if (dismissed) return null;

  return (
    <AssumptionBanner
      title="Mail Reference Sheet seeded from the 2024 PDF."
      onDismiss={() => updateSettings({ mailReferenceBannerDismissed: true })}
    >
      Rows come from Mail Reference Sheet 2024.pdf under Team Processes. Addresses and handoffs may
      have changed since — edit any row that is out of date in the Mail Reference module.
    </AssumptionBanner>
  );
}
