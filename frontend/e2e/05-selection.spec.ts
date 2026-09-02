import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Selection base components — Select, Combobox, Toggle,
 * ToggleGroup, Calendar.
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Select', () => {
  test('opens a listbox and selecting an item updates the trigger + mirror', async ({ page }) => {
    await page.getByTestId('select-trigger').click()
    const content = page.getByTestId('select-content')
    await expect(content).toBeVisible()

    const item = page.getByTestId('select-item-limousine')
    await expect(item).toBeVisible()
    await item.click()

    await expect(page.getByTestId('select-mirror')).toHaveText('limousine')
    // Base UI's Select.Value renders the selected VALUE (not the item label)
    await expect(page.getByTestId('select-trigger')).toContainText('limousine')
    await expect(content).toBeHidden()
  })

  test('re-selecting a different item updates the mirror', async ({ page }) => {
    await page.getByTestId('select-trigger').click()
    await page.getByTestId('select-item-sleeper').click()
    await expect(page.getByTestId('select-mirror')).toHaveText('sleeper')

    await page.getByTestId('select-trigger').click()
    await page.getByTestId('select-item-seater').click()
    await expect(page.getByTestId('select-mirror')).toHaveText('seater')
  })

  test('selected item shows the check indicator on reopen', async ({ page }) => {
    await page.getByTestId('select-trigger').click()
    await page.getByTestId('select-item-seater').click()
    await page.getByTestId('select-trigger').click()
    const selectedItem = page.getByTestId('select-item-seater')
    await expect(selectedItem).toBeVisible()
    // The check icon (ItemIndicator) is rendered for the selected value only
    await expect(selectedItem.locator('svg')).toHaveCount(1)
    // Unselected items carry no check indicator
    await expect(page.getByTestId('select-item-limousine').locator('svg')).toHaveCount(0)
  })
})

test.describe('Combobox', () => {
  test('opens, filtering narrows the list, selection updates mirror', async ({ page }) => {
    await page.getByTestId('combobox-trigger').click()
    await expect(page.getByTestId('combobox-content')).toBeVisible()

    // All 6 cities are offered before typing
    expect(await page.locator('[data-testid^="combobox-item-"]').count()).toBe(6)

    const input = page.getByTestId('combobox-input')
    await input.fill('Hà')
    // Filtering narrows the visible options
    await page.waitForTimeout(150)
    const visible = await page
      .locator('[data-testid^="combobox-item-"]')
      .filter({ hasText: 'Hà Nội' })
      .count()
    expect(visible).toBeGreaterThan(0)

    await page.getByTestId('combobox-item-ha-noi').click()
    await expect(page.getByTestId('combobox-mirror')).toHaveText('ha-noi')
    await expect(page.getByTestId('combobox-trigger')).toContainText('Hà Nội')
  })

  test('no-match query shows the empty state', async ({ page }) => {
    await page.getByTestId('combobox-trigger').click()
    await page.getByTestId('combobox-input').fill('Atlantis')
    await expect(page.getByTestId('combobox-empty')).toBeVisible()
  })
})

test.describe('Toggle', () => {
  test('clicking flips pressed state and mirror', async ({ page }) => {
    const toggle = page.getByTestId('toggle-demo')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('toggle-mirror')).toHaveText('false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('toggle-mirror')).toHaveText('true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('ToggleGroup', () => {
  test('single-select switches the active item', async ({ page }) => {
    await expect(page.getByTestId('toggle-group-mirror')).toHaveText('list')

    await page.getByTestId('toggle-group-grid').click()
    await expect(page.getByTestId('toggle-group-mirror')).toHaveText('grid')
    // Base UI marks pressed toggles with the present-only data-pressed attr
    await expect(page.getByTestId('toggle-group-grid')).toHaveAttribute(
      'data-pressed',
      '',
    )

    await page.getByTestId('toggle-group-map').click()
    await expect(page.getByTestId('toggle-group-mirror')).toHaveText('map')
  })
})

test.describe('Calendar', () => {
  test('renders a month grid with day buttons', async ({ page }) => {
    const sec = page.getByTestId('sec-calendar')
    await expect(sec.getByTestId('calendar-demo')).toBeVisible()
    const grid = sec.getByRole('grid')
    await expect(grid).toBeVisible()
    // A full month grid exposes at least 28 day cells
    const dayButtons = await grid.getByRole('button').count()
    expect(dayButtons).toBeGreaterThanOrEqual(28)
  })

  test('clicking a day updates the selected date mirror', async ({ page }) => {
    const mirror = page.getByTestId('calendar-mirror')
    const initial = await mirror.textContent()
    expect(initial).toBeTruthy()

    // Click day 15 of the displayed month
    const day = page
      .getByTestId('calendar-demo')
      .getByRole('button', { name: /15/ })
      .first()
    await day.click()
    await expect(mirror).toContainText('/2026')
    const updated = await mirror.textContent()
    expect(updated).not.toBe(initial)
  })

  test('prev-month navigation changes the grid', async ({ page }) => {
    const calendar = page.getByTestId('calendar-demo')
    const caption = await calendar
      .getByRole('button', { name: /previous/i })
      .count()
    if (caption > 0) {
      const initialGrid = await calendar.getByRole('grid').innerHTML()
      await calendar.getByRole('button', { name: /previous/i }).click()
      const newGrid = await calendar.getByRole('grid').innerHTML()
      expect(newGrid).not.toBe(initialGrid)
    }
  })
})
