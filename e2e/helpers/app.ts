import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the ACC Admin Suite e2e harness.
 *
 * Resilient selectors only: ARIA roles, accessible names, and visible text — so specs
 * survive markup churn while application source is edited concurrently. No data-testid
 * dependencies (see e2e/helpers/journeys.ts for recommended testids if selectors drift).
 */

/** Sidebar nav labels (from src/components/Sidebar.tsx). */
export const MODULE_LABELS = {
  dashboard: 'Dashboard',
  review: 'Review Queue',
  accinbox: 'ACC Inbox',
  compliance: 'Flagged (Compliance)',
  patients: 'Patients & Cases',
  approvals: 'Approvals (NS04/NS05)',
  declines: 'Decline Tracker',
  billing: 'Billing Log',
  complex: 'Complex Cases',
  calculator: 'Package Calculator',
  export: 'Export Center',
  settings: 'Settings',
} as const;

/** Module <h1> heading text (from each module's <SectionTitle title=...>). */
export const MODULE_HEADINGS = {
  dashboard: 'Dashboard',
  review: 'Human Review Queue',
  compliance: 'Flagged — Contract Compliance',
  billing: 'Billing Log',
} as const;

export type ModuleKey = keyof typeof MODULE_LABELS;

/**
 * Navigate to the app root and wait until it has booted past the "Loading…" splash.
 * A fresh browser context has an empty IndexedDB, so the store seeds SAMPLE data and
 * the app renders unlocked (see src/state/store.ts init()).
 */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/');
  // The suite brand text is always present in the sidebar once the shell mounts.
  await expect(page.getByText('ACC District Nursing').first()).toBeVisible({ timeout: 30_000 });
  // Sanity: we should not be stuck on the loading splash.
  await expect(page.getByText('Loading…')).toHaveCount(0);
  await dismissStartupModals(page);
}

/**
 * A fresh context has never exported a .accdata backup, so the weekly Backup Reminder modal
 * opens on load and its backdrop intercepts pointer events. Dismiss it (and any similar
 * startup modal) so navigation is unobstructed.
 */
export async function dismissStartupModals(page: Page): Promise<void> {
  const remindLater = page.getByRole('button', { name: /Remind me tomorrow/i });
  try {
    await remindLater.waitFor({ state: 'visible', timeout: 4_000 });
    await remindLater.click();
    await expect(page.getByRole('button', { name: /Remind me tomorrow/i })).toHaveCount(0);
  } catch {
    // Reminder not shown (e.g. snoozed) — nothing to dismiss.
  }
}

/**
 * On mobile widths the sidebar is off-canvas; open it via the menu toggle first.
 * On desktop the sidebar is always visible so this is a no-op.
 */
export async function ensureSidebarVisible(page: Page): Promise<void> {
  const viewport = page.viewportSize();
  const isNarrow = !!viewport && viewport.width < 1024; // Tailwind lg breakpoint.
  if (!isNarrow) return;
  const brand = page.getByText('ACC District Nursing').first();
  if (await brand.isVisible().catch(() => false)) {
    const box = await brand.boundingBox();
    // If the sidebar is translated off-canvas its left edge sits at a negative x.
    if (box && box.x >= 0) return;
  }
  await page.getByRole('button', { name: /open menu/i }).first().click().catch(() => {});
}

/** Click a sidebar entry by its visible label. Opens the drawer first on mobile. */
export async function openModule(page: Page, key: ModuleKey): Promise<void> {
  await ensureSidebarVisible(page);
  await page.getByRole('button', { name: MODULE_LABELS[key], exact: false }).first().click();
}

/** True if the app is showing an error / recovery / lock screen instead of the shell. */
export async function isShellHealthy(page: Page): Promise<boolean> {
  return page.getByText('ACC District Nursing').first().isVisible().catch(() => false);
}
