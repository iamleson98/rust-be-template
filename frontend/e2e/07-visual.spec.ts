import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

import { gotoGallery, toggleDarkMode } from './fixtures'

/**
 * Visual + theming verification.
 *
 * Instead of brittle toHaveScreenshot baselines, these tests assert:
 *  1. the light/dark theme swap actually changes CSS custom
 *     properties (background/foreground colors flip), and
 *  2. capture full-page screenshots of both themes as artifacts for
 *     human/AI visual review (saved to e2e-artifacts/).
 */
const ARTIFACT_DIR = path.resolve(import.meta.dirname, '../e2e-artifacts')

test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Theming', () => {
  test('dark mode toggles the .dark class and swaps real CSS colors', async ({ page }) => {
    // The gallery root div carries bg-background (theme-aware token)
    const root = page.locator('.min-h-screen')
    await expect(root).toBeVisible()

    const lightBg = await root.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(lightBg).toBeTruthy()

    await toggleDarkMode(page)
    const darkBg = await root.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(darkBg).toBeTruthy()
    expect(darkBg).not.toBe(lightBg)

    // Theme label mirror reflects the state
    await expect(page.getByTestId('theme-label')).toHaveText('dark')

    // Toggle back — colors restore
    await page.getByTestId('theme-toggle').click()
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    const backBg = await root.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(backBg).toBe(lightBg)
  })

  test('dark mode restyles a primary button (variant colors change)', async ({ page }) => {
    const btn = page.getByTestId('btn-default')
    const lightColor = await btn.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    await toggleDarkMode(page)
    const darkColor = await btn.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    )
    expect(darkColor).not.toBe(lightColor)
  })
})

test.describe('Visual artifacts', () => {
  test('capture full-page gallery screenshots (light + dark)', async ({ page }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })

    // Let entrance animations settle
    await page.waitForTimeout(400)

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'gallery-light.png'),
      fullPage: true,
    })

    await toggleDarkMode(page)
    await page.waitForTimeout(400)
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'gallery-dark.png'),
      fullPage: true,
    })

    for (const file of ['gallery-light.png', 'gallery-dark.png']) {
      const stat = fs.statSync(path.join(ARTIFACT_DIR, file))
      // A fully rendered multi-section gallery should weigh far more
      // than a blank page (~10-20 KB). Blank/error pages fail this.
      expect(stat.size, `${file} looks blank`).toBeGreaterThan(50_000)
    }
  })

  test('capture section close-ups for visual review', async ({ page }) => {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
    await page.waitForTimeout(300)

    const sections = [
      ['sec-button', 'section-buttons.png'],
      ['sec-form', 'section-form.png'],
      ['sec-card', 'section-card.png'],
      ['sec-dialog', 'section-dialog.png'],
    ] as const

    for (const [testId, file] of sections) {
      await page.getByTestId(testId).screenshot({
        path: path.join(ARTIFACT_DIR, file),
      })
      const stat = fs.statSync(path.join(ARTIFACT_DIR, file))
      expect(stat.size).toBeGreaterThan(5_000)
    }
  })
})
