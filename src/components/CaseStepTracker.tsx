import type { CaseStage } from '../types';
import { CASE_STAGE_LABEL, isTerminalStage } from '../lib/caseWorkflow';

// The stages we actually walk through in the tracker (approved/declined
// display as the terminal marker for the pipeline row; closed is separate).
const PIPELINE: CaseStage[] = [
  'not_started',
  'awaiting_nurse_docs',
  'docs_received',
  'awaiting_acc',
];

/**
 * A compact horizontal step tracker for a claim's case stage. Shows the
 * ordered pipeline plus a terminal marker when the case has reached a final
 * decision. Purely visual — no click handlers; callers wire up actions.
 */
export function CaseStepTracker({
  stage,
  compact,
}: {
  stage: CaseStage | undefined;
  compact?: boolean;
}) {
  const current = stage ?? 'not_started';
  const currentIdx = PIPELINE.indexOf(current);
  const returned = current === 'docs_returned';
  const terminal = isTerminalStage(current) ? current : undefined;

  // "docs_returned" is a side-loop off "docs_received" — visualise it as a
  // shaded overlay on the docs_received bubble so the pipeline stays linear.
  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${compact ? 'text-xs' : 'text-sm'}`}
      aria-label={`Case stage: ${CASE_STAGE_LABEL[current]}`}
    >
      {PIPELINE.map((s, i) => {
        const reached = currentIdx >= i || terminal !== undefined;
        const isCurrent = current === s;
        const isDocsReceived = s === 'docs_received';
        const bg = isCurrent
          ? 'var(--accent)'
          : reached
            ? 'var(--accent-soft)'
            : 'var(--surface-2)';
        const color = isCurrent
          ? 'var(--accent-fg, #fff)'
          : reached
            ? 'var(--accent)'
            : 'var(--muted)';
        return (
          <div key={s} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 ${compact ? '' : 'px-2.5'}`}
              style={{ background: bg, color, whiteSpace: 'nowrap' }}
              title={
                isDocsReceived && returned
                  ? `${CASE_STAGE_LABEL['docs_received']} — currently returned for correction`
                  : CASE_STAGE_LABEL[s]
              }
            >
              {i + 1}. {CASE_STAGE_LABEL[s]}
              {isDocsReceived && returned ? ' ↩' : ''}
            </span>
            {i < PIPELINE.length - 1 && (
              <span aria-hidden style={{ color: 'var(--muted)' }}>
                →
              </span>
            )}
          </div>
        );
      })}
      {terminal && (
        <>
          <span aria-hidden style={{ color: 'var(--muted)' }}>
            →
          </span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${compact ? '' : 'px-2.5'}`}
            style={{
              background:
                terminal === 'approved'
                  ? 'var(--good)'
                  : terminal === 'declined'
                    ? 'var(--danger)'
                    : 'var(--surface-2)',
              color:
                terminal === 'approved'
                  ? 'var(--good-fg)'
                  : terminal === 'declined'
                    ? 'var(--danger-fg)'
                    : 'var(--muted)',
            }}
          >
            {CASE_STAGE_LABEL[terminal]}
          </span>
        </>
      )}
    </div>
  );
}
