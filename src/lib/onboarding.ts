// ============================================================================
// First-run onboarding helpers — progressive disclosure checklist (not Help/FAQ).
// See docs/onboarding-plan.md.
// ============================================================================

import type { AppData } from '../types';
import { isSampleData } from './sampleData';

export type OnboardingStepId = 'review-accept' | 'approvals-patients' | 'real-work';

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  body: string;
  done: boolean;
  /** Module to navigate to when the user activates this step. */
  moduleId: 'review' | 'patients' | 'approvals' | 'accinbox' | 'dashboard';
  actionLabel: string;
}

export function shouldShowGettingStarted(settings: {
  gettingStartedDismissed: boolean;
}): boolean {
  return !settings.gettingStartedDismissed;
}

/** Single-persona checklist — max 3 items (AdminSuite has no manager/staff split). */
export function gettingStartedSteps(data: AppData): OnboardingStep[] {
  const sample = isSampleData(data);
  // While the in-app sample pack is loaded, treat “real work” as incomplete even if
  // some synthetic invoice ids omit the word “sample” (e.g. inv_ns06_* demos).
  const realWorkDone =
    !sample &&
    (data.patients.some((p) => !p.id.startsWith('p_sample_')) ||
      data.approvals.some((a) => !a.id.startsWith('ap_sample_')) ||
      data.invoiceLines.some((l) => !l.id.startsWith('inv_sample_') && !l.id.startsWith('inv_ns06_')));

  return [
    {
      id: 'review-accept',
      title: 'Open Review Queue',
      body: 'Accept staged ACC letters onto a patient and claim (HRQ — Human Review Queue).',
      done: data.approvals.length > 0 || data.documents.length > 0 || data.claims.length > 0,
      moduleId: 'review',
      actionLabel: 'Review Queue',
    },
    {
      id: 'approvals-patients',
      title: 'Check Patients & Approvals',
      body: 'NS04/NS05 periods, expiry, and case notes live on Patients and Approvals.',
      done: data.approvals.length > 0 || data.patients.length > 0,
      moduleId: 'approvals',
      actionLabel: 'Approvals',
    },
    {
      id: 'real-work',
      title: sample ? 'Ready for real letters?' : 'Sync ACC Inbox or import a letter',
      body: sample
        ? 'Clear sample data, then use ACC Inbox sync or drop an ACC letter (PDF/Word) to file a real case.'
        : 'Refresh ACC Inbox, or import an ACC letter from the Dashboard / drag-and-drop.',
      done: realWorkDone,
      moduleId: 'accinbox',
      actionLabel: sample ? 'Clear & import' : 'ACC Inbox',
    },
  ];
}
