import { defineConfig, devices } from '@playwright/test'

/**
 * Full-stack admin E2E config — exercises the brand → route → schedule
 * management feature against the REAL Rust backend + Vite dev server.
 *
 * - `webServer[0]`: the Rust backend (target/debug/backend, SQLite demo
 *   DB at /tmp/vexevn/app.db, seeded Tantivy place index). Requires a
 *   prior `bash scripts/seed_demo.sh` (run automatically here).
 * - `webServer[1]`: Vite dev server on port 5184 — its `/api` proxy
 *   targets 127.0.0.1:8080, same as manual dev.
 *
 * Run: `bun run test:e2e:admin` (from frontend/).
 */
export default defineConfig({
  testDir: './e2e-admin',
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // shared demo DB — sequential by design
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5184',
    trace: 'off',
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10_000,
    locale: 'vi-VN',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'bash ./e2e-admin/start-backend.sh',
      url: 'http://127.0.0.1:8080/health',
      reuseExistingServer: true,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'bun run dev --port 5184 --strictPort',
      url: 'http://localhost:5184/',
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
