import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Feedback base components — the sonner Toaster (the app's real toast
 * surface).
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Toast (sonner)', () => {
  test('success toast appears with title + description and can be dismissed', async ({ page }) => {
    await page.getByTestId('toast-btn-success').click()

    const toastEl = page.locator('[data-sonner-toast]')
    await expect(toastEl).toBeVisible()
    await expect(toastEl).toContainText('Booking confirmed!')
    await expect(toastEl).toContainText('Seat 12A held — check your email.')

    await toastEl.getByRole('button', { name: /close toast/i }).click()
    await expect(toastEl).toBeHidden()
  })

  test('error toast renders the destructive style', async ({ page }) => {
    await page.getByTestId('toast-btn-error').click()
    const toastEl = page.locator('[data-sonner-toast]')
    await expect(toastEl).toBeVisible()
    await expect(toastEl).toContainText('Payment failed')
    // richColors: error toasts carry a red-ish background
    const bg = await toastEl.evaluate((el) => getComputedStyle(el).backgroundColor)
    const rgb = bg.match(/\d+/g)?.map(Number) ?? []
    expect(rgb.length).toBeGreaterThanOrEqual(3)
    expect(rgb[0]).toBeGreaterThan(rgb[1]) // red channel dominant
    await toastEl.getByRole('button', { name: /close toast/i }).click()
    await expect(toastEl).toBeHidden()
  })

  test('info toast shows neutral styling and both text lines', async ({ page }) => {
    await page.getByTestId('toast-btn-info').click()
    const toastEl = page.locator('[data-sonner-toast]')
    await expect(toastEl).toBeVisible()
    await expect(toastEl).toContainText('Driver is arriving in 5 minutes')
    await expect(toastEl).toContainText('Bus 51B-123.45 · white Phương Trang sleeper')
  })

  test('auto-dismiss toast disappears on its own', async ({ page }) => {
    await page.getByTestId('toast-btn-auto').click()
    const toastEl = page.locator('[data-sonner-toast]')
    await expect(toastEl).toBeVisible()
    await expect(toastEl).toBeHidden({ timeout: 5_000 })
  })

  test('stacking: two toasts coexist', async ({ page }) => {
    await page.getByTestId('toast-btn-success').click()
    await page.getByTestId('toast-btn-info').click()
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(2)
    // Clean up
    for (const btn of await page
      .locator('[data-sonner-toast]')
      .getByRole('button', { name: /close toast/i })
      .all()) {
      await btn.click().catch(() => {})
    }
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
})
