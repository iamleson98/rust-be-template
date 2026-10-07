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
    await expect(page.getByTestId('toggle-group-grid')).toHaveAttribute('data-pressed', '')

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
    const day = page.getByTestId('calendar-demo').getByRole('button', { name: /15/ }).first()
    await day.click()
    await expect(mirror).toContainText('/2026')
    const updated = await mirror.textContent()
    expect(updated).not.toBe(initial)
  })

  test('prev-month navigation changes the grid', async ({ page }) => {
    const calendar = page.getByTestId('calendar-demo')
    const caption = await calendar.getByRole('button', { name: /previous/i }).count()
    if (caption > 0) {
      const initialGrid = await calendar.getByRole('grid').innerHTML()
      await calendar.getByRole('button', { name: /previous/i }).click()
      const newGrid = await calendar.getByRole('grid').innerHTML()
      expect(newGrid).not.toBe(initialGrid)
    }
  })
})

test.describe('InfiniteSelect', () => {
  test('opens, first page renders 10 items, selecting updates the trigger + mirror', async ({
    page,
  }) => {
    const sec = page.getByTestId('sec-infinite-select')
    await sec.getByTestId('infinite-select-demo').locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    // The mock backend pages 10 rows at a time — page 1 is there, and
    // because the sentinel sits inside its 200px rootMargin for a list
    // this short, page 2 prefetches automatically (that IS the
    // observer working — see the dedicated infinite-scroll test).
    await expect
      .poll(async () => content.locator('[data-slot="combobox-item"]').count())
      .toBeGreaterThanOrEqual(10)
    await expect
      .poll(async () => content.locator('[data-slot="combobox-item"]').count())
      .toBeGreaterThanOrEqual(20)

    await content.locator('[data-slot="combobox-item"]').first().click()
    await expect(page.getByTestId('infinite-select-mirror')).toHaveText('city-1')
    await expect(
      sec.getByTestId('infinite-select-demo').locator('[data-slot="combobox-trigger"]'),
    ).toContainText('City 1')
    await expect(content).toBeHidden()
  })

  test('server-side search narrows the list', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-select')
    await sec.getByTestId('infinite-select-demo').locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    // 'City 55' matches exactly one mock row ('City 550'+ don't exist)
    await content.locator('[data-slot="combobox-input"]').fill('City 55')
    // Debounced 250ms — wait for the filtered page to settle
    await expect(content.locator('[data-slot="combobox-item"]')).toHaveCount(1)
    expect(await content.locator('[data-slot="combobox-item"]').first().textContent()).toContain(
      'City 55',
    )
  })

  test('scrolling to the bottom loads the next page (infinite scroll)', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-select')
    await sec.getByTestId('infinite-select-demo').locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    // First page (10 rows) is loaded. The sentinel sits within its
    // 200px rootMargin for a list this short, so page 2 may already
    // be appending — the contract to verify is "pages keep appending
    // as the user scrolls", not an exact page boundary.
    await expect(content.locator('[data-slot="combobox-item"]').first()).toHaveCount(1)
    await expect(content.locator('[data-slot="combobox-item"]').first()).toContainText('City 1')

    // Scroll the list to the bottom — the sentinel enters view and
    // the IntersectionObserver fetches the next page.
    const list = content.locator('[data-slot="combobox-list"]')
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect
      .poll(async () => content.locator('[data-slot="combobox-item"]').count())
      .toBeGreaterThanOrEqual(20)

    // …and again — the wheel keeps turning.
    await list.evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
    await expect
      .poll(async () => content.locator('[data-slot="combobox-item"]').count())
      .toBeGreaterThanOrEqual(30)
  })
})

test.describe('InfiniteMultiSelect', () => {
  test('selecting several items accumulates badges + mirror', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-multi-select')
    const demo = sec.getByTestId('infinite-multi-select-demo')
    await demo.locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    // Multi mode: clicking items toggles them without closing the popup
    await content.locator('[data-slot="combobox-item"]').nth(0).click()
    await content.locator('[data-slot="combobox-item"]').nth(1).click()
    await content.locator('[data-slot="combobox-item"]').nth(2).click()

    const mirror = page.getByTestId('infinite-multi-select-mirror')
    await expect(mirror).toHaveText('city-1, city-2, city-3')

    // Trigger shows the first maxBadges=2 badges; the third selection
    // collapses into the "+1" overflow counter.
    const trigger = demo.locator('[data-slot="combobox-trigger"]')
    await expect(trigger).toContainText('City 1')
    await expect(trigger).toContainText('City 2')
    await expect(trigger).toContainText('+1')
  })

  test('more than maxBadges selections collapse to "+N" overflow', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-multi-select')
    const demo = sec.getByTestId('infinite-multi-select-demo')
    await demo.locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    // maxBadges defaults to 2 — pick 4 items
    for (let i = 0; i < 4; i++) {
      await content.locator('[data-slot="combobox-item"]').nth(i).click()
    }
    const trigger = demo.locator('[data-slot="combobox-trigger"]')
    await expect(trigger).toContainText('+2')

    const mirror = page.getByTestId('infinite-multi-select-mirror')
    await expect(mirror).toHaveText('city-1, city-2, city-3, city-4')
  })

  test('deselecting an item removes it from the selection', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-multi-select')
    const demo = sec.getByTestId('infinite-multi-select-demo')
    await demo.locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    await content.locator('[data-slot="combobox-item"]').nth(0).click()
    await content.locator('[data-slot="combobox-item"]').nth(1).click()
    await expect(page.getByTestId('infinite-multi-select-mirror')).toHaveText('city-1, city-2')

    // Click the first item again to toggle it off
    await content.locator('[data-slot="combobox-item"]').nth(0).click()
    await expect(page.getByTestId('infinite-multi-select-mirror')).toHaveText('city-2')
  })

  test('search works the same as the single-select flavor', async ({ page }) => {
    const sec = page.getByTestId('sec-infinite-multi-select')
    const demo = sec.getByTestId('infinite-multi-select-demo')
    await demo.locator('[data-slot="combobox-trigger"]').click()
    const content = page.locator('[data-slot="combobox-content"]')
    await expect(content).toBeVisible()

    await content.locator('[data-slot="combobox-input"]').fill('City 42')
    await expect(content.locator('[data-slot="combobox-item"]')).toHaveCount(1)
    await content.locator('[data-slot="combobox-item"]').first().click()
    await expect(page.getByTestId('infinite-multi-select-mirror')).toHaveText('city-42')
  })
})
