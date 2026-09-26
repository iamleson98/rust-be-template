/**
 * Full-stack admin E2E — the /admin/brands tree table (brands →
 * routes → schedules) with the address-point system, against the real
 * Rust backend (SQLite demo DB).
 *
 * Verifies the user's requirements end-to-end:
 *   1. the brands → routes → schedules subtree table renders and
 *      expands level by level,
 *   2. the smart filter (route start + end points) prunes brands and
 *      auto-expands the matching ones,
 *   3. the schedule form drives start time + start/middle/end point
 *      selects (display = address names, value = address ids),
 *   4. the "create address" modal opens a map with full-text search,
 *      map clicks fill lat/lng, and saving selects the new address for
 *      the point that asked for it,
 *   5. saving the schedule persists and the new row appears.
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

/** Expand BRAND's subtree on /admin/brands and return its row scope. */
async function expandBrand(page: Page) {
  const brandRow = page.locator('tr', { hasText: BRAND }).first()
  await expect(brandRow).toBeVisible({ timeout: 15_000 })
  await brandRow.locator('button[aria-expanded]').first().click()
  // Route rows render under the brand.
  await expect(page.locator('tr', { hasText: ROUTE }).first()).toBeVisible({ timeout: 15_000 })
  return brandRow
}

/** Expand BRAND → ROUTE and wait for the schedule rows. */
async function expandRoute(page: Page) {
  await expandBrand(page)
  const routeRow = page.locator('tr', { hasText: ROUTE }).first()
  await routeRow.locator('button[aria-expanded]').first().click()
  // Seeded schedules appear (08:30 + 20:00 on the demo route).
  await expect(page.getByText('08:30').first()).toBeVisible({ timeout: 15_000 })
  return routeRow
}

test('login lands on the admin dashboard', async ({ page }) => {
  await login(page)
  await expect(page.getByText(/bảng điều khiển/i).first()).toBeVisible()
})

test('brands tree expands brands → routes with cities + counts', async ({ page }) => {
  await login(page)
  await page.goto('/admin/brands')

  await expect(page.getByRole('heading', { name: 'Hãng xe & Tuyến đường' })).toBeVisible()

  // Level 1: the brand row carries counts.
  const brandRow = await expandBrand(page)
  await expect(brandRow).toContainText('tuyến')

  // Level 2: the route row carries the direction + schedule count.
  const routeRow = page.locator('tr', { hasText: ROUTE }).first()
  await expect(routeRow).toContainText('Hồ Chí Minh')
  await expect(routeRow).toContainText('Nha Trang')
  await expect(routeRow).toContainText('lịch trình')

  await page.screenshot({ path: `${ART}/admin-brands-tree.png` })
})

test('brands tree expands schedules with days, prices + point summaries', async ({ page }) => {
  await login(page)
  await page.goto('/admin/brands')
  await expandRoute(page)

  await expect(page.getByText('20:00').first()).toBeVisible()

  // Schedule rows show the days chips, price + the point sequence
  // summary (first → last, midway count).
  const scheduleRow = page.locator('tr', { hasText: '08:30' }).first()
  await expect(scheduleRow).toContainText('T2')
  await expect(scheduleRow).toContainText('Bến xe Miền Đông')
  await expect(scheduleRow).toContainText('Bến xe Nha Trang')

  await page.screenshot({ path: `${ART}/admin-brands-schedules.png` })
})

test('smart filter: start + end points prune brands and auto-expand matches', async ({ page }) => {
  await login(page)
  await page.goto('/admin/brands')

  // Pick the route's start + end points (Hồ Chí Minh → Nha Trang).
  await page.locator('[aria-label="Điểm đi"]').click()
  await item(page).filter({ hasText: 'Hồ Chí Minh' }).first().click()
  await page.locator('[aria-label="Điểm đến"]').click()
  await item(page).filter({ hasText: 'Nha Trang' }).first().click()

  // Matching brands auto-expand with their matching routes inline —
  // no manual expansion needed.
  await expect(page.locator('tr', { hasText: ROUTE }).first()).toBeVisible({ timeout: 15_000 })

  // Brand-level summary counts the matches.
  await expect(page.getByText(/tuyến/i).first()).toBeVisible()
  await page.screenshot({ path: `${ART}/admin-brands-smart-filter.png` })

  // Clearing the filter collapses back to the plain brand list.
  await page.getByRole('button', { name: /xoá lọc/i }).click()
  await expect(page.locator('tr', { hasText: ROUTE })).toHaveCount(0, { timeout: 15_000 })
})

test('schedule form: point selects, map address creation, save with points', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  await page.goto('/admin/brands')
  const routeRow = await expandRoute(page)
  await expect(page.getByText('08:30').first()).toBeVisible({ timeout: 15_000 })

  // Open the create form from the route row's "Thêm lịch trình" action.
  await routeRow.getByRole('button', { name: new RegExp(`thêm lịch trình cho ${ROUTE}`, 'i') }).click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Lộ trình đón — trả khách')).toBeVisible()
  await page.screenshot({ path: `${ART}/schedule-form.png` })

  // ── Point selects: display = address names, value = address ids ──
  // Scope to the DIALOG — the page-level filter selects are behind the
  // overlay and would intercept clicks.
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
  await page.screenshot({ path: `${ART}/admin-brands-after-create.png` })
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
