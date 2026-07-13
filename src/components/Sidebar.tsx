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
  IconFolder,
  IconShield,
  IconReview,
  IconInbox,
  IconMail,
} from './icons';
import { useRef } from 'react';
import { HelperTip } from './HelperTip';
import { useStore } from '../state/store';
import { emptyClickBurst, registerClick, type ClickBurstState } from '../lib/easter/clickCounter';

export type ModuleId =
  | 'dashboard'
  | 'compliance'
  | 'patients'
  | 'calculator'
  | 'approvals'
  | 'billing'
  | 'complex'
  | 'declines'
  | 'review'
  | 'accinbox'
  | 'export'
  | 'imported'
  | 'mail-reference'
  | 'settings';

interface NavEntry {
  id: ModuleId;
  label: string;
  icon: ReactNode;
}

interface NavSection {
  label?: string;
  entries: NavEntry[];
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
  badges: Partial<Record<ModuleId, number | { count: number; label: string; title?: string; ariaLabel?: string }>>;
  open?: boolean;
  onToggle?: () => void;
}) {
  const hasImportedTables = useStore((s) => (s.data.customSheets?.length ?? 0) > 0);
  const setDiscoActive = useStore((s) => s.setDiscoActive);

  // Easter egg: triple-click the NS brand mark within 1.5s to toggle the disco.
  const brandClickRef = useRef<ClickBurstState>(emptyClickBurst());
  const onBrandClick = () => {
    const res = registerClick(brandClickRef.current, Date.now(), { threshold: 3, windowMs: 1500 });
    brandClickRef.current = res.state;
    if (res.triggered) {
      // Read fresh store state so rapid bursts don't toggle from a stale closure.
      setDiscoActive(!useStore.getState().discoActive);
    }
  };

  // Grouped by daily workflow frequency: triage first, then records, then tools.
  const sections: NavSection[] = [
    {
      entries: [{ id: 'dashboard', label: 'Dashboard', icon: <IconDashboard /> }],
    },
    {
      label: 'Letters & triage',
      entries: [
        { id: 'review', label: 'Review Queue', icon: <IconReview /> },
        { id: 'accinbox', label: 'ACC Inbox', icon: <IconInbox /> },
        { id: 'compliance', label: 'Flagged (Compliance)', icon: <IconShield /> },
      ],
    },
    {
      label: 'Records',
      entries: [
        { id: 'patients', label: 'Patients & Cases', icon: <IconPatients /> },
        { id: 'approvals', label: 'Approvals (NS04/NS05)', icon: <IconApprovals /> },
        { id: 'declines', label: 'Decline Tracker', icon: <IconDecline /> },
        { id: 'billing', label: 'Billing Log', icon: <IconBilling /> },
        { id: 'complex', label: 'Complex Cases', icon: <IconComplex /> },
      ],
    },
    {
      label: 'Tools',
      entries: [
        { id: 'calculator', label: 'Package Calculator', icon: <IconCalculator /> },
        ...(hasImportedTables ? [{ id: 'imported' as ModuleId, label: 'Imported Tables', icon: <IconFolder /> }] : []),
        { id: 'export', label: 'Export Center', icon: <IconExport /> },
        { id: 'mail-reference', label: 'Mail Reference', icon: <IconMail /> },
        { id: 'settings', label: 'Settings', icon: <IconSettings /> },
      ],
    },
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
          <button
            type="button"
            className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm select-none cursor-pointer shrink-0 border-0"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            onClick={onBrandClick}
            title="Fun surprise"
            aria-label="NS brand — triple-click for a fun surprise"
          >
            NS
          </button>
          <div className="min-w-0">
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
      <nav className="flex-1 overflow-y-auto p-2">
        {sections.map((section, si) => (
          <div key={section.label ?? `section-${si}`} className={si > 0 ? 'mt-3' : ''}>
            {section.label && (
              <div
                className="px-3 pb-1 text-[0.65rem] font-semibold uppercase tracking-wider select-none"
                style={{ color: 'var(--muted)' }}
              >
                {section.label}
              </div>
            )}
            <div className="space-y-0.5">
              {section.entries.map((e) => {
                const badge = badges[e.id];
                const badgeLabel =
                  typeof badge === 'object' && badge ? badge.label : badge != null ? String(badge) : null;
                const badgeTitle =
                  typeof badge === 'object' && badge ? badge.title : undefined;
                const badgeAria =
                  typeof badge === 'object' && badge ? badge.ariaLabel ?? badge.title : undefined;
                return (
                <button
                  key={e.id}
                  className="nav-item w-full text-left"
                  data-active={current === e.id}
                  aria-current={current === e.id ? 'page' : undefined}
                  onClick={() => onNavigate(e.id)}
                >
                  <span className="shrink-0">{e.icon}</span>
                  <span className="flex-1">{e.label}</span>
                  {badgeLabel ? (
                    <HelperTip tipId="tip-sidebar-badges">
                      <span
                        className="badge"
                        style={{ background: 'var(--salmon)', color: 'var(--salmon-fg)' }}
                        title={badgeTitle}
                        aria-label={badgeAria}
                      >
                        {badgeLabel}
                      </span>
                    </HelperTip>
                  ) : null}
                </button>
                );
              })}
            </div>
          </div>
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
