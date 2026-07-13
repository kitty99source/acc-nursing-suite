import { useStore } from '../state/store';
import { AssumptionBanner } from './AssumptionBanner';

/**
 * Remittance-stale threshold is a sensible default until billing confirms how
 * long an invoice may sit in Remittance before it needs attention.
 */
export function RemittanceStaleBanner() {
  const dismissed = useStore((s) => s.data.settings.remittanceStaleBannerDismissed);
  const days = useStore((s) => s.data.settings.remittanceStaleDays);
  const updateSettings = useStore((s) => s.updateSettings);
  if (dismissed) return null;

  return (
    <AssumptionBanner
      title="Confirm remittance stale days."
      onDismiss={() => updateSettings({ remittanceStaleBannerDismissed: true })}
    >
      Invoices in Remittance status surface in the action queue after{' '}
      <strong>{days}</strong> days (Settings → Thresholds). Change that number if
      your office uses a different follow-up window.
    </AssumptionBanner>
  );
}
