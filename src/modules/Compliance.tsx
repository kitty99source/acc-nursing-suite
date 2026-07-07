import { useMemo, useState, useEffect } from 'react';
import { useStore } from '../state/store';
import { SectionTitle, Card, Badge, Select, EmptyState, StatCard } from '../components/ui';
import { IconShield } from '../components/icons';
import { LetterImportButton, LETTER_IMPORT_FULL_TOOLTIP } from '../components/LetterImportButton';
import {
  complianceSummary,
  COMPLIANCE_RULES,
  type ComplianceFinding,
  type FindingSeverity,
  type FixIntent,
} from '../lib/compliance';
import { getComplianceFindings } from '../lib/complianceCache';
import { COMPLIANCE_GROUP_DISPLAY_CAP } from '../lib/analytics';

const SEVERITY_META: Record<FindingSeverity, { label: string; tone: 'danger' | 'salmon' | 'accent' }> = {
  violation: { label: 'Violation', tone: 'danger' },
  warning: { label: 'Warning', tone: 'salmon' },
  predictive: { label: 'Heads-up', tone: 'accent' },
};

export function Compliance() {
  const data = useStore((s) => s.data);
  const setFocus = useStore((s) => s.setFocus);
  const focus = useStore((s) => s.focus);
  const clearFocus = useStore((s) => s.clearFocus);

  const [severity, setSeverity] = useState<'all' | FindingSeverity>('all');
  const [ruleId, setRuleId] = useState<'all' | string>('all');
  const [groupLimit, setGroupLimit] = useState(COMPLIANCE_GROUP_DISPLAY_CAP);

  useEffect(() => {
    if (!focus?.complianceFilter) return;
    const cf = focus.complianceFilter;
    if (cf.severity && cf.severity !== 'all') {
      setSeverity(cf.severity as FindingSeverity);
    }
    if (cf.ruleId) setRuleId(cf.ruleId);
    clearFocus();
  }, [focus?.nonce, focus?.complianceFilter, clearFocus]);

  const findings = useMemo(() => getComplianceFindings(data), [data]);
  const summary = useMemo(() => complianceSummary(findings), [findings]);

  const activeRuleIds = useMemo(() => {
    const set = new Set(findings.map((f) => f.ruleId));
    return Object.values(COMPLIANCE_RULES).filter((r) => set.has(r.id));
  }, [findings]);

  const filtered = useMemo(
    () =>
      findings.filter(
        (f) => (severity === 'all' || f.severity === severity) && (ruleId === 'all' || f.ruleId === ruleId),
      ),
    [findings, severity, ruleId],
  );

  const groups = useMemo(() => {
    const map = new Map<string, { patientName: string; claimNumber: string; items: ComplianceFinding[] }>();
    for (const f of filtered) {
      const key = `${f.patientName}||${f.claimNumber}`;
      let g = map.get(key);
      if (!g) {
        g = { patientName: f.patientName, claimNumber: f.claimNumber, items: [] };
        map.set(key, g);
      }
      g.items.push(f);
    }
    return [...map.values()];
  }, [filtered]);

  const visibleGroups = groups.slice(0, groupLimit);
  const hasMoreGroups = groups.length > groupLimit;

  function applyFix(fix: FixIntent) {
    if (fix.action === 'create-approval') {
      setFocus({
        module: 'approvals',
        patientId: fix.patientId,
        claimId: fix.claimId,
        intent: fix.action,
        prefill: fix.prefill,
      });
      return;
    }
    if (fix.action === 'request-po') {
      setFocus({
        module: 'patients',
        patientId: fix.patientId,
        claimId: fix.claimId,
        intent: fix.action,
        prefill: fix.prefill,
      });
      return;
    }
    setFocus({
      module: fix.module,
      patientId: fix.patientId,
      claimId: fix.claimId,
      intent: fix.action,
      prefill: fix.prefill,
    });
  }

  function openClaim(f: ComplianceFinding) {
    if (!f.patientId && !f.claimId) return;
    setFocus({ module: 'patients', patientId: f.patientId, claimId: f.claimId });
  }

  return (
    <div>
      <SectionTitle
        title="Flagged — Contract Compliance"
        subtitle="Live checks of your claims and Billing Log against the ACC Nursing Service Schedule & Operational Guidelines. Fix issues in one click."
        actions={
          <LetterImportButton
            opts={{ entryPoint: 'compliance' }}
            title={LETTER_IMPORT_FULL_TOOLTIP}
          />
        }
      />

      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <StatCard label="Violations" value={summary.violations} tone="danger" hint="Contract breaches to resolve before billing" />
        <StatCard label="Warnings" value={summary.warnings} tone="salmon" hint="Needs attention / review" />
        <StatCard label="Heads-ups" value={summary.predictive} tone="accent" hint="Early warnings — act before they become issues" />
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)} className="w-auto">
          <option value="all">All severities</option>
          <option value="violation">Violations</option>
          <option value="warning">Warnings</option>
          <option value="predictive">Heads-ups</option>
        </Select>
        <Select value={ruleId} onChange={(e) => setRuleId(e.target.value)} className="w-auto">
          <option value="all">All rules</option>
          {activeRuleIds.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
        <span className="text-sm" style={{ color: 'var(--muted)' }}>
          {filtered.length} finding{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={<IconShield width={32} height={32} />}
          title="All clear"
          message="No contract-compliance issues found for the current filter. Nice work."
        />
      ) : (
        <div className="space-y-4">
          {visibleGroups.map((g) => (
            <Card key={`${g.patientName}||${g.claimNumber}`}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div>
                  <div className="font-bold">{g.patientName || 'Unknown patient'}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>
                    Claim {g.claimNumber || '—'}
                  </div>
                </div>
                {(g.items[0].patientId || g.items[0].claimId) && (
                  <button className="btn btn-sm" onClick={() => openClaim(g.items[0])}>
                    Open claim
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {g.items.map((f) => {
                  const meta = SEVERITY_META[f.severity];
                  return (
                    <div
                      key={f.id}
                      className="rounded-lg p-3 flex items-start gap-3"
                      style={{ background: 'var(--surface-2)' }}
                    >
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{f.title}</div>
                        <div className="text-sm" style={{ color: 'var(--muted)' }}>
                          {f.detail}
                        </div>
                        <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          {f.clauseRef}
                          {f.rulesVersion ? ` · Rules ${f.rulesVersion}` : ''}
                        </div>
                      </div>
                      {f.fix && (
                        <button className="btn btn-primary btn-sm shrink-0" onClick={() => applyFix(f.fix!)}>
                          {f.fix.label}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
          {hasMoreGroups && (
            <button className="btn w-full" onClick={() => setGroupLimit((n) => n + COMPLIANCE_GROUP_DISPLAY_CAP)}>
              Load more ({groups.length - groupLimit} remaining)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
