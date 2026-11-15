/**
 * Smoke run of the SPA on the Rust server, over the database imported from the Worker's fixture
 * (see playwright.smoke.config.ts). One worker, in file order: the steps share one database, and a
 * failing step does not stop the ones after it.
 */
import { expect, test, type Page } from '@playwright/test'
import { CUSTOMER, searchUrl, signInAsAdmin, signInAsCustomer, gradientPng } from './support'

/** Fixture 40-seat trip of Phương Trang, three days out: plenty of free seats on every run. */
async function openBigTrip(page: Page) {
  await page.goto(searchUrl(3))
  await expect(page.getByRole('heading', { level: 1, name: 'Hà Nội → Đà Nẵng' })).toBeVisible()
  const card = page.getByRole('article').filter({ hasText: 'Phương Trang' }).first()
  await card.getByRole('button', { name: 'Chọn chuyến' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'Sơ đồ ghế' })).toBeVisible()
  return dialog
}

/** Seat, passenger and contact steps; stops on the payment step. */
async function fillBookingUpToPayment(page: Page) {
  const dialog = await openBigTrip(page)
  await dialog
    .getByRole('button', { name: /còn trống/ })
    .first()
    .click()
  await dialog.getByRole('button', { name: 'Đặt vé', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Tên hành khách' }).fill('Nguyễn Văn Worker')
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click()
  await expect(dialog.getByRole('heading', { name: 'Thông tin liên hệ' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tiếp tục' }).click()
  await expect(dialog.getByRole('heading', { name: 'Phương thức thanh toán' })).toBeVisible()
  return dialog
}

test('home → search → trip detail with its seat map', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: /Đặt vé xe khách/ })).toBeVisible()
  await page.getByRole('button', { name: 'Tìm chuyến xe' }).click()
  await expect(page).toHaveURL(/\/search\?/)
  await expect(page.getByRole('heading', { level: 1, name: 'Hà Nội → Đà Nẵng' })).toBeVisible()
  await expect(page.getByText(/chuyến xe tìm thấy/)).toBeVisible()
  expect(await page.getByRole('article').count()).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Chọn chuyến' }).first().click()
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}/)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('tab', { name: 'Sơ đồ ghế' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: /còn trống/ }).first()).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Đăng nhập để đặt vé' })).toBeDisabled()
})

test('login with the imported pbkdf2 account, and a wrong password is refused', async ({
  page,
}) => {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email *' }).fill(CUSTOMER.email)
  await page.getByRole('textbox', { name: 'Mật khẩu *' }).fill('sai-mat-khau')
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('region', { name: /Notifications/ })).toContainText(/\S/)

  await signInAsCustomer(page)
  const me = await page.request.get('/api/auth/me')
  expect(me.ok()).toBe(true)
  expect(await me.json()).toMatchObject({ user: { email: CUSTOMER.email } })
})

test('seat hold and cash-on-board checkout end in a pending ticket', async ({ page }) => {
  await signInAsCustomer(page)
  const dialog = await fillBookingUpToPayment(page)
  await expect(dialog.getByRole('radio', { name: /Thanh toán tại xe/ })).toBeChecked()
  await dialog.getByRole('button', { name: /Xác nhận đặt vé/ }).click()

  await expect(dialog.getByRole('heading', { name: 'Đặt vé thành công!' })).toBeVisible()
  const code = (await dialog.locator('code').innerText()).trim()
  expect(code).toMatch(/^[A-Z]{2}-[A-Z0-9]{6}$/)

  const booking = await page.request.get(`/api/bookings/${code}`)
  expect(booking.ok()).toBe(true)
  expect(await booking.json()).toMatchObject({ code, status: 'pending', paymentMethod: 'cod' })

  await page.goto(`/account/trips/${code}`)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(code)
  await expect(page.getByText('Chờ xác nhận')).toBeVisible()
  await expect(page.getByText('Trả tiền khi lên xe')).toBeVisible()
})

test('VietQR is offered at checkout and shows the bank transfer details', async ({ page }) => {
  await signInAsCustomer(page)
  const providers = await page.request.get('/api/payments/providers')
  expect((await providers.json()).providers).toContain('vietqr')

  const dialog = await fillBookingUpToPayment(page)
  await dialog.getByRole('radio', { name: /VietQR|chuyển khoản/i }).click()
  await dialog.getByRole('button', { name: /Xác nhận đặt vé/ }).click()
  await expect(dialog.getByText('Số tài khoản')).toBeVisible()
  await expect(dialog.getByText('Nội dung CK')).toBeVisible()
})

