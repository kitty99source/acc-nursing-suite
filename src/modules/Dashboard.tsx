import { useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  CartesianGrid,
} from 'recharts';
import { useStore } from '../state/store';
import { SectionTitle, Card, StatCard, Badge, EmptyState } from '../components/ui';
import { IconWarning, IconDashboard } from '../components/icons';
import type { ModuleId } from '../components/Sidebar';
import {
  dashboardMetrics,
  buildActionQueue,
  computeApproval,
  capActionQueueForDisplay,
  ACTION_QUEUE_DISPLAY_CAP,
  memoStats,
} from '../lib/analytics';
import { complianceSummary } from '../lib/compliance';
import { getComplianceFindings } from '../lib/complianceCache';
import { buildDataIndexes } from '../lib/indexes';
import { formatCurrency } from '../lib/serviceCodes';
import { formatDate } from '../lib/format';
import { loadStagingItems } from '../lib/staging';
import { fetchLocalEmailSyncStatus, formatSyncOutcome, type EmailSyncStatus } from '../lib/emailSyncStatus';
import { LetterImportButton, LETTER_IMPORT_FULL_TOOLTIP } from '../components/LetterImportButton';
import { HelperTip } from '../components/HelperTip';

function useThemeColors() {
  const settings = useStore((s) => s.data.settings);
  const [colors, setColors] = useState({
    accent: '#2f8f83',
    text: '#1f2d33',
    muted: '#5f7079',
    border: '#d7e0e4',
    good: '#2c5e22',
    salmon: '#8a2f25',
    warn: '#8a5a12',
    surface: '#ffffff',
  });
  useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (v: string, fb: string) => cs.getPropertyValue(v).trim() || fb;
    setColors({
      accent: read('--accent', '#2f8f83'),
      text: read('--text', '#1f2d33'),
      muted: read('--muted', '#5f7079'),
      border: read('--border', '#d7e0e4'),
      good: read('--good-fg', '#2c5e22'),
      salmon: read('--salmon-fg', '#8a2f25'),
      warn: read('--warn-fg', '#8a5a12'),
      surface: read('--surface', '#ffffff'),
    });
  }, [settings.theme, settings.accentColor]);
  return colors;
}

