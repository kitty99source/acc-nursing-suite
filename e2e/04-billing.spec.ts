import { test, expect } from '@playwright/test';
import { gotoApp, openModule, MODULE_HEADINGS } from './helpers/app';

/**
 * J-09 — Billing Log large-list virtual scroll + column sort.
 *
 * Seeded sample data has 61 invoice lines (> the 50-row virtualization threshold in
 * src/components/DataTable.tsx), so the table windows its rows.
 */
test.describe('Billing large-list', () => {
  test('J-09: virtualizes rows, scrolls smoothly, and sorts by column', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'billing');

    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.billing })).toBeVisible();

    const table = page.locator('table.data-table');
    await expect(table).toBeVisible();

    // Virtualization: fewer real rows are in the DOM than the 61 total (spacer rows are aria-hidden).
    const realRows = table.locator('tbody tr:not([aria-hidden="true"])');
    const rendered = await realRows.count();
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(61);

    // Scroll the windowed container to the bottom and assert it actually moved (smooth, no freeze).
    const scroller = page.getByTestId('data-table-scroll').first();
    const before = await scroller.evaluate((el) => el.scrollTop);
    await scroller.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect
      .poll(async () => scroller.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(before);

    // Sort by the "Invoiced" column and confirm a sort indicator renders.
    const invoicedHeader = table.locator('th', { hasText: 'Invoiced' }).first();
    await invoicedHeader.click();
    await expect(table.locator('thead')).toContainText(/[▲▼]/);

    // Table + shell remain intact after interaction.
    await expect(table).toBeVisible();
    await expect(page.getByText('ACC District Nursing').first()).toBeVisible();
  });
});
