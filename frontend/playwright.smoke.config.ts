import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Smoke run against the real Rust server serving the built SPA (`bun run build` → `dist/`) on a
 * database imported from the Worker's fixture. Nothing is started here: `scripts/parity/up.sh`
 * (and `build-places.sh` for the place index) bring the server up, see docs/PARITY.md.
 *
 *   SMOKE_BASE_URL   the server (default http://localhost:3102)
 *   SMOKE_JWT_SECRET its JWT_SECRET: the admin steps sign their own session cookie with it, since
 *                    the fixture's admin has no usable password
 *
 * Run: `bunx playwright test -c playwright.smoke.config.ts`. Screenshots and traces go to the
 * system temp directory, never into the working tree.
 */
export default defineConfig({
  testDir: './e2e-smoke',
  outputDir: join(tmpdir(), 'datxevui-smoke-results'),
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'http://localhost:3102',
    locale: 'vi-VN',
    viewport: { width: 1280, height: 900 },
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'off',
    // The server refuses "HeadlessChrome" (anti-scraping), and a service worker would fetch its
    // script with that User-Agent anyway.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
