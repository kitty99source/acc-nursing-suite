import type { ReactNode } from 'react';
import {
  IconDashboard,
  IconPatients,
  IconCalculator,
  IconApprovals,
  IconBilling,
  IconComplex,
  IconDecline,
  IconExport,
  IconSettings,
  IconPaste,
  IconFolder,
  IconShield,
  IconReview,
  IconInbox,
} from './icons';
import { useStore } from '../state/store';

export type ModuleId =
  | 'dashboard'
  | 'compliance'
  | 'patients'
  | 'calculator'
  | 'approvals'
  | 'billing'
  | 'complex'
  | 'declines'
  | 'quickpaste'
  | 'review'
  | 'accinbox'
  | 'export'
  | 'imported'
  | 'settings';

interface NavEntry {
  id: ModuleId;
  label: string;
  icon: ReactNode;
}

export function Sidebar({
  current,
  onNavigate,
  badges,
  open = true,
  onToggle,
}: {
  current: ModuleId;
  onNavigate: (id: ModuleId) => void;
  badges: Partial<Record<ModuleId, number>>;
  open?: boolean;
  onToggle?: () => void;
}) {
  const quickPasteEnabled = useStore((s) => s.data.settings.quickPasteInEnabled);
  const hasImportedTables = useStore((s) => (s.data.customSheets?.length ?? 0) > 0);

  const entries: NavEntry[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard /> },
    { id: 'review', label: 'Review Queue', icon: <IconReview /> },
    { id: 'accinbox', label: 'ACC Inbox', icon: <IconInbox /> },
    { id: 'compliance', label: 'Flagged (Compliance)', icon: <IconShield /> },
    { id: 'patients', label: 'Patients & Cases', icon: <IconPatients /> },
    { id: 'calculator', label: 'Package Calculator', icon: <IconCalculator /> },
    { id: 'approvals', label: 'Approvals (NS04/NS05)', icon: <IconApprovals /> },
    { id: 'billing', label: 'Billing Log', icon: <IconBilling /> },
    { id: 'complex', label: 'Complex Cases', icon: <IconComplex /> },
    { id: 'declines', label: 'Decline Tracker', icon: <IconDecline /> },
    ...(quickPasteEnabled ? [{ id: 'quickpaste' as ModuleId, label: 'Quick Paste-In', icon: <IconPaste /> }] : []),
    { id: 'export', label: 'Export Center', icon: <IconExport /> },
    ...(hasImportedTables ? [{ id: 'imported' as ModuleId, label: 'Imported Tables', icon: <IconFolder /> }] : []),
    { id: 'settings', label: 'Settings', icon: <IconSettings /> },
  ];

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={onToggle}
          aria-hidden
        />
      )}
      <aside
        className={`shrink-0 h-full flex flex-col border-r transition-transform duration-200 z-50
          w-64 lg:relative lg:translate-x-0
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0
          ${open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full'}
          max-lg:shadow-xl`}
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
      <div className="px-4 py-4 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            NS
          </div>
          <div>
            <div className="font-bold text-sm leading-tight">ACC District Nursing</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Admin Suite
            </div>
          </div>
        </div>
        {onToggle && (
          <button className="btn btn-icon lg:hidden shrink-0" onClick={onToggle} aria-label="Close menu">
            ✕
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {entries.map((e) => (
          <button
            key={e.id}
            className="nav-item w-full text-left"
            data-active={current === e.id}
            onClick={() => onNavigate(e.id)}
          >
            <span className="shrink-0">{e.icon}</span>
            <span className="flex-1">{e.label}</span>
            {badges[e.id] ? (
              <span
                className="badge"
                style={{ background: 'var(--salmon)', color: 'var(--salmon-fg)' }}
              >
                {badges[e.id]}
              </span>
            ) : null}
          </button>
        ))}
      </nav>
      <div className="p-3 text-xs border-t" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
        <div>100% offline · no network</div>
        <div>
          v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0'}
          {typeof __BUILD_DATE__ !== 'undefined' ? ` · ${__BUILD_DATE__}` : ''}
        </div>
      </div>
    </aside>
    </>
  );
}