export function Dashboard({ onNavigate }: { onNavigate: (id: ModuleId) => void }) {
  const data = useStore((s) => s.data);
  const settings = data.settings;
  const updateSettings = useStore((s) => s.updateSettings);
  const setFocus = useStore((s) => s.setFocus);
  const colors = useThemeColors();
  const indexes = useMemo(() => buildDataIndexes(data), [data]);
  const m = useMemo(() => dashboardMetrics(data, indexes), [data, indexes]);
  const findings = useMemo(() => getComplianceFindings(data), [data]);
  const allActions = useMemo(() => buildActionQueue(data, findings), [data, findings]);
  const [includeBillingInQueue, setIncludeBillingInQueue] = useState(false);
  const actions = useMemo(
    () => (includeBillingInQueue ? allActions : buildActionQueue(data, findings, { includeBilling: false })),
    [includeBillingInQueue, allActions, data, findings],
  );
  const displayActions = useMemo(() => capActionQueueForDisplay(actions), [actions]);
  const compliance = useMemo(() => complianceSummary(findings), [findings]);
  const topFindings = useMemo(() => findings.slice(0, 6), [findings]);
  const memos = useMemo(() => memoStats(data), [data]);
  const billingNeedsReview = useMemo(() => data.invoiceLines.filter((l) => l.needsReview).length, [data.invoiceLines]);

  // Daily triage signals: HRQ pending count + email-sync freshness (read-only,
  // via existing exports — no live-data writes from the dashboard).
  const [reviewPending, setReviewPending] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<EmailSyncStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadStagingItems().then((items) => {
      if (!cancelled) setReviewPending(items.length);
    });
    void fetchLocalEmailSyncStatus().then((status) => {
      if (!cancelled) setSyncStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isEmpty =
    data.patients.length === 0 &&
    data.invoiceLines.length === 0 &&
    data.approvals.length === 0 &&
    data.complexCases.length === 0 &&
    data.declines.length === 0;

  if (isEmpty) {
    return (
      <div>
        <SectionTitle title="Dashboard" subtitle="Your action queue and billing analytics." />
        <EmptyState
          icon={<IconDashboard width={32} height={32} />}
          title="Nothing to show yet"
          message="Import an ACC letter to file your first patient, claim and approvals in one step — or add a patient manually."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <HelperTip tipId="tip-letter-import">
                <LetterImportButton
                  className="btn btn-primary"
                  opts={{ entryPoint: 'global' }}
                  title={LETTER_IMPORT_FULL_TOOLTIP}
                />
              </HelperTip>
              <button className="btn" onClick={() => onNavigate('patients')}>
                Add a patient manually
              </button>
              {reviewPending ? (
                <button className="btn" onClick={() => onNavigate('review')}>
                  Review Queue ({reviewPending} pending)
                </button>
              ) : null}
            </div>
          }
        />
      </div>
    );
  }

  const funnelData = [
    { name: 'Awaiting Billing', count: m.funnel.awaitingBilling.count, amount: m.funnel.awaitingBilling.amount },
    { name: 'Billed', count: m.funnel.billed.count, amount: m.funnel.billed.amount },
    { name: 'Remittance', count: m.funnel.remittance.count, amount: m.funnel.remittance.amount },
  ];
  const agingData = [
    { name: '0–30', amount: m.aging.b0_30 },
    { name: '31–60', amount: m.aging.b31_60 },
    { name: '61–90', amount: m.aging.b61_90 },
    { name: '90+', amount: m.aging.b90plus },
  ];

  const tooltipStyle = {
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 8,
    color: colors.text,
    fontSize: 12,
  };

  return (
    <div>
      <SectionTitle title="Dashboard" subtitle="Your action queue and billing analytics." />

      {!settings.dismissLetterDiscoverCard && (
        <Card className="mb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm flex-1 min-w-0">
              <strong>Received an ACC letter?</strong> Go to Patients → select a claim → Documents →{' '}
              <span className="font-medium">Import ACC letter (PDF or Word)</span> to file approvals and attach the letter in one step.
              See Settings → About for the full import routing guide.
            </p>
            <button
              type="button"
              className="btn btn-sm shrink-0"
              onClick={() => updateSettings({ dismissLetterDiscoverCard: true })}
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {/* Today's work — the daily letter-triage loop, before analytics. */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[14rem]">
            <h3 className="font-semibold text-sm">Today's work</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {reviewPending
                ? `${reviewPending} staged letter${reviewPending === 1 ? '' : 's'} waiting for your sign-off in the Review Queue.`
                : 'No staged letters waiting for sign-off.'}
              {syncStatus ? ` Email sync: ${formatSyncOutcome(syncStatus)}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {reviewPending ? (
              <button className="btn btn-primary btn-sm" onClick={() => onNavigate('review')}>
                Open Review Queue ({reviewPending})
              </button>
            ) : (
              <button className="btn btn-sm" onClick={() => onNavigate('review')}>
                Open Review Queue
              </button>
            )}
            <HelperTip tipId="tip-letter-import">
              <LetterImportButton opts={{ entryPoint: 'global' }} title={LETTER_IMPORT_FULL_TOOLTIP} />
            </HelperTip>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 mb-4 items-stretch lg:grid-cols-[repeat(7,minmax(0,1fr))]">
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('compliance')}>
          <StatCard
            label="Contract flags"
            value={compliance.violations}
            tone={compliance.violations ? 'danger' : compliance.warnings ? 'salmon' : 'good'}
            hint={`${compliance.warnings} warning(s) · ${compliance.predictive} heads-up`}
          />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('approvals')}>
          <StatCard
            label="Approvals expiring ≤30d"
            value={m.expiringApprovals.filter((x) => x.computed.status === 'Expiring Soon (<30 days)').length}
            tone="salmon"
            hint={`${m.expiringApprovals.filter((x) => x.computed.status === 'EXPIRED').length} already expired`}
          />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('approvals')}>
          <StatCard label="Coverage gaps" value={m.coverageGaps} tone={m.coverageGaps ? 'danger' : 'good'} hint="Active NS04/NS05 with no current PO" />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('billing')}>
          <StatCard label="Outstanding $" value={formatCurrency(m.outstandingTotal)} tone="warn" hint="Invoiced, not yet paid" />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('billing')}>
          <StatCard
            label="Billing needs review"
            value={billingNeedsReview}
            tone={billingNeedsReview ? 'danger' : 'good'}
            hint="Held/short-paid remittance lines"
          />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('complex')}>
          <StatCard label="Complex reviews due" value={m.complexDue} tone={m.complexDue ? 'salmon' : 'good'} />
        </button>
        <button className="clickable-card h-full min-w-0" onClick={() => onNavigate('patients')}>
          <StatCard
            label="Memos to nurses"
            value={memos.total}
            tone={memos.unresolved ? 'warn' : 'good'}
            hint={`${memos.sentThisWeek} this week · ${memos.unresolved} unresolved`}
          />
        </button>
      </div>

      {/* Action queue */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <IconWarning />
          <h3 className="font-semibold">Action queue</h3>
          <Badge tone={allActions.length ? 'salmon' : 'good'}>{allActions.length}</Badge>
        </div>
        {displayActions.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Nothing needs attention right now.
          </p>
        ) : (
          <>
            <div data-testid="action-queue" className="space-y-1.5 max-h-72 overflow-y-auto">
              {displayActions.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    const module =
                      a.kind === 'compliance'
                        ? 'compliance'
                        : a.kind === 'approval' || a.kind === 'coverage'
                          ? 'approvals'
                          : a.kind === 'billing'
                            ? 'billing'
                            : a.kind === 'decline'
                              ? 'declines'
                              : a.kind === 'nurse-followup' || a.kind === 'acc-followup'
                                ? 'patients'
                                : 'complex';
                    if (a.kind === 'compliance') {
                      setFocus({
                        module: 'patients',
                        patientId: a.patientId,
                        claimId: a.claimId,
                        complianceFilter: { severity: a.severity === 'danger' ? 'violation' : 'warning' },
                      });
                    } else if (a.patientId || a.claimId) {
                      const focusModule =
                        a.kind === 'approval' || a.kind === 'coverage'
                          ? 'approvals'
                          : a.kind === 'billing'
                            ? 'billing'
                            : 'patients';
                      let intent: string | undefined;
                      if (a.kind === 'billing') {
                        if (a.title.startsWith('Needs review')) intent = 'needs-review';
                        else if (a.title.startsWith('Stale remittance')) intent = 'stale-remittance';
                      }
                      setFocus({
                        module: focusModule,
                        patientId: a.patientId,
                        claimId: a.claimId,
                        intent,
                      });
                    }
                    onNavigate(module);
                  }}
                  className="action-row"
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ background: a.severity === 'danger' ? 'var(--danger-fg)' : 'var(--warn-fg)' }}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-medium truncate">{a.title}</span>
                    <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>
                      {a.detail}
                    </span>
                  </span>
                  <Badge tone={a.severity === 'danger' ? 'danger' : 'warn'}>{a.kind}</Badge>
                </button>
              ))}
            </div>
            {allActions.length > ACTION_QUEUE_DISPLAY_CAP && (
              <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                Showing top {ACTION_QUEUE_DISPLAY_CAP} of {allActions.length}.{' '}
                <button type="button" className="underline" onClick={() => onNavigate('compliance')}>
                  View all in Flagged
                </button>
                {!includeBillingInQueue && (
                  <>
                    {' · '}
                    <button type="button" className="underline" onClick={() => setIncludeBillingInQueue(true)}>
                      Include billing items
                    </button>
                  </>
                )}
              </p>
            )}
          </>
        )}
      </Card>

      {/* Contract compliance */}
      <Card className="mb-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Contract compliance</h3>
            <Badge tone={compliance.violations ? 'danger' : compliance.warnings ? 'salmon' : 'good'}>
              {compliance.total}
            </Badge>
          </div>
          <button className="btn btn-sm" onClick={() => onNavigate('compliance')}>
            Open Flagged page
          </button>
        </div>
        {topFindings.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No contract-compliance issues detected.
          </p>
        ) : (
          <div className="space-y-1.5">
            {topFindings.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setFocus({
                    module: 'patients',
                    patientId: f.patientId,
                    claimId: f.claimId,
                    complianceFilter: { severity: f.severity, ruleId: f.ruleId },
                  });
                  onNavigate('compliance');
                }}
                className="action-row"
              >
                <Badge tone={f.severity === 'violation' ? 'danger' : f.severity === 'warning' ? 'salmon' : 'accent'}>
                  {f.severity === 'violation' ? 'Violation' : f.severity === 'warning' ? 'Warning' : 'Heads-up'}
                </Badge>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium truncate">
                    {f.title} — {f.patientName}
                  </span>
                  <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>
                    {f.detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-4 mb-4">
        <Card>
          <h3 className="font-semibold mb-1">Billing status funnel</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Count and $ by status.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={funnelData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: colors.muted, fontSize: 12 }} />
              <YAxis tick={{ fill: colors.muted, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n) => (n === 'amount' ? formatCurrency(v) : v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: colors.muted }} />
              <Bar dataKey="count" name="Count" fill={colors.accent} radius={[4, 4, 0, 0]} />
              <Bar dataKey="amount" name="Amount" fill={colors.warn} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-semibold mb-1">Outstanding $ aging</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Unpaid invoiced amounts by age (days).
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={agingData}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: colors.muted, fontSize: 12 }} />
              <YAxis tick={{ fill: colors.muted, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="amount" name="Outstanding" fill={colors.salmon} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-semibold mb-1">Invoiced vs Paid by month</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Current year.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={m.monthly}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: colors.muted, fontSize: 11 }} />
              <YAxis tick={{ fill: colors.muted, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="invoiced" name="Invoiced" stroke={colors.accent} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="paid" name="Paid" stroke={colors.good} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <h3 className="font-semibold mb-1">Revenue by service group</h3>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Invoiced vs paid.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={m.revenue}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="group" tick={{ fill: colors.muted, fontSize: 11 }} />
              <YAxis tick={{ fill: colors.muted, fontSize: 12 }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="invoiced" name="Invoiced" fill={colors.accent} radius={[4, 4, 0, 0]} />
              <Bar dataKey="paid" name="Paid" fill={colors.good} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Watch lists */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="font-semibold mb-3">Approvals needing attention</h3>
          {m.expiringApprovals.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              All approvals are comfortably current.
            </p>
          ) : (
            <div className="space-y-1.5">
              {m.expiringApprovals.slice(0, 8).map(({ approval, computed }) => {
                const patient = data.patients.find((p) => p.id === approval.patientId);
                return (
                  <div key={approval.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">
                      {patient?.name ?? approval.poNumber}{' '}
                      <Badge tone="accent">{approval.serviceCode}</Badge>
                    </span>
                    <span className="shrink-0">
                      {computed.status === 'EXPIRED' ? (
                        <Badge tone="danger">EXPIRED</Badge>
                      ) : (
                        <Badge tone="salmon">{computed.daysUntilExpiry}d</Badge>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Limits &amp; reviews</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="font-medium mb-1">NS04 nearing approved limit (≥80%)</div>
              {m.ns04NearLimit.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  None.
                </p>
              ) : (
                m.ns04NearLimit.map(({ approval, pct }) => {
                  const p = data.patients.find((x) => x.id === approval.patientId);
                  return (
                    <div key={approval.id} className="flex items-center justify-between">
                      <span className="truncate">{p?.name ?? approval.poNumber}</span>
                      <Badge tone="salmon">{Math.round(pct)}%</Badge>
                    </div>
                  );
                })
              )}
            </div>
            <div>
              <div className="font-medium mb-1">NS05 annual review / expiry</div>
              {m.ns05AnnualReview.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  None due.
                </p>
              ) : (
                m.ns05AnnualReview.map(({ approval, computed }) => {
                  const p = data.patients.find((x) => x.id === approval.patientId);
                  return (
                    <div key={approval.id} className="flex items-center justify-between">
                      <span className="truncate">{p?.name ?? approval.poNumber}</span>
                      <Badge tone={computed.status === 'EXPIRED' ? 'danger' : 'salmon'}>
                        {computed.status === 'EXPIRED' ? 'EXPIRED' : `${computed.daysUntilExpiry}d`}
                      </Badge>
                    </div>
                  );
                })
              )}
            </div>
            <div>
              <div className="font-medium mb-1">NS06 approaching 50-treatment cap</div>
              {m.ns06NearCap.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  None.
                </p>
              ) : (
                m.ns06NearCap.map((x) => (
                  <div key={x.claimNumber + x.patientName} className="flex items-center justify-between">
                    <span className="truncate">{x.patientName || x.claimNumber}</span>
                    <Badge tone="salmon">{x.count}</Badge>
                  </div>
                ))
              )}
            </div>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Declines</h3>
          <div className="text-sm space-y-2">
            <div className="flex items-center justify-between">
              <span style={{ color: 'var(--muted)' }}>Average turnaround</span>
              <span className="font-semibold">
                {m.declineAvgTurnaround == null ? '—' : `${m.declineAvgTurnaround} days`}
              </span>
            </div>
            {Object.keys(m.openDeclinesByStage).length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                No open declines.
              </p>
            ) : (
              Object.entries(m.openDeclinesByStage).map(([stage, count]) => (
                <div key={stage} className="flex items-center justify-between">
                  <span className="truncate">{stage}</span>
                  <Badge tone="warn">{count}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold mb-3">Coverage &amp; recent approvals</h3>
          <div className="text-sm space-y-1.5">
            {data.approvals.slice(0, 6).map((a) => {
              const p = data.patients.find((x) => x.id === a.patientId);
              const c = computeApproval(a, data.settings.expiryThresholdDays);
              return (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {p?.name ?? a.poNumber} · {formatDate(a.approvalEndDate)}
                  </span>
                  <Badge tone={c.status === 'Active' ? 'good' : c.status === 'EXPIRED' ? 'danger' : 'salmon'}>
                    {c.status === 'Active' ? 'Active' : c.status === 'EXPIRED' ? 'Expired' : 'Soon'}
                  </Badge>
                </div>
              );
            })}
            {data.approvals.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                No approvals recorded.
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
