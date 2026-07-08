import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/app';

/**
 * J-21 — Concurrent tabs. Opening the suite in a second tab (same origin) triggers a
 * "last write wins" warning banner via BroadcastChannel (see src/App.tsx).
 */
test.describe('Concurrent tabs', () => {
  test('J-21: second tab surfaces the concurrent-tab warning banner', async ({ page, context }) => {
    await gotoApp(page);

    const secondTab = await context.newPage();
    await gotoApp(secondTab);

    // Both tabs exchange hello/heartbeat messages; the warning should appear on at least one.
    await expect
      .poll(
        async () => {
          const onFirst = await page.getByTestId('concurrent-tab-warning').isVisible().catch(() => false);
          const onSecond = await secondTab.getByTestId('concurrent-tab-warning').isVisible().catch(() => false);
          return onFirst || onSecond;
        },
        { timeout: 15_000 },
      )
      .toBe(true);

    await secondTab.close();
  });
});
