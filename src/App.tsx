import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from './state/store';
import { applyTheme } from './lib/theme';
import { importStagingSidecars, loadStagingItems } from './lib/staging';
import { probeLocalStagingBridge } from './lib/localAccBridge';
import { appendAudit } from './lib/auditLog';
import { Sidebar, type ModuleId } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { AutosaveErrorBanner } from './components/AutosaveErrorBanner';
import { LockScreen } from './components/LockScreen';
import { buildActionQueue, computeApproval, isBillingApproval } from './lib/analytics';
import { complianceSummary } from './lib/compliance';
import { getComplianceFindings } from './lib/complianceCache';
import { daysUntil } from './lib/format';

import { Dashboard } from './modules/Dashboard';
import { Compliance } from './modules/Compliance';
import { Patients } from './modules/Patients';
import { CalculatorModule } from './modules/CalculatorModule';
import { Approvals } from './modules/Approvals';
import { Billing } from './modules/Billing';
import { ComplexCases } from './modules/ComplexCases';
import { Declines } from './modules/Declines';
import { QuickPaste } from './modules/QuickPaste';
import { ExportCenter } from './modules/ExportCenter';
import { ImportedTables } from './modules/ImportedTables';
import { SettingsModule } from './modules/SettingsModule';
import { ReviewQueue } from './modules/ReviewQueue';
import { AccInbox } from './modules/AccInbox';
import { LetterImportModal } from './components/LetterImportModal';
import { RecoveryModal } from './components/RecoveryModal';
import { BackupReminderModal } from './components/BackupReminderModal';
import { HelpCenterModal, type HelpTab } from './components/HelpCenterModal';
import { ConfirmDialog } from './components/Modal';
import { loadBackupSnoozeUntil } from './lib/idb';
import { logInfo } from './lib/logger';
import { startLauncherSessionLifecycle } from './lib/launcherLifecycle';
import { AccInboxConfigBanner } from './components/AccInboxConfigBanner';
import { RemittanceStaleBanner } from './components/RemittanceStaleBanner';

