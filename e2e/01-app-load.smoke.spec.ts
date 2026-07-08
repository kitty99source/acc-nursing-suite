import { test, expect } from '@playwright/test';
import { gotoApp, openModule, MODULE_HEADINGS, type ModuleKey } from './helpers/app';

/**
 * Smoke — application boot & navigation.
 * Covers baseline "app load" + Dashboard mount used by J-07 and underpins every other
 * journey. A fresh context boots into seeded SAMPLE data (no PHI), unlocked.
 */
test.describe('Smoke: app load & navigation', () => {
  test('boots into the shell with sidebar and no crash', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });

    await gotoApp(page);

    // Sidebar brand + core nav entries are present.
    await expect(page.getByText('ACC District Nursing').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Billing Log' })).toBeVisible();

    // Dashboard is the default module and mounts its <h1>.
    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.dashboard })).toBeVisible();

    // The strict offline CSP blocks the Vite HMR websocket in dev; ignore those and any
    // benign resource warnings. Fail only on real application errors.
    const appErrors = consoleErrors.filter(
      (e) =>
        !/websocket|ws:\/\/|HMR|Content Security Policy|connect-src|Failed to load resource|net::ERR/i.test(e),
    );
    expect(appErrors, appErrors.join('\n')).toEqual([]);
  });

  test('navigates across primary modules without breaking the shell', async ({ page }) => {
    await gotoApp(page);

    const stops: ModuleKey[] = ['billing', 'compliance', 'approvals', 'declines', 'review', 'dashboard'];
    for (const key of stops) {
      await openModule(page, key);
      // Every module renders exactly one <h1> section title; the shell stays mounted.
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expect(page.getByText('ACC District Nursing').first()).toBeVisible();
    }
  });
});
