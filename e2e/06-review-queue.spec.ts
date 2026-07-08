import { test, expect, type Page } from '@playwright/test';
import { gotoApp, openModule } from './helpers/app';

/**
 * J-25 — Human Review Queue empty + populated states.
 *
 * Empty state is the default (sample data seeds no staging items) — fully automated.
 * Populated state normally arrives via folder-watch JSON sidecars (needs File System Access
 * + PowerShell on the work laptop). Here we seed the IndexedDB staging queue directly with
 * SYNTHETIC (no-PHI) items so the populated rendering path is still exercised in-browser.
 */

/** Seed the app's staging queue in IndexedDB (store 'kv', key 'stagingQueue'). */
async function seedStagingQueue(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const now = Date.now();
    const items = [
      {
        id: 'e2e-stage-1',
        type: 'letter-import-pending',
        status: 'pending',
        source: 'folder',
        createdAt: now - 60_000,
        severity: 'info',
        title: 'SAMPLE — Approval letter awaiting sign-off',
        summary: 'Synthetic e2e staging item (no PHI). Review & import to file.',
        sourceFileName: 'sample-approval.pdf',
      },
      {
        id: 'e2e-stage-2',
        type: 'letter-import-low-confidence',
        status: 'pending',
        source: 'email',
        createdAt: now - 120_000,
        severity: 'warn',
        title: 'SAMPLE — Low-confidence decline letter',
        summary: 'Synthetic e2e staging item (no PHI). Needs manual confirmation.',
        sourceFileName: 'sample-decline.pdf',
      },
    ];
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('acc-nursing-suite');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(items, 'stagingQueue');
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
}

test.describe('Review Queue states', () => {
  test('J-25: shows the empty state with folder-watch guidance', async ({ page }) => {
    await gotoApp(page);
    await openModule(page, 'review');

    await expect(page.getByRole('heading', { level: 1, name: 'Human Review Queue' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No pending reviews' })).toBeVisible();
    await expect(page.getByText(/Start Folder Watch\.cmd/i)).toBeVisible();
  });

  test('J-25: renders a populated queue from seeded staging items (best-effort)', async ({ page }) => {
    await gotoApp(page);
    await seedStagingQueue(page);

    // Navigate into the queue — it loads staging items on mount.
    await openModule(page, 'review');
    await expect(page.getByRole('heading', { level: 1, name: 'Human Review Queue' })).toBeVisible();

    await expect(page.getByText('SAMPLE — Approval letter awaiting sign-off')).toBeVisible();
    await expect(page.getByText('SAMPLE — Low-confidence decline letter')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Select all/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No pending reviews' })).toHaveCount(0);
  });
});
