/**
 * UAT journey coverage map (P1-UAT) for the Playwright harness.
 *
 * Only the browser-verifiable journeys are automated here — those needing NO Outlook COM,
 * Citrix VPN, real PHI, or File System Access folder pickers. Journey definitions live in
 * change-requests/UAT_CHECKLIST.md and change-requests/SIMPLE_PILOT_GUIDE.md.
 *
 * This is TypeScript (not markdown) on purpose: it keeps the coverage matrix versioned next
 * to the specs and importable, and it documents which testids the parent could add to src/
 * if role/text selectors ever become ambiguous.
 */

export interface JourneyCoverage {
  id: string;
  title: string;
  spec: string;
  /** true = fully automated & expected to pass; false = best-effort / pending final validation. */
  automated: boolean;
  note?: string;
}

export const JOURNEY_COVERAGE: JourneyCoverage[] = [
  { id: 'J-02', title: 'Corrupt PDF error', spec: '02-letter-import.spec.ts', automated: true },
  { id: 'J-07', title: 'Dashboard queue cap', spec: '03-dashboard.spec.ts', automated: true },
  { id: 'J-08', title: 'Compliance filter + pagination', spec: '05-compliance.spec.ts', automated: true },
  { id: 'J-09', title: 'Billing virtual scroll + sort', spec: '04-billing.spec.ts', automated: true },
  { id: 'J-10', title: 'Approvals historical toggle', spec: '10-approvals-declines.spec.ts', automated: true },
  { id: 'J-11', title: 'Declines Open patient', spec: '10-approvals-declines.spec.ts', automated: true },
  { id: 'J-12', title: 'Letter-import modal 1280x720', spec: '07-letter-import-responsive.spec.ts', automated: true },
  { id: 'J-13', title: 'Mobile 375px sidebar + layout', spec: '07-letter-import-responsive.spec.ts', automated: true },
  { id: 'J-21', title: 'Concurrent tabs warning', spec: '09-two-tabs.spec.ts', automated: true },
  { id: 'J-22', title: 'Duplicate letter warning', spec: '08-duplicate-letter.spec.ts', automated: true },
  { id: 'J-24', title: 'Stale remittance queue', spec: '03-dashboard.spec.ts', automated: true },
  {
    id: 'J-25',
    title: 'Review Queue empty + populated',
    spec: '06-review-queue.spec.ts',
    automated: false,
    note: 'Empty state fully automated; populated path needs folder-watch staging (FS access) — asserted softly.',
  },
  { id: 'J-01', title: 'Approval letter import', spec: '02-letter-import.spec.ts', automated: true },
];

/**
 * data-testid attributes the PARENT could add in src/ (do NOT add these from the e2e agent).
 * Every current spec uses role/label/text selectors instead; these are only fallbacks if the
 * UI churns enough to make text selectors ambiguous.
 */
export const RECOMMENDED_TESTIDS = {
  concurrentTabBanner: 'src/App.tsx — concurrent-tab warning banner (data-testid="concurrent-tab-warning")',
  actionQueue: 'src/modules/Dashboard.tsx — action queue list container (data-testid="action-queue")',
  billingTable: 'src/components/DataTable.tsx — scroll container (data-testid="data-table-scroll")',
} as const;