test('brand page shows the brand, its routes and its upcoming trips', async ({ page }) => {
  await page.goto('/brands/viet-bus')
  await expect(page.getByRole('heading', { level: 1, name: 'Việt Bus' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tuyến đường & lịch chạy' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Chuyến sắp khởi hành' })).toBeVisible()
  await expect(page.getByRole('link', { name: '19001234' })).toBeVisible()
})

test('admin edits a brand and the public page shows the change', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL ?? '')
  await page.goto('/admin/brands')
  await page.getByRole('button', { name: 'Sửa hãng Thành Bưởi' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa hãng xe' })
  const description = `Giường nằm, cập nhật ${Date.now()}`
  await dialog.getByRole('textbox', { name: 'Mô tả' }).fill(description)
  // The fixture row says children up to 40; the form takes at most 17.
  await dialog.getByRole('spinbutton', { name: 'Trẻ em đến (tuổi)' }).fill('12')
  // The hotline stays a mobile number here: see the next test for a 1900 hotline.
  await dialog.getByRole('textbox', { name: 'Hotline' }).fill('0901234567')
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()

  const brand = await page.request.get('/api/brands/thanh-buoi')
  expect(await brand.json()).toMatchObject({ slug: 'thanh-buoi', description })
  await page.goto('/brands/thanh-buoi')
  await expect(page.getByText(description)).toBeVisible()
})

test('admin saves a brand that keeps its 1900 hotline', async ({ page, context, baseURL }) => {
  await signInAsAdmin(context, baseURL ?? '')
  await page.goto('/admin/brands')
  await page.getByRole('button', { name: 'Sửa hãng Phương Trang' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa hãng xe' })
  await expect(dialog.getByRole('textbox', { name: 'Hotline' })).toHaveValue('19006067')
  await dialog.getByRole('textbox', { name: 'Mô tả' }).fill(`Cập nhật ${Date.now()}`)
  await dialog.getByRole('spinbutton', { name: 'Trẻ em đến (tuổi)' }).fill('12')
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/admin\/brands\//.test(r.url()),
  )
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  expect((await saved).status()).toBe(200)
  await expect(dialog).toBeHidden()
})

test('admin uploads a route picture and it is served as WebP', async ({
  page,
  context,
  baseURL,
}) => {
  await signInAsAdmin(context, baseURL ?? '')
  await page.goto('/admin/brands')
  await page.getByRole('button', { name: 'Mở rộng tuyến của Thành Bưởi' }).click()
  await page.getByRole('button', { name: 'Sửa tuyến Hà Nội → Đà Nẵng' }).click()
  const dialog = page.getByRole('dialog', { name: 'Sửa tuyến đường' })
  await expect(dialog.getByRole('heading', { name: 'Ảnh tuyến' })).toBeVisible()

  const before = await dialog.getByRole('listitem').count()
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ name: 'route.png', mimeType: 'image/png', buffer: gradientPng() })
  await expect(dialog.getByRole('listitem')).toHaveCount(before + 1)
  // The picture is only sent, re-encoded and stored when the route is saved.
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click()
  await expect(dialog).toBeHidden()

  const route = await page.request.get('/api/admin/routes?limit=50')
  const routeId = (await route.json()).items.find((r: { id: string; brand?: { slug?: string } }) =>
    r.id.startsWith('5dee08f3'),
  ).id
  const pictures = (await (await page.request.get(`/api/routes/${routeId}/pictures`)).json()).items
  expect(pictures.length).toBeGreaterThan(0)
  const image = await page.request.get(pictures.at(-1).url)
  expect(image.ok()).toBe(true)
  expect(image.headers()['content-type']).toBe('image/webp')
})

test('an unknown address answers 404 with the not-found page', async ({ page }) => {
  const response = await page.goto('/khong-co-trang-nay')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1, name: /404/ })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Về trang chủ' })).toBeVisible()
  await expect(page).toHaveTitle(/Không tìm thấy trang/)
})

test('place search finds a bus station by name, in the suggestions and on the map', async ({
  page,
}) => {
  await page.goto('/')
  const from = page.getByRole('combobox', { name: 'Thành phố, bến xe' }).first()
  await from.fill('Mỹ Đình')
  await expect(page.getByRole('button', { name: /Bến xe Mỹ Đình/ }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Chọn trên bản đồ' }).first().click()
  const map = page.getByRole('dialog', { name: 'Chọn vị trí trên bản đồ' })
  await map.getByRole('textbox', { name: 'Tìm thành phố, bến xe…' }).fill('Mỹ Đình')
  await map.getByRole('button', { name: 'Bến xe Mỹ Đình, Hà Nội' }).click()
  await expect(map.getByText(/21\.0288, 105\.7782/)).toBeVisible()
  await map.getByRole('button', { name: 'Chọn', exact: true }).click()
  await expect(map).toBeHidden()
  await expect(from).toHaveValue('Bến xe Mỹ Đình')
})
