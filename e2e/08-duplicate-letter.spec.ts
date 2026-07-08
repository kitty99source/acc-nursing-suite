import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openModule } from './helpers/app';
import { fixturePath, FIXTURES } from './helpers/fixtures';

/**
 * J-22 — Duplicate letter warning (best-effort / pending final validation).
 *
 * Import the same synthetic approval PDF twice onto the same seeded claim. On the second
 * save the app should warn "Duplicate file?" before re-attaching. This depends on the
 * save/auto-commit + dedup flow which is under concurrent edit, so it is marked best-effort.
 */

async function importApproval(page: Page): Promise<void> {
  const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    importBtn.click(),
  ]);
  await chooser.setFiles(fixturePath(FIXTURES.approvalPdf));
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
}

test.describe('Duplicate letter', () => {
  test('J-22: warns when the same file is imported to the same claim twice', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'approvals');

    // First import → save everything → success.
    await importApproval(page);
    const saveEverything1 = page.getByRole('button', { name: /Save everything/i });
    await expect(saveEverything1).toBeVisible({ timeout: 45_000 });
    await saveEverything1.click();
    await expect(page.getByText(/Approval letter saved|Import complete/i).first())
      .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Close$/ }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Second import of the identical file → save → duplicate warning.
    await importApproval(page);
    const saveEverything2 = page.getByRole('button', { name: /Save everything/i });
    await expect(saveEverything2).toBeVisible({ timeout: 45_000 });
    await saveEverything2.click();

    await expect(page.getByRole('heading', { name: 'Duplicate file?' }))
      .toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/already on claim 10000000149/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Import anyway/i })).toBeVisible();
  });
});
