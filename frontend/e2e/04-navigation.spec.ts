import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Navigation base components — Tabs, Accordion, Collapsible,
 * ScrollArea, Resizable, Menubar, NavigationMenu.
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Tabs', () => {
  test('default tab is visible, switching tabs swaps panels', async ({ page }) => {
    const sec = page.getByTestId('sec-tabs')
    await expect(sec.getByTestId('tabs-panel-account')).toBeVisible()
    await expect(page.getByTestId('tabs-mirror')).toHaveText('account')

    await sec.getByTestId('tab-trigger-password').click()
    await expect(sec.getByTestId('tabs-panel-password')).toBeVisible()
    await expect(sec.getByTestId('tabs-panel-account')).toBeHidden()
    await expect(page.getByTestId('tabs-mirror')).toHaveText('password')

    await sec.getByTestId('tab-trigger-billing').click()
    await expect(sec.getByTestId('tabs-panel-billing')).toBeVisible()
  })

  test('arrow keys move focus between tabs', async ({ page }) => {
    const sec = page.getByTestId('sec-tabs')
    await sec.getByTestId('tab-trigger-account').scrollIntoViewIfNeeded()
    await sec.getByTestId('tab-trigger-account').focus()
    await page.keyboard.press('ArrowRight')
    await expect(sec.getByTestId('tab-trigger-password')).toBeFocused()
    // Base UI tabs: activation follows a manual step — Enter activates the
    // focused tab (WAI-ARIA tabs pattern).
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tabs-mirror')).toHaveText('password')
  })
})

test.describe('Accordion', () => {
  test('first item is open by default, second opens on click', async ({ page }) => {
    const sec = page.getByTestId('sec-accordion')
    await expect(sec.getByTestId('accordion-content-1')).toBeVisible()
    await expect(sec.getByTestId('accordion-content-2')).toBeHidden()

    await sec.getByTestId('accordion-trigger-2').click()
    await expect(sec.getByTestId('accordion-content-2')).toBeVisible()
    await expect(sec.getByTestId('accordion-content-2')).toContainText(
      'held for 10 minutes',
    )
    // Single mode: opening item 2 closes item 1
    await expect(sec.getByTestId('accordion-content-1')).toBeHidden()
  })

  test('trigger toggles its own item closed', async ({ page }) => {
    const sec = page.getByTestId('sec-accordion')
    await sec.getByTestId('accordion-trigger-1').click()
    await expect(sec.getByTestId('accordion-content-1')).toBeHidden()
    await sec.getByTestId('accordion-trigger-1').click()
    await expect(sec.getByTestId('accordion-content-1')).toBeVisible()
  })
})

test.describe('Collapsible', () => {
  test('expands and collapses with state mirror', async ({ page }) => {
    const sec = page.getByTestId('sec-collapsible')
    await expect(sec.getByTestId('collapsible-content')).toBeHidden()
    await expect(page.getByTestId('collapsible-mirror')).toHaveText('false')

    await sec.getByTestId('collapsible-trigger').click()
    await expect(sec.getByTestId('collapsible-content')).toBeVisible()
    await expect(page.getByTestId('collapsible-mirror')).toHaveText('true')

    await sec.getByTestId('collapsible-trigger').click()
    await expect(sec.getByTestId('collapsible-content')).toBeHidden()
  })
})

test.describe('ScrollArea', () => {
  test('content overflows and the viewport scrolls', async ({ page }) => {
    const sec = page.getByTestId('sec-scroll-area')
    const area = sec.getByTestId('scroll-area-demo')
    await expect(area).toBeVisible()

    const viewport = area.locator('[data-slot="scroll-area-viewport"]')
    const info = await viewport.evaluate((el) => {
      const v = el as HTMLElement
      return {
        scrollHeight: v.scrollHeight,
        clientHeight: v.clientHeight,
        canScroll: v.scrollHeight > v.clientHeight,
      }
    })
    expect(info.canScroll).toBe(true)

    // Programmatic scroll (the same mechanism chat-panel.tsx uses for
    // auto-scrolling to the latest message).
    await viewport.evaluate((el) => (el as HTMLElement).scrollTo(0, 300))
    const scrolled = await viewport.evaluate(
      (el) => (el as HTMLElement).scrollTop,
    )
    expect(scrolled).toBeGreaterThan(0)

    // Wheel events also scroll the viewport (real user behavior).
    // The 12-item list in a h-40 viewport overflows by > 150px.
    await viewport.hover()
    await page.mouse.wheel(0, 200)
    await page.waitForTimeout(150)
    const wheelScrolled = await viewport.evaluate(
      (el) => (el as HTMLElement).scrollTop,
    )
    expect(wheelScrolled).toBeGreaterThan(100)
  })
})

test.describe('Resizable', () => {
  test('renders two panels with a draggable separator', async ({ page }) => {
    const sec = page.getByTestId('sec-resizable')
    const group = sec.getByTestId('resizable-demo')
    await expect(group).toBeVisible()
    await expect(group.getByText('Seat map')).toBeVisible()
    await expect(group.getByText('Trip details')).toBeVisible()
    const handle = sec.getByTestId('resizable-handle')
    await expect(handle).toHaveAttribute('role', 'separator')
  })

  test('dragging the handle resizes the panels', async ({ page }) => {
    const sec = page.getByTestId('sec-resizable')
    await sec.scrollIntoViewIfNeeded()
    const panels = sec.getByTestId('resizable-demo').locator('[data-panel]')
    const before = (await panels.first().boundingBox())?.width ?? 0

    const handle = sec.getByTestId('resizable-handle')
    const box = await handle.boundingBox()
    expect(box).toBeTruthy()
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.mouse.down()
    await page.mouse.move(box!.x - 100, box!.y + box!.height / 2, {
      steps: 10,
    })
    await page.mouse.up()

    const after = (await panels.first().boundingBox())?.width ?? 0
    expect(before - after).toBeGreaterThan(50)
  })
})

test.describe('Menubar', () => {
  test('File menu opens with items + checkbox state', async ({ page }) => {
    const sec = page.getByTestId('sec-menubar')
    await sec.getByTestId('menubar-file-trigger').click()
    // Menu content renders in a portal at body level (page-scoped locator)
    const content = page.getByTestId('menubar-file-content')
    await expect(content).toBeVisible()
    await expect(content.getByTestId('menubar-new')).toBeVisible()
    await expect(page.getByTestId('menubar-checked-mirror')).toHaveText('off')

    await content.getByTestId('menubar-checkbox').click()
    await expect(page.getByTestId('menubar-checked-mirror')).toHaveText('on')
  })

  test('menu items trigger actions', async ({ page }) => {
    const sec = page.getByTestId('sec-menubar')
    await sec.getByTestId('menubar-file-trigger').click()
    await page.getByTestId('menubar-export').click()
    await expect(page.getByTestId('menubar-mirror')).toHaveText('export')
  })
})

test.describe('NavigationMenu', () => {
  test('renders horizontal links that are clickable', async ({ page }) => {
    const sec = page.getByTestId('sec-navigation-menu')
    await expect(sec.getByTestId('navigation-menu-demo')).toBeVisible()

    const home = sec.getByTestId('nav-link-home')
    await expect(home).toBeVisible()
    await expect(home).toHaveAttribute('href', '#sec-navigation-menu')
    await expect(sec.getByTestId('nav-link-search')).toHaveText('Search trips')
    await expect(sec.getByTestId('nav-link-support')).toHaveText('Support')
  })
})
