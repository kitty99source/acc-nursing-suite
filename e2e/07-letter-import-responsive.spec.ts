import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openModule } from './helpers/app';
import { fixturePath, FIXTURES } from './helpers/fixtures';

/**
 * J-12 — Letter-import modal at 1280x720: footer actions must not be clipped.
 * J-13 — Mobile 375px: sidebar hamburger toggles, and the letter-import modal goes full-width.
 *
 * The desktop project runs at 1280x720 (see playwright.config.ts); the @mobile test runs in
 * the dedicated 375px project.
 */

async function openApprovalImport(page: Page): Promise<void> {
  await openModule(page, 'approvals');
  const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    importBtn.click(),
  ]);
  await chooser.setFiles(fixturePath(FIXTURES.approvalPdf));
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 });
}

test.describe('Letter-import modal layout', () => {
  test('J-12: modal footer actions are reachable at 1280x720', async ({ page }, testInfo) => {
    // This assertion is meaningful at desktop size only.
    test.skip(testInfo.project.name !== 'chromium-desktop', 'Desktop-size journey');

    await gotoApp(page);
    await openApprovalImport(page);

    // Wait for the confirm screen (George is a seeded match → no auto-commit).
    const saveEverything = page.getByRole('button', { name: /Save everything/i });
    await expect(saveEverything).toBeVisible({ timeout: 45_000 });

    const cancel = page.getByRole('button', { name: /^Cancel$/ }).last();
    await expect(cancel).toBeVisible();

    // Footer buttons must sit within the 720px-tall viewport (not clipped off-screen).
    const box = await saveEverything.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(720);
    }

    // The button is actually interactable (Playwright actionability = visible + enabled + hit-testable).
    await expect(saveEverything).toBeEnabled();
  });

  test('J-13: @mobile sidebar toggles and the import modal is full-width', async ({ page }) => {
    await gotoApp(page);

    const viewport = page.viewportSize();
    expect(viewport?.width).toBeLessThan(400);

    // Hamburger opens the off-canvas sidebar. The TopBar condenses its Save/Load buttons to
    // icon-only at narrow widths, so the ☰ toggle has a clean, non-overlapping tap target — a
    // real click (with actionability/hit-testing) lands on the toggle, not the Save button.
    const menu = page.getByRole('button', { name: /open menu/i }).first();
    await menu.click();

    // Drawer is now open — its close (✕) affordance is on-screen.
    const closeMenu = page.getByRole('button', { name: /close menu/i });
    await expect(closeMenu).toBeInViewport();

    // Toggle works both ways — close it so the Dashboard content is interactive. (The close
    // affordance stays in the DOM; the drawer just slides off-canvas, so assert it left the
    // viewport rather than the DOM.)
    await closeMenu.click();
    await expect(closeMenu).not.toBeInViewport();

    // The Dashboard "Today's work" card exposes the letter import entry point — use it (no
    // deep sidebar scroll needed). Confirm the modal spans (almost) the full narrow viewport.
    const importBtn = page.getByRole('button', { name: /Import ACC letter/i }).first();
    await importBtn.scrollIntoViewIfNeeded();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      importBtn.click(),
    ]);
    await chooser.setFiles(fixturePath(FIXTURES.approvalPdf));
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box && viewport) {
      // max-sm:max-w-none → the card fills the width minus the p-4 (16px) backdrop padding each side.
      expect(box.width).toBeGreaterThan(viewport.width - 60);
    }
  });
});