export default function App() {
  const ready = useStore((s) => s.ready);
  const locked = useStore((s) => s.locked);
  const recovery = useStore((s) => s.recovery);
  const init = useStore((s) => s.init);
  const settings = useStore((s) => s.data.settings);
  const status = useStore((s) => s.status);
  const data = useStore((s) => s.data);
  const recordActivity = useStore((s) => s.recordActivity);
  const lock = useStore((s) => s.lock);
  const lastActivityAt = useStore((s) => s.lastActivityAt);
  const focus = useStore((s) => s.focus);
  const openLetterImport = useStore((s) => s.openLetterImport);
  const updateSettings = useStore((s) => s.updateSettings);

  const [module, setModule] = useState<ModuleId>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [backupReminderOpen, setBackupReminderOpen] = useState(false);
  const [reviewBadge, setReviewBadge] = useState(0);
  const [idleWarningOpen, setIdleWarningOpen] = useState(false);
  const [concurrentTabWarning, setConcurrentTabWarning] = useState(false);
  const idleWarnedRef = useRef(false);
  const tabIdRef = useRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<HelpTab>('guide');
  const helpAutoOpenedRef = useRef(false);

  // A cross-module focus request (e.g. from the Flagged page) switches the
  // active module; the target module then consumes the request on mount.
  useEffect(() => {
    if (focus) setModule(focus.module as ModuleId);
  }, [focus]);

  // Initialise persistence on mount.
  useEffect(() => {
    void init().then(() => logInfo('App initialized', 'init'));
  }, [init]);

  // When served by launch.ps1: heartbeat + tab-close goodbye so quiet/hidden
  // PowerShell (app server + folder-watch) exit with the last browser tab.
  useEffect(() => {
    const handle = startLauncherSessionLifecycle();
    return () => handle.stop();
  }, []);

  // Apply theme tokens whenever settings change.
  useEffect(() => {
    applyTheme(settings);
  }, [settings]);

  // Warn before leaving with unsaved (un-exported) changes. Only fires the
  // browser's native "leave site?" prompt when there are dirty changes; in-app
  // navigation never triggers an unload so this stays quiet during normal use.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useStore.getState().status.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

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

  // Idle timer: warn 60s before lock, then lock after configured minutes (P4-005).
  useEffect(() => {
    if (locked) return;
    const minutes = settings.idleLockMinutes;
    if (!minutes || minutes <= 0) return;
    const interval = setInterval(() => {
      const idleMs = Date.now() - lastActivityAt;
      const lockMs = minutes * 60_000;
      const warnMs = Math.max(lockMs - 60_000, lockMs * 0.8);
      if (idleMs >= lockMs) {
        setIdleWarningOpen(false);
        idleWarnedRef.current = false;
        lock();
        return;
      }
      if (idleMs >= warnMs && !idleWarnedRef.current) {
        idleWarnedRef.current = true;
        setIdleWarningOpen(true);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [locked, settings.idleLockMinutes, lastActivityAt, lock]);

  // Reset idle warning when user is active again.
  useEffect(() => {
    if (idleWarningOpen && Date.now() - lastActivityAt < 5000) {
      setIdleWarningOpen(false);
      idleWarnedRef.current = false;
    }
  }, [lastActivityAt, idleWarningOpen]);

  // Concurrent tab detection — last write wins (P4-007).
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('acc-suite-tab');
    const tabId = tabIdRef.current;
    channel.postMessage({ type: 'hello', tabId, at: Date.now() });
    const interval = window.setInterval(() => {
      channel.postMessage({ type: 'heartbeat', tabId, at: Date.now() });
    }, 3000);
    channel.onmessage = (ev) => {
      const msg = ev.data as { type?: string; tabId?: string };
      if (msg?.type === 'hello' || msg?.type === 'heartbeat') {
        if (msg.tabId && msg.tabId !== tabId) setConcurrentTabWarning(true);
      }
    };
    return () => {
      window.clearInterval(interval);
      channel.close();
    };
  }, []);

  // Global letter drag-drop (PDF or Word) → letter import.
  useEffect(() => {
    if (locked) return;
    function isLetterFile(f: File): boolean {
      const n = f.name.toLowerCase();
      return (
        f.type === 'application/pdf' ||
        n.endsWith('.pdf') ||
        f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        n.endsWith('.docx')
      );
    }
    function onDragOver(e: DragEvent) {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setDragOver(true);
      }
    }
    function onDragLeave() {
      setDragOver(false);
    }
    function onDrop(e: DragEvent) {
      e.preventDefault();
      setDragOver(false);
      const file = [...(e.dataTransfer?.files ?? [])].find(isLetterFile);
      if (file) openLetterImport(file, { entryPoint: 'global' });
    }
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [locked, openLetterImport]);

  // Weekly backup reminder when last export is older than configured days (P0-004).
  useEffect(() => {
    if (!ready || locked || recovery) return;
    const days = settings.backupReminderDays ?? 7;
    const last = status.lastExportAt;
    if (!last) {
      void loadBackupSnoozeUntil().then((snooze) => {
        if (!snooze || Date.now() > snooze) setBackupReminderOpen(true);
      });
      return;
    }
    const daysSince = Math.floor((Date.now() - last) / (24 * 60 * 60 * 1000));
    if (daysSince < days) return;
    void loadBackupSnoozeUntil().then((snooze) => {
      if (!snooze || Date.now() > snooze) setBackupReminderOpen(true);
    });
  }, [ready, locked, recovery, settings.backupReminderDays, status.lastExportAt]);

  // HRQ pending count for sidebar badge (P8-002) + background sidecar auto-import.
  // Auto-import must not depend on Review Queue being open — otherwise AccInbox feels required
  // whenever the user never visits Review while folder-watch is writing .staging sidecars.
  useEffect(() => {
    if (!ready || locked || recovery) return;
    const seen = new Set<string>();
    let cancelled = false;

    const pull = async () => {
      const pending = await loadStagingItems();
      if (!cancelled) setReviewBadge(pending.length);

      const probe = await probeLocalStagingBridge();
      if (cancelled || !probe.sidecars.length) return;
      const fresh = probe.sidecars.filter((sc) => {
        if (seen.has(sc.item.id)) return false;
        seen.add(sc.item.id);
        return true;
      });
      if (!fresh.length) return;
      const added = await importStagingSidecars(fresh);
      if (added > 0) {
        await appendAudit({
          action: 'staging-import',
          entityType: 'staging',
          summary: `Auto-imported ${added} folder-watch sidecar(s) via /_acc/staging (app background)`,
        });
        const next = await loadStagingItems();
        if (!cancelled) setReviewBadge(next.length);
      }
    };

    void pull();
    const id = window.setInterval(() => {
      void pull();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ready, locked, recovery, module]);

  // First-run instruction guide — one-shot; Settings/top-bar reopen never clears the flag.
  useEffect(() => {
    if (!ready || locked || recovery) return;
    if (settings.hasSeenWelcomeGuide) return;
    if (helpAutoOpenedRef.current) return;
    helpAutoOpenedRef.current = true;
    setHelpTab('guide');
    setHelpOpen(true);
  }, [ready, locked, recovery, settings.hasSeenWelcomeGuide]);

  function openHelp(tab: HelpTab = 'guide') {
    setHelpTab(tab);
    setHelpOpen(true);
  }

  function closeHelp() {
    setHelpOpen(false);
    if (!settings.hasSeenWelcomeGuide) {
      updateSettings({ hasSeenWelcomeGuide: true });
    }
  }

  // Sidebar attention badges — cheap counters + cached compliance (P1-004).
  const badges = useMemo(() => {
    const result: Partial<Record<ModuleId, number>> = {};
    const findings = getComplianceFindings(data);
    const actions = buildActionQueue(data, findings);
    if (actions.length) result.dashboard = actions.length;

    const approvalsAttention = data.approvals.filter(
      (a) => isBillingApproval(a) && computeApproval(a, settings.expiryThresholdDays).status !== 'Active',
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

    const compliance = complianceSummary(findings);
    const complianceAttention = compliance.violations + compliance.warnings;
    if (complianceAttention) result.compliance = complianceAttention;

    if (reviewBadge) result.review = reviewBadge;

    return result;
  }, [data, settings.expiryThresholdDays, reviewBadge]);

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center" style={{ color: 'var(--muted)' }}>
        Loading…
      </div>
    );
  }

  if (locked) return <LockScreen />;

  if (recovery) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg)' }}>
        <RecoveryModal />
      </div>
    );
  }

  return (
    <div className="h-full flex relative" style={{ background: 'var(--bg)' }}>
      {dragOver && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center p-4" style={{ background: 'rgba(47,143,131,0.15)', border: '3px dashed var(--accent)' }}>
          <p className="text-lg font-semibold text-center" style={{ color: 'var(--accent)' }}>Drop ACC letter (PDF or Word) to import</p>
        </div>
      )}
      {concurrentTabWarning && (
        <div data-testid="concurrent-tab-warning" className="shrink-0 px-4 py-2 text-sm text-center" style={{ background: 'var(--warn)', color: 'var(--warn-fg)' }}>
          Another tab has this suite open — last write wins. Close the other tab to avoid conflicting saves.
        </div>
      )}
      <Sidebar
        current={module}
        onNavigate={(id) => { setModule(id); setSidebarOpen(false); }}
        badges={badges}
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenuToggle={() => setSidebarOpen((v) => !v)} onOpenHelp={() => openHelp('guide')} />
        <AutosaveErrorBanner />
        <div className="px-5 pt-2 space-y-1">
          {(module === 'dashboard' || module === 'accinbox' || module === 'review') && <AccInboxConfigBanner />}
          {(module === 'dashboard' || module === 'billing') && <RemittanceStaleBanner />}
        </div>
        <main className="flex-1 overflow-y-auto p-5">
          {module === 'dashboard' && <Dashboard onNavigate={setModule} />}
          {module === 'compliance' && <Compliance />}
          {module === 'patients' && <Patients />}
          {module === 'calculator' && <CalculatorModule />}
          {module === 'approvals' && <Approvals />}
          {module === 'billing' && <Billing />}
          {module === 'complex' && <ComplexCases />}
          {module === 'declines' && <Declines />}
          {module === 'quickpaste' && <QuickPaste onNavigate={setModule} />}
          {module === 'review' && <ReviewQueue />}
          {module === 'accinbox' && <AccInbox />}
          {module === 'export' && <ExportCenter />}
          {module === 'imported' && <ImportedTables />}
          {module === 'settings' && <SettingsModule onOpenHelp={() => openHelp('guide')} />}
        </main>
      </div>
      <LetterImportModal />
      <HelpCenterModal open={helpOpen} initialTab={helpTab} onClose={closeHelp} />
      <ConfirmDialog
        open={idleWarningOpen}
        title="Session expiring"
        message="You will be locked out soon due to inactivity. Stay signed in?"
        confirmLabel="Stay signed in"
        cancelLabel="Lock now"
        onConfirm={() => {
          recordActivity();
          setIdleWarningOpen(false);
          idleWarnedRef.current = false;
        }}
        onCancel={() => {
          setIdleWarningOpen(false);
          lock();
        }}
      />
      <BackupReminderModal
        open={backupReminderOpen}
        daysSinceExport={
          status.lastExportAt
            ? Math.floor((Date.now() - status.lastExportAt) / (24 * 60 * 60 * 1000))
            : settings.backupReminderDays ?? 7
        }
        onGoToExport={() => {
          setBackupReminderOpen(false);
          setModule('export');
        }}
        onDismiss={() => setBackupReminderOpen(false)}
      />
    </div>
  );
}
