import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { applyTheme } from './lib/theme';
import { Sidebar, type ModuleId } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { LockScreen } from './components/LockScreen';
import { buildActionQueue, computeApproval } from './lib/analytics';
import { daysUntil } from './lib/format';

import { Dashboard } from './modules/Dashboard';
import { Patients } from './modules/Patients';
import { CalculatorModule } from './modules/CalculatorModule';
import { Approvals } from './modules/Approvals';
import { Billing } from './modules/Billing';
import { ComplexCases } from './modules/ComplexCases';
import { Declines } from './modules/Declines';
import { QuickPaste } from './modules/QuickPaste';
import { ExportCenter } from './modules/ExportCenter';
import { SettingsModule } from './modules/SettingsModule';

export default function App() {
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const init = useStore((s) => s.init);
  const settings = useStore((s) => s.data.settings);
  const data = useStore((s) => s.data);
  const recordActivity = useStore((s) => s.recordActivity);
  const lock = useStore((s) => s.lock);
  const lastActivityAt = useStore((s) => s.lastActivityAt);

  const [module, setModule] = useState<ModuleId>('dashboard');

  // Initialise persistence on mount.
  useEffect(() => {
    void init();
  }, [init]);

  // Apply theme tokens whenever settings change.
  useEffect(() => {
    applyTheme(settings);
  }, [settings]);

  // Activity tracking for idle auto-lock.
  const activityThrottle = useRef(0);
  useEffect(() => {
    if (locked) return;
    const handler = () => {
      const now = Date.now();
      if (now - activityThrottle.current > 2000) {
        activityThrottle.current = now;
        recordActivity();
      }
    };
    const events: (keyof WindowEventMap)[] = ['mousedown', 'keydown', 'mousemove', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [locked, recordActivity]);

  // Idle timer: lock after configured minutes of inactivity.
  useEffect(() => {
    if (locked) return;
    const minutes = settings.idleLockMinutes;
    if (!minutes || minutes <= 0) return;
    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs >= minutes * 60_000) lock();
    }, 5000);
    return () => clearInterval(interval);
  }, [locked, settings.idleLockMinutes, lastActivityAt, lock]);

  // Sidebar attention badges.
  const badges = useMemo(() => {
    const result: Partial<Record<ModuleId, number>> = {};
    const actions = buildActionQueue(data);
    if (actions.length) result.dashboard = actions.length;

    const approvalsAttention = data.approvals.filter(
      (a) => computeApproval(a, settings.expiryThresholdDays).status !== 'Active',
    ).length;
    if (approvalsAttention) result.approvals = approvalsAttention;

    const billingAttention = data.invoiceLines.filter(
      (i) => i.status === 'Awaiting Billing' || i.status === 'Remittance',
    ).length;
    if (billingAttention) result.billing = billingAttention;

    const declineAttention = data.declines.filter(
      (d) => d.status === 'Awaiting nursing docs for resubmission' || d.status === 'Awaiting response from ACC',
    ).length;
    if (declineAttention) result.declines = declineAttention;

    const complexAttention = data.complexCases.filter(
      (c) => c.status !== 'Resolved' && c.nextReviewDate && daysUntil(c.nextReviewDate) <= 0,
    ).length;
    if (complexAttention) result.complex = complexAttention;

    return result;
  }, [data, settings.expiryThresholdDays]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--muted)' }}>
        Loading…
      </div>
    );
  }

  if (locked) return <LockScreen />;

  return (
    <div className="h-full flex" style={{ background: 'var(--bg)' }}>
      <Sidebar current={module} onNavigate={setModule} badges={badges} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-5">
          {module === 'dashboard' && <Dashboard onNavigate={setModule} />}
          {module === 'patients' && <Patients />}
          {module === 'calculator' && <CalculatorModule />}
          {module === 'approvals' && <Approvals />}
          {module === 'billing' && <Billing />}
          {module === 'complex' && <ComplexCases />}
          {module === 'declines' && <Declines />}
          {module === 'quickpaste' && <QuickPaste onNavigate={setModule} />}
          {module === 'export' && <ExportCenter />}
          {module === 'settings' && <SettingsModule />}
        </main>
      </div>
    </div>
  );
}
