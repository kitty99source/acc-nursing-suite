import { useStore } from '../state/store';
import { AssumptionBanner } from './AssumptionBanner';

/**
 * Explains the case-workflow assumptions:
 * - Nurse follow-up uses N calendar days (default 7).
 * - ACC follow-up uses N working days (default 10) — Mon-Fri only,
 *   NZ public holidays are NOT accounted for in v1.
 * - Every memo opens a new case; user must pick renew vs new claim.
 */
export function CaseWorkflowBanner() {
  const dismissed = useStore((s) => s.data.settings.caseWorkflowBannerDismissed);
  const nurseDays = useStore((s) => s.data.settings.nurseFollowUpDays);
  const accWorkingDays = useStore((s) => s.data.settings.accFollowUpWorkingDays);
  const updateSettings = useStore((s) => s.updateSettings);
  if (dismissed) return null;

  return (
    <AssumptionBanner
      title="Confirm case-workflow SLAs."
      onDismiss={() => updateSettings({ caseWorkflowBannerDismissed: true })}
    >
      Nurse docs are due back <strong>{nurseDays}</strong> calendar days after a memo; ACC responses
      are due <strong>{accWorkingDays}</strong> working days after submission (Mon-Fri only; NZ
      public holidays are not accounted for in v1). Every memo opens a new case — you must pick
      renew this claim or start a new claim approval. Change the follow-up windows in Settings.
    </AssumptionBanner>
  );
}
