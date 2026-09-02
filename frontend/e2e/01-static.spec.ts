import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Static base components — render correctness, semantic roles,
 * and visual geometry (sizes / ratios).
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Badge', () => {
  test('renders all 4 variants with correct text', async ({ page }) => {
    const sec = page.getByTestId('sec-badge')
    await expect(sec.getByTestId('badge-default')).toHaveText('Default')
    await expect(sec.getByTestId('badge-secondary')).toHaveText('Secondary')
    await expect(sec.getByTestId('badge-destructive')).toHaveText('Destructive')
    await expect(sec.getByTestId('badge-outline')).toHaveText('Outline')
  })

  test('variants are visually distinguishable (background differs)', async ({ page }) => {
    const bg = async (testId: string) => {
      const sec = page.getByTestId('sec-badge')
      return sec.getByTestId(testId).evaluate(
        (el) => getComputedStyle(el).backgroundColor,
      )
    }
    const [primary, secondary, outline] = await Promise.all([
      bg('badge-default'),
      bg('badge-secondary'),
      bg('badge-outline'),
    ])
    // Light theme: primary is the blue, secondary light gray, outline transparent
    expect(primary).not.toBe(secondary)
    expect(outline).not.toBe(primary)
  })
})

test.describe('Alert', () => {
  test('renders title + description for both variants', async ({ page }) => {
    const sec = page.getByTestId('sec-alert')
    await expect(sec.getByTestId('alert-default')).toBeVisible()
    await expect(sec.getByTestId('alert-destructive')).toBeVisible()
    await expect(sec.getByText('Heads up!')).toBeVisible()
    await expect(
      sec.getByText('You can add components to your app using the CLI.'),
    ).toBeVisible()
    await expect(sec.getByText('Payment failed')).toBeVisible()
    await expect(
      sec.getByText('Your card was declined. Please try another method.'),
    ).toBeVisible()
  })
})

test.describe('Card', () => {
  test('renders header, content, and footer actions', async ({ page }) => {
    const sec = page.getByTestId('sec-card')
    const card = sec.getByTestId('card-demo')
    await expect(card).toBeVisible()
    // CardTitle is a styled <div> (data-slot=card-title) in this port
    await expect(
      card.locator('[data-slot="card-title"]'),
    ).toHaveText('Ho Chi Minh City → Da Lat')
    await expect(
      card.locator('[data-slot="card-description"]'),
    ).toContainText('Limousine 22 seats')
    await expect(card.getByText('380,000₫')).toBeVisible()
    await expect(card.getByTestId('card-book-btn')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Details' })).toBeVisible()
  })
})

test.describe('Skeleton', () => {
  test('renders 3 placeholder bars', async ({ page }) => {
    const sec = page.getByTestId('sec-skeleton')
    for (const id of ['skeleton-line-1', 'skeleton-line-2', 'skeleton-line-3']) {
      await expect(sec.getByTestId(id)).toBeVisible()
    }
    // First bar should be narrower than the second (w-3/4 vs w-full)
    const w1 = await sec.getByTestId('skeleton-line-1').boundingBox()
    const w2 = await sec.getByTestId('skeleton-line-2').boundingBox()
    expect(w1).toBeTruthy()
    expect(w2).toBeTruthy()
    expect(w2!.width).toBeGreaterThan(w1!.width)
  })
})

test.describe('Progress', () => {
  test('renders two bars with proportionally-sized indicators', async ({ page }) => {
    const sec = page.getByTestId('sec-progress')
    const width = async (testId: string) => {
      const box = await sec.getByTestId(testId).locator('[data-slot="progress-indicator"]').boundingBox()
      return box?.width ?? 0
    }
    const trackBox = await sec.getByTestId('progress-33').locator('[data-slot="progress-track"]').boundingBox()
    const w33 = await width('progress-33')
    const w75 = await width('progress-75')
    expect(trackBox).toBeTruthy()
    // 33% and 75% of the same track width, with a small tolerance
    expect(w33).toBeGreaterThan(trackBox!.width * 0.25)
    expect(w33).toBeLessThan(trackBox!.width * 0.41)
    expect(w75).toBeGreaterThan(trackBox!.width * 0.67)
    expect(w75).toBeLessThan(trackBox!.width * 0.83)
  })
})

test.describe('Avatar', () => {
  test('renders image avatar and text fallbacks', async ({ page }) => {
    const sec = page.getByTestId('sec-avatar')
    await expect(sec.getByTestId('avatar-image')).toBeVisible()
    await expect(sec.getByTestId('avatar-fallback')).toContainText('NA')
    await expect(sec.getByTestId('avatar-large')).toContainText('LG')
  })
})

test.describe('Separator', () => {
  test('renders horizontal and vertical separators', async ({ page }) => {
    const sec = page.getByTestId('sec-separator')
    const h = sec.getByTestId('separator-h')
    const v = sec.getByTestId('separator-v')
    await expect(h).toBeVisible()
    await expect(v).toBeVisible()
    const hBox = await h.boundingBox()
    const vBox = await v.boundingBox()
    expect(hBox!.width).toBeGreaterThan(hBox!.height)
    expect(vBox!.height).toBeGreaterThan(vBox!.width)
  })
})

test.describe('Table', () => {
  test('renders 4 header cells + 3 route rows', async ({ page }) => {
    const sec = page.getByTestId('sec-table')
    const table = sec.getByTestId('table-demo')
    await expect(table.getByRole('table')).toBeVisible()
    await expect(table.getByRole('columnheader', { name: 'Route' })).toBeVisible()
    await expect(table.getByRole('cell', { name: 'Hà Nội → Huế' })).toBeVisible()
    await expect(
      table.getByRole('cell', { name: 'Đà Nẵng → Hà Nội' }),
    ).toBeVisible()
    expect(await table.getByRole('row').count()).toBe(4) // header + 3 rows
  })
})

test.describe('Breadcrumb', () => {
  test('renders navigation trail with links', async ({ page }) => {
    const nav = page.getByTestId('sec-breadcrumb').getByTestId('breadcrumb-demo')
    await expect(nav).toHaveAttribute('aria-label', 'breadcrumb')
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Search' })).toBeVisible()
    await expect(nav.getByText('Hà Nội → Huế')).toBeVisible()
  })
})

test.describe('AspectRatio', () => {
  test('container keeps a 16:9 ratio', async ({ page }) => {
    const box = await page
      .getByTestId('sec-aspect-ratio')
      .getByTestId('aspect-ratio-el')
      .boundingBox()
    expect(box).toBeTruthy()
    const ratio = box!.width / box!.height
    expect(ratio).toBeGreaterThan(16 / 9 - 0.05)
    expect(ratio).toBeLessThan(16 / 9 + 0.05)
  })
})

test.describe('Pagination', () => {
  test('renders previous/next + numbered links with active state', async ({ page }) => {
    const nav = page.getByTestId('sec-pagination').getByTestId('pagination-demo')
    await expect(nav).toHaveAttribute('aria-label', 'pagination')
    await expect(nav.getByRole('link', { name: 'Go to previous page' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Go to next page' })).toBeVisible()
    const active = nav.locator('[aria-current="page"]')
    await expect(active).toHaveText('2')
  })
})
