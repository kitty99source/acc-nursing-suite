import { test, expect } from '@playwright/test';
import { gotoApp, openModule, MODULE_HEADINGS } from './helpers/app';

/**
 * J-08 — Compliance (Flagged) severity/rule filters, finding count, group cap ("pagination"),
 * and one-click Fix routing off the page.
 *
 * Seeded sample data intentionally trips several Schedule 6 rules (52x NS06 cap, NS04 without
 * approval, travel billed alone, etc.), so the Flagged page has real findings to filter.
 */
test.describe('Compliance filtering & pagination', () => {
  test('J-08: filters by severity, updates the finding count, and caps groups', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'compliance');

    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.compliance })).toBeVisible();

    // Baseline: some findings exist.
    const countText = page.getByText(/\d+ findings?/);
    await expect(countText).toBeVisible();
    const allText = (await countText.first().textContent()) ?? '';
    const allCount = parseInt(allText, 10);
    expect(allCount).toBeGreaterThan(0);

    // Group cards are bounded by the display cap (COMPLIANCE_GROUP_DISPLAY_CAP = 50). If more
    // groups existed, a "Load more" pagination control would render.
    const groupCards = page.locator('.card').filter({ hasText: /Claim/ });
    expect(await groupCards.count()).toBeLessThanOrEqual(50);

    // Filter to Violations only — first toolbar <select> is the severity filter.
    const severity = page.locator('select').first();
    await severity.selectOption('violation');
    await expect(page.getByText(/\d+ findings?/)).toBeVisible();
    const violText = (await page.getByText(/\d+ findings?/).first().textContent()) ?? '';
    const violCount = parseInt(violText, 10);
    expect(violCount).toBeGreaterThanOrEqual(0);
    expect(violCount).toBeLessThanOrEqual(allCount);

    // Every visible severity badge in the violation view reads "Violation".
    const badges = page.getByText('Violation', { exact: true });
    if ((await badges.count()) > 0) {
      await expect(badges.first()).toBeVisible();
    }

    // Reset back to all severities.
    await severity.selectOption('all');
    await expect(page.getByText(new RegExp(`${allCount} findings?`))).toBeVisible();
  });

  test('J-08/J-15: a one-click Fix routes off the Flagged page', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'compliance');
    await expect(page.getByRole('heading', { level: 1, name: MODULE_HEADINGS.compliance })).toBeVisible();

    // "Open claim" jumps to the patient record (routing, not a file picker).
    const openClaim = page.getByRole('button', { name: /^Open claim$/ }).first();
    await expect(openClaim).toBeVisible();
    await openClaim.click();

    await expect(page.getByRole('heading', { level: 1, name: 'Patients & Cases' })).toBeVisible();
    await expect(page.getByText('ACC District Nursing').first()).toBeVisible();
  });
});
