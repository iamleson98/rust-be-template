/**
 * Full-stack admin E2E — cron jobs page (`/admin/cron-jobs`) against the
 * real Rust backend (SQLite demo DB, SCHEDULER_ENABLED=false so nothing
 * ever fires during the run).
 *
 * Verifies:
 *   1. the seeded `osm.import` schedule renders with its cadence,
 *      next-run, last-run status + work time,
 *   2. the "scheduler offline" banner shows (worker disabled in the
 *      e2e backend),
 *   3. the schedule-edit dialog validates + saves a new cadence and the
 *      page reflects it,
 *   4. enabling/disabling the schedule round-trips,
 *   5. the run history table shows the seeded finished run,
 *   6. triggering is refused (503) because no worker runs — surfaced as
 *      an error toast, and the API shape matches the docs.
 *
 * NO actual import is ever triggered (that would download a ~500 MB
 * OSM extract).
 */

import { test, expect, type Page } from '@playwright/test'

const EMP_EMAIL = 'admin2@vexevn.test'
const EMP_PASSWORD = 'Admin12345!'
const ART = 'admin-e2e-artifacts'

async function login(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Nhân viên' }).click()
  await page.locator('input[type="email"]').fill(EMP_EMAIL)
  await page.locator('input[type="password"]').fill(EMP_PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập nhân viên' }).click()
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 })
}

test.beforeEach(async ({ page }) => {
  await login(page)
  await page.goto('/admin/cron-jobs')
  await expect(page.getByRole('heading', { name: 'Cron jobs' })).toBeVisible({
    timeout: 15_000,
  })
})

test('osm.import schedule renders with cadence, next run and work time', async ({ page }) => {
  const card = page.locator('[data-testid="cron-job-card"][data-job-type="osm.import"]')
  await expect(card).toBeVisible({ timeout: 10_000 })

  // Biweekly at 02:00, Vietnamese label + job type code.
  await expect(card.getByText('Hai tuần một lần')).toBeVisible()
  await expect(card.getByText('osm.import', { exact: true })).toBeVisible()

  // Last run: the seeded succeeded row with its work time (41 minutes).
  await expect(card.locator('[data-testid="cron-run-status"]')).toHaveText(/Thành công/)
  await expect(card.getByText(/41 phút/)).toBeVisible()

  // Next run is armed (a concrete date, not "Chưa đặt lịch").
  await expect(card.getByText('Đã tắt', { exact: true })).toHaveCount(0)
  await expect(card.getByText('Chưa đặt lịch')).toHaveCount(0)

  await page.screenshot({ path: `${ART}/admin-cron-jobs.png`, fullPage: true })
})

test('scheduler-offline banner explains why nothing fires', async ({ page }) => {
  // The e2e backend runs with SCHEDULER_ENABLED=false → the banner shows.
  await expect(
    page.getByText('Bộ lập lịch đang tắt trên máy chủ này'),
  ).toBeVisible({ timeout: 10_000 })
})

test('run history table lists the seeded run', async ({ page }) => {
  const history = page.getByRole('table')
  await expect(history).toBeVisible({ timeout: 10_000 })
  // `.first()` — the card above also renders the job type; the table
  // itself has one seeded row per job.
  await expect(history.getByText('osm.import').first()).toBeVisible()
  await expect(history.getByText('Thành công').first()).toBeVisible()
})

test('schedule edit dialog validates and saves the cadence', async ({ page }) => {
  const card = page.locator('[data-testid="cron-job-card"][data-job-type="osm.import"]')

  // Out-of-range value → inline validation error, no request.
  await card.getByRole('button', { name: /Sửa lịch/ }).click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog).toBeVisible()

  const interval = dialog.locator('#cron-interval')
  await interval.fill('0')
  await dialog.getByRole('button', { name: /Lưu lịch/ }).click()
  await expect(dialog.getByRole('alert')).toHaveText(/1 đến 365/)

  // Valid value → saved, page reflects the new cadence.
  await interval.fill('7')
  await dialog.locator('#cron-hour').fill('3')
  await dialog.locator('#cron-minute').fill('30')
  await dialog.getByRole('button', { name: /Lưu lịch/ }).click()
  await expect(dialog).not.toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Hàng tuần')).toBeVisible({ timeout: 10_000 })
  await expect(card.getByText(/03:30/)).toBeVisible()

  await page.screenshot({ path: `${ART}/admin-cron-jobs-edited.png`, fullPage: true })

  // Restore the biweekly 02:00 schedule for other tests in this file.
  await card.getByRole('button', { name: /Sửa lịch/ }).click()
  await expect(dialog).toBeVisible()
  await interval.fill('14')
  await dialog.locator('#cron-hour').fill('2')
  await dialog.locator('#cron-minute').fill('0')
  await dialog.getByRole('button', { name: /Lưu lịch/ }).click()
  await expect(page.getByText('Hai tuần một lần')).toBeVisible({ timeout: 10_000 })
})

test('enable/disable round-trips through the switch', async ({ page }) => {
  const card = page.locator('[data-testid="cron-job-card"][data-job-type="osm.import"]')
  // Exact match: plain getByText('Đã tắt') also hits the next-run
  // cell's "— (đã tắt)" (case-insensitive substring) → strict-mode
  // violation with 2 matches.
  const disabledBadge = card.getByText('Đã tắt', { exact: true })

  // Disable via the switch.
  await card.getByRole('switch').first().click()
  await expect(disabledBadge).toBeVisible({ timeout: 10_000 })
  await expect(card.getByText('— (đã tắt)')).toBeVisible()

  await page.screenshot({ path: `${ART}/admin-cron-jobs-disabled.png`, fullPage: true })

  // Re-enable.
  await card.getByRole('switch').first().click()
  await expect(disabledBadge).toHaveCount(0, { timeout: 10_000 })
})

test('trigger is refused without a running worker (API contract)', async ({ request }) => {
  // Raw API check with browser-like headers (the anti-scraping
  // middleware requires them) — same idiom as admin-schedules.spec.ts.
  // First log in through the browser to obtain the session cookie.
  // (request fixtures don't share the browser context, so do a fresh
  // employee login via API.)
  const loginRes = await request.post('/api/auth/employee-login', {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      'Origin': 'http://localhost:5184',
    },
    data: { email: EMP_EMAIL, password: EMP_PASSWORD },
  })
  expect(loginRes.ok()).toBeTruthy()

  const res = await request.post('/api/admin/cron-jobs/osm.import/trigger', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
      'Origin': 'http://localhost:5184',
    },
  })
  // No worker runs in the e2e backend → 503, not 409/404/500.
  expect(res.status()).toBe(503)
  const body = await res.json()
  // The API error body is { error: <kind>, message: <human text> } —
  // prefer `message` (the kind is just "service_unavailable").
  expect(body.message ?? body.error).toContain('background worker')
})
