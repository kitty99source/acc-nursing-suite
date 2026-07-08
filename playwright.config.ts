import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright smoke + UAT harness for the ACC District Nursing Admin Suite (P7-008 / P3-007).
 *
 * The app is 100% offline and seeds obviously-fake SAMPLE data on first run (empty
 * IndexedDB). Playwright gives every test a fresh browser context, so each spec starts
 * from a clean IndexedDB and therefore boots into the seeded sample dataset — no PHI,
 * no network, no Outlook COM / Citrix VPN required.
 *
 * Server strategy (best-effort while source is in flux):
 *   - Default: start the Vite dev server (`npm run dev`) on a fixed port. Dev is the most
 *     resilient target because it needs no successful `tsc`/`vite build` (which may fail
 *     under concurrent edits). The app's strict CSP (`connect-src 'none'`) blocks Vite's
 *     HMR websocket — that only produces console noise; the app still renders.
 *   - Override: set E2E_BASE_URL to point at an already-running server (e.g. `vite preview`
 *     of a production build, or the PowerShell static server). When set, Playwright will
 *     NOT spawn its own server.
 */

const PORT = Number(process.env.E2E_PORT ?? 4321);
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? `http://127.0.0.1:${PORT}`;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e/.report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Deterministic clock/locale so date-sensitive sample data renders predictably.
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
  },
  projects: [
    {
      name: 'chromium-desktop',
      // Everything except the mobile-only journeys runs at desktop size.
      grepInvert: /@mobile/,
      use: {
        ...devices['Desktop Chrome'],
        // J-12 asks for the letter-import modal at 1280x720; use it as the default desktop size.
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // J-13 — mobile 375px. Specs tagged @mobile run here.
      name: 'mobile-375',
      grep: /@mobile/,
      use: {
        // Chromium-based mobile emulation (Pixel 5 defaults to chromium) so we only need the
        // one browser download; override the viewport to the target 375px width.
        ...devices['Pixel 5'],
        viewport: { width: 375, height: 667 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: `npm run dev -- --host 127.0.0.1 --port ${PORT} --strictPort`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
