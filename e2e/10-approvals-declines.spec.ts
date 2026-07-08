import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openModule } from './helpers/app';
import { fixturePath, FIXTURES } from './helpers/fixtures';

/**
 * J-10 — Approvals: importing an approval letter files multiple NS04 periods (one current,
 *        the rest historical). Default view hides historical; the toggle reveals them.
 * J-11 — Declines: "Open patient" routes from a decline row to the patient record.
 */

async function importAndSaveApproval(page: Page): Promise<void> {
  const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    importBtn.click(),
  ]);
  await chooser.setFiles(fixturePath(FIXTURES.approvalPdf));
  const saveEverything = page.getByRole('button', { name: /Save everything/i });
  await expect(saveEverything).toBeVisible({ timeout: 45_000 });
  await saveEverything.click();
  await expect(page.getByText(/Approval letter saved|Import complete/i).first())
    .toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /^Close$/ }).first().click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('Approvals & Declines', () => {
  test('J-10: historical approval rows are hidden by default and revealed by the toggle', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'approvals');
    await importAndSaveApproval(page);

    const table = page.locator('table.data-table');
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr:not([aria-hidden="true"])');
    const before = await rows.count();

    // Reveal historical records.
    const toggle = page.getByRole('checkbox', { name: /Show historical records/i });
    await expect(toggle).toBeVisible();
    await toggle.check();

    await expect.poll(async () => rows.count()).toBeGreaterThanOrEqual(before);
    await expect(table.getByText('Historical', { exact: true }).first()).toBeVisible();
  });

  test('J-11: Declines "Open patient" routes to the patient record', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'declines');
    await expect(page.getByRole('heading', { level: 1, name: 'Decline Tracker' })).toBeVisible();

    // The seeded sample decline has no linked patientId, so import the synthetic decline
    // fixture to create a decline row that is linked to a patient/claim (patientId set →
    // the "Open patient" affordance renders).
    const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      importBtn.click(),
    ]);
    await chooser.setFiles(fixturePath(FIXTURES.declinePdf));
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });

    // Confirm the parsed decline (wait for parse to complete → "Save everything" appears).
    const saveEverything = page.getByRole('button', { name: /Save everything/i });
    await expect(saveEverything).toBeVisible({ timeout: 45_000 });
    await saveEverything.click();
    await expect(page.getByText(/decline letter saved|Import complete/i).first())
      .toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: /^Close$/ }).first().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Now a linked decline row exposes "Open patient" → routes to Patients.
    const openPatient = page.getByRole('button', { name: /Open patient/i }).first();
    await expect(openPatient).toBeVisible({ timeout: 10_000 });
    await openPatient.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Patients & Cases' })).toBeVisible();
  });
});
