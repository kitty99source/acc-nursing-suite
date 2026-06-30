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
} from './icons';
import { useStore } from '../state/store';

export type ModuleId =
  | 'dashboard'
  | 'patients'
  | 'calculator'
  | 'approvals'
  | 'billing'
  | 'complex'
  | 'declines'
  | 'quickpaste'
  | 'export'
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
}: {
  current: ModuleId;
  onNavigate: (id: ModuleId) => void;
  badges: Partial<Record<ModuleId, number>>;
}) {
  const quickPasteEnabled = useStore((s) => s.data.settings.quickPasteInEnabled);

  const entries: NavEntry[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <IconDashboard /> },
    { id: 'patients', label: 'Patients & Cases', icon: <IconPatients /> },
    { id: 'calculator', label: 'Package Calculator', icon: <IconCalculator /> },
    { id: 'approvals', label: 'Approvals (NS04/NS05)', icon: <IconApprovals /> },
    { id: 'billing', label: 'Billing Log', icon: <IconBilling /> },
    { id: 'complex', label: 'Complex Cases', icon: <IconComplex /> },
    { id: 'declines', label: 'Decline Tracker', icon: <IconDecline /> },
    ...(quickPasteEnabled ? [{ id: 'quickpaste' as ModuleId, label: 'Quick Paste-In', icon: <IconPaste /> }] : []),
    { id: 'export', label: 'Export Center', icon: <IconExport /> },
    { id: 'settings', label: 'Settings', icon: <IconSettings /> },
  ];

  return (
    <aside
      className="w-64 shrink-0 h-full flex flex-col border-r"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
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
        <div>v1.0.0</div>
      </div>
    </aside>
  );
}
