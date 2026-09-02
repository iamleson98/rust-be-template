import { expect, type Page } from '@playwright/test'

/**
 * Navigate to the UI gallery (dev-only harness page) and wait for it
 * to be fully rendered. Guarantees a clean light theme per test.
 */
export async function gotoGallery(page: Page) {
  await page.goto('/ui-gallery.html')
  await expect(
    page.getByRole('heading', { name: 'VeXeVN UI Component Gallery' }),
  ).toBeVisible()

  // Reset to light theme for deterministic tests (unless the test
  // itself opts into dark mode via toggleDarkMode below).
  const html = page.locator('html')
  const isDark = await html.evaluate((el) => el.classList.contains('dark'))
  if (isDark) {
    await page.getByTestId('theme-toggle').click()
  }
  await expect(html).not.toHaveClass(/dark/)
}

/** Switch the gallery to dark theme (toggles .dark on <html>). */
export async function toggleDarkMode(page: Page) {
  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveClass(/dark/)
}
