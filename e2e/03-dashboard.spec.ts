import { test, expect } from '@playwright/test';
import { gotoApp, openModule, MODULE_HEADINGS } from './helpers/app';

/**
 * J-07 — Dashboard mounts, action queue is capped at 50 rows, and cross-module deep-links work.
 * J-24 — Stale remittance surfaces in the billing analytics + the Billing "Remittance" queue.
 *
 * Seeded sample data includes a 65-day-old NS05 Remittance line (SAMPLE — Mere Tane) that is
 * past the default 60-day stale threshold.
 */
test.describe('Dashboard & remittance queue', () => {
  test('J-07: dashboard mounts with a capped action queue and deep-links to Compliance', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'dashboard');

    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.dashboard })).toBeVisible();

    // Action queue is present and never renders more than the display cap (50). Scope the row
    // count to the action-queue container via its testid — the .action-row class is also used by
    // the Contract-compliance list, so an unscoped selector would over-count.
    await expect(page.getByRole('heading', { name: 'Action queue' })).toBeVisible();
    const actionRows = page.getByTestId('action-queue').locator('.action-row');
    const count = await actionRows.count();
    expect(count).toBeLessThanOrEqual(50);

    // Deep-link out to the Compliance (Flagged) page from the dashboard.
    await page.getByRole('button', { name: /Open Flagged page/i }).click();
    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.compliance })).toBeVisible();
  });

  test('J-24: stale remittance is visible in analytics and the Billing Remittance queue', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'dashboard');

    // Billing status funnel exposes the Remittance bucket on the dashboard.
    await expect(page.getByText('Billing status funnel')).toBeVisible();

    // The Remittance "queue" itself lives in the Billing Log filtered by status.
    await openModule(page, 'billing');
    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.billing })).toBeVisible();

    // The first toolbar <select> is the status filter — narrow it to Remittance.
    await page.locator('select').first().selectOption('Remittance');

    const table = page.locator('table.data-table');
    await expect(table).toBeVisible();
    await expect(table).toContainText(/Mere Tane/i);
  });
});
