import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openModule } from './helpers/app';
import { fixturePath, FIXTURES } from './helpers/fixtures';

/**
 * J-01 — Approval letter import (happy path, synthetic George Bellingham fixture).
 * J-02 — Corrupt PDF error handling.
 *
 * Uses the shared "Import ACC letter (PDF or Word)" entry point on the Approvals module.
 * The fixture is the repo's own synthetic NUR02 template (matches seeded demo claim
 * 10000000149) — no real PHI.
 */

async function pickLetter(page: Page, fixtureFile: string): Promise<void> {
  const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
  await expect(importBtn).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    importBtn.click(),
  ]);
  await chooser.setFiles(fixturePath(fixtureFile));
}

test.describe('Letter import', () => {
  test('J-01: imports an approval letter and reaches the confirm screen', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'approvals');

    await pickLetter(page, FIXTURES.approvalPdf);

    // A modal opens ("Reading ACC letter…" then a confirm/success state). pdf.js parses
    // in a worker; allow generous time on first run.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // George is a seeded match, so the app must NOT auto-commit — the confirm screen with
    // "Save everything" appears (this is the J-06 guarantee too).
    const saveEverything = page.getByRole('button', { name: /Save everything/i });
    await expect(saveEverything).toBeVisible({ timeout: 45_000 });

    // The parsed letter surfaces the synthetic demo identity.
    await expect(dialog).toContainText(/George|10000000149|YN65488/i);

    // Complete the save and confirm the success panel.
    await saveEverything.click();
    await expect(page.getByText(/Approval letter saved|Import complete|Document attached/i).first())
      .toBeVisible({ timeout: 30_000 });
  });

  test('J-02: shows a graceful error for a corrupt PDF (no blank screen)', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'approvals');

    await pickLetter(page, FIXTURES.corruptPdf);

    // An error modal — not a blank screen — with a retry path.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Could not read letter|Unrecognised letter format|does not look like/i))
      .toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /Try another file/i })).toBeVisible();

    // Shell is still healthy underneath the modal.
    await expect(page.getByText('ACC District Nursing').first()).toBeVisible();
  });
});
