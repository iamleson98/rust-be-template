import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E config for the VeXeVN frontend.
 *
 * Runs against the Vite DEV server (not a production build) so the
 * gallery harness at /ui-gallery.html — a showcase of every base
 * component in src/components/ui — is available. The page makes ZERO
 * API calls, so the Rust backend is not needed.
 *
 * The dev server is started automatically by Playwright's `webServer`
 * on port 5183 (out of the way of the default :3000 used for manual
 * dev + the Caddy preview flow).
 *
 * Run: `bun run test:e2e` (add --headed/--debug/--ui as needed).
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'e2e-report' }],
  ],
  use: {
    baseURL: 'http://localhost:5183',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 7_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'bun run dev --port 5183 --strictPort',
    url: 'http://localhost:5183/ui-gallery.html',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
