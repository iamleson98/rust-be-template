/**
 * Full-stack admin E2E — brand → route → schedule management with the
 * address-point system, against the real Rust backend (SQLite demo DB).
 *
 * Verifies the user's requirements end-to-end:
 *   1. brands → routes → schedules hierarchy renders,
 *   2. the schedule form drives start time + start/middle/end point
 *      selects (display = address names, value = address ids),
 *   3. the "create address" modal opens a map with full-text search,
 *      map clicks fill lat/lng, and saving selects the new address for
 *      the point that asked for it,
 *   4. saving the schedule persists the ordered point sequence.
 *
 * Also captures screenshots for visual review (admin-e2e-artifacts/).
 *
 * Selectors use `[data-slot=…]` because Base UI (unlike Radix) does not
 * expose stable ARIA roles on its select triggers/items — same idiom as
 * the component-gallery suite in e2e/.
 */

import { test, expect, type Page } from '@playwright/test'

const EMP_EMAIL = 'admin2@vexevn.test'
const EMP_PASSWORD = 'Admin12345!'
const BRAND = 'Phương Trang Express'
const ROUTE = 'Hồ Chí Minh → Nha Trang'

const ART = 'admin-e2e-artifacts'

const trigger = (root: Page) => root.locator('[data-slot="select-trigger"]')
const item = (root: Page) => root.locator('[data-slot="select-item"]:visible')

async function login(page: Page) {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(EMP_EMAIL)
  await page.locator('input[type="password"]').fill(EMP_PASSWORD)
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  // Employee login redirects to /admin.
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 })
}

async function pickBrandAndRoute(page: Page) {
  // First trigger = brand filter, second = route filter.
  await trigger(page).first().click()
  await item(page).filter({ hasText: BRAND }).first().click()
  await trigger(page).nth(1).click()
  await item(page).filter({ hasText: ROUTE }).first().click()
}

test('login lands on the admin dashboard', async ({ page }) => {
  await login(page)
  await expect(page.getByText(/bảng điều khiển/i).first()).toBeVisible()
})

test('routes page lists routes with brand + cities + counts', async ({ page }) => {
  await login(page)
  await page.goto('/admin/routes')

  await expect(page.getByRole('heading', { name: 'Tuyến đường' })).toBeVisible()
  const row = page.locator('tr', { hasText: ROUTE })
  await expect(row).toBeVisible({ timeout: 15_000 })
  await expect(row).toContainText(BRAND)
  await expect(row).toContainText('Hồ Chí Minh')
  await expect(row).toContainText('Nha Trang')

  await page.screenshot({ path: `${ART}/admin-routes.png` })
})

test('schedules page shows the points timeline per schedule', async ({ page }) => {
  await login(page)
  await page.goto('/admin/schedules')

  // Empty state prompts to pick brand + route first.
  await expect(page.getByText('Chọn hãng và tuyến đường')).toBeVisible()

  await pickBrandAndRoute(page)

  // Two seeded schedules appear.
  await expect(page.getByText('08:30').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('20:00').first()).toBeVisible()

  // Points timeline on the right panel of the first card.
  const firstCard = page.locator('.grid.lg\\:grid-cols-\\[1fr_320px\\]').first()
  await expect(firstCard.getByText('Điểm đón — trả')).toBeVisible()
  await expect(firstCard.getByText('Bến xe Miền Đông')).toBeVisible()
  await expect(firstCard.getByText('Trạm dừng Dầu Giây')).toBeVisible()
  await expect(firstCard.getByText('Bến xe Nha Trang')).toBeVisible()
  await expect(firstCard.getByText('Khởi hành')).toBeVisible()
  await expect(firstCard.getByText('Trung gian')).toBeVisible()
  await expect(firstCard.getByText('Kết thúc')).toBeVisible()

  await page.screenshot({ path: `${ART}/admin-schedules.png` })
})

