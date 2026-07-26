import { useStore } from '../state/store';
import { gettingStartedSteps, shouldShowGettingStarted, type OnboardingStep } from '../lib/onboarding';
import { isSampleData } from '../lib/sampleData';
import type { ModuleId } from './Sidebar';
import { Card } from './ui';

/**
 * Dismissible progressive checklist on Dashboard until dismissed.
 * Not the Help Center.
 */
export function GettingStartedCard({
  onNavigate,
}: {
  onNavigate: (id: ModuleId) => void;
}) {
  const data = useStore((s) => s.data);
  const updateSettings = useStore((s) => s.updateSettings);
  const clearSampleData = useStore((s) => s.clearSampleData);

  if (!shouldShowGettingStarted(data.settings)) return null;

  const steps = gettingStartedSteps(data);
  const sample = isSampleData(data);

  function dismiss() {
    updateSettings({ gettingStartedDismissed: true });
  }

  function runStep(step: OnboardingStep) {
    if (step.id === 'real-work' && sample) {
      clearSampleData();
      onNavigate('review');
      return;
    }
    if (step.moduleId === 'dashboard') return;
    onNavigate(step.moduleId);
  }

  return (
    <Card className="getting-started-card mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="card-title mb-0.5" style={{ color: 'var(--accent)' }}>
            Getting started
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Three short steps — dismiss anytime. Deep FAQ stays under Help.
          </p>
        </div>
        <button type="button" className="btn btn-sm shrink-0" onClick={dismiss}>
          Dismiss
        </button>
      </div>

      <ol className="space-y-2 list-none p-0 m-0">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="flex flex-wrap items-start gap-2 rounded-card px-3 py-2"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
          >
            <span
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
              style={{
                background: step.done ? 'var(--good-bg, #e8f5e4)' : 'var(--surface-2, var(--surface))',
                color: step.done ? 'var(--good-fg)' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
              aria-hidden
            >
              {step.done ? '✓' : index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                {step.title}
                {step.done && <span className="sr-only"> (done)</span>}
              </div>
              <p className="text-xs mt-0.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
                {step.body}
              </p>
            </div>
            <button type="button" className="btn btn-sm shrink-0" onClick={() => runStep(step)}>
              {step.actionLabel}
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}