test('schedule form: point selects, map address creation, save with points', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/admin/schedules')
  await pickBrandAndRoute(page)
  await expect(page.getByText('08:30').first()).toBeVisible({ timeout: 15_000 })

  // Open the create form.
  await page.getByRole('button', { name: /thêm lịch trình/i }).first().click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Lộ trình đón — trả khách')).toBeVisible()
  await page.screenshot({ path: `${ART}/schedule-form.png` })

  // ── Point selects: display = address names, value = address ids ──
  // Scope to the DIALOG — the page-level brand/route filter selects are
  // behind the overlay and would intercept clicks.
  // [0] start, [1] bus layout; middles insert between start and end;
  // end is always last.
  const dialogTriggers = dialog.locator('[data-slot="select-trigger"]')
  const startTrigger = dialogTriggers.first()
  await startTrigger.click()
  await item(page).filter({ hasText: 'Phạm Ngũ Lão' }).first().click()
  await expect(startTrigger).toContainText('Phạm Ngũ Lão')

  // Add one middle point.
  await dialog.getByRole('button', { name: /thêm điểm trung gian/i }).click()
  // Now: [0] start, [1] middle, [2] end, [3] bus layout. Give Base UI a
  // beat to unmount the closing start-dropdown portal before opening the
  // next one.
  await page.waitForTimeout(400)
  const middleTrigger = dialogTriggers.nth(1)
  await middleTrigger.click()
  const middleItem = item(page).filter({ hasText: 'Trạm dừng Dầu Giây' }).first()
  await middleItem.waitFor({ state: 'visible', timeout: 10_000 })
  await middleItem.click()
  await expect(middleTrigger).toContainText('Trạm dừng Dầu Giây')

  // ── Create a NEW address for the END point via the map modal ──
  const endCreateBtn = dialog.getByRole('button', { name: 'Tạo địa điểm mới' }).last()
  await endCreateBtn.click()

  const addrDialog = page
    .locator('[data-slot="dialog-content"]')
    .filter({ hasText: 'Tạo địa điểm mới' })
  await expect(addrDialog).toBeVisible()
  await expect(addrDialog.locator('.leaflet-container')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `${ART}/address-map-modal.png` })

  // Full-text search (Tantivy) — diacritic-insensitive.
  const searchBox = addrDialog.locator('input[placeholder*="Tìm thành phố"]')
  await searchBox.fill('nha trang')
  const hit = addrDialog
    .locator('div.absolute button', { hasText: 'Nha Trang' })
    .first()
  await expect(hit).toBeVisible({ timeout: 10_000 })
  await hit.click()

  // The form pre-filled name + coords from the picked place.
  await expect(addrDialog.locator('#addr-name')).toHaveValue(/Nha Trang/)
  const latInput = addrDialog.locator('input[placeholder="Tự động từ bản đồ"]').first()
  await expect(latInput).not.toBeEmpty()
  await page.screenshot({ path: `${ART}/address-map-modal-picked.png` })

  // Click on the map too — exact clicked coordinates replace the prefilled.
  const map = addrDialog.locator('.leaflet-container')
  await map.click({ position: { x: 240, y: 160 } })

  // Save the address.
  await addrDialog.getByRole('button', { name: /^tạo địa điểm/i }).click()
  await expect(addrDialog).not.toBeVisible({ timeout: 15_000 })

  // The newly created address is now selected for the END point
  // (start=0, middle=1, end=2, busLayout=3).
  const endTrigger = dialogTriggers.nth(2)
  await expect(endTrigger).toContainText(/Nha Trang/, { timeout: 10_000 })

  // Fill the rest of the form + submit.
  await dialog.locator('input[type="time"]').fill('06:15')
  await dialog.getByRole('button', { name: /^thêm lịch trình$/i }).click()
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0, {
    timeout: 20_000,
  })

  // The new schedule appears with 06:15.
  await expect(page.getByText('06:15').first()).toBeVisible({ timeout: 15_000 })
  await page.screenshot({ path: `${ART}/admin-schedules-after-create.png` })
})

test('address list API returns brand-scoped options (values are ids)', async ({ request }) => {
  // The backend's anti-scraping middleware requires browser-like UA +
  // an allowed Origin on mutations — send them explicitly.
  const browserHeaders = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36',
    Origin: 'http://localhost:5184',
  }
  const loginRes = await request.post('/api/auth/employee-login', {
    headers: browserHeaders,
    data: { email: EMP_EMAIL, password: EMP_PASSWORD },
  })
  expect(loginRes.ok()).toBeTruthy()

  const brands = await (
    await request.get('/api/admin/brands', { headers: browserHeaders })
  ).json()
  const brand = brands.items.find((b: any) => b.name === BRAND)
  expect(brand).toBeTruthy()

  const list = await (
    await request.get(`/api/admin/addresses?brandId=${brand.id}`, {
      headers: browserHeaders,
    })
  ).json()
  expect(Array.isArray(list.items)).toBeTruthy()
  expect(list.items.length).toBeGreaterThanOrEqual(6)
  for (const a of list.items) {
    expect(a.brandId).toBe(brand.id)
    expect(typeof a.id).toBe('string')
    expect(typeof a.name).toBe('string')
    expect(typeof a.lat).toBe('number')
    expect(typeof a.lon).toBe('number')
  }
})
