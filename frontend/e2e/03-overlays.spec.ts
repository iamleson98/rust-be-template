import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Overlay base components — open/close lifecycle, Escape key,
 * backdrop, focus management, and click-out behavior.
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Dialog', () => {
  test('opens from trigger, shows title + description, closes on Cancel', async ({ page }) => {
    await page.getByTestId('dialog-trigger').click()
    const content = page.getByTestId('dialog-content')
    await expect(content).toBeVisible()
    await expect(content).toHaveAttribute('role', 'dialog')
    await expect(
      content.getByRole('heading', { name: 'Confirm your booking' }),
    ).toBeVisible()
    await expect(
      content.getByText('Seat 12A · Hà Nội → Huế · 350,000₫'),
    ).toBeVisible()
    await content.getByTestId('dialog-cancel').click()
    await expect(content).toBeHidden()
  })

  test('Escape key closes the dialog', async ({ page }) => {
    await page.getByTestId('dialog-trigger').click()
    const content = page.getByTestId('dialog-content')
    await expect(content).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(content).toBeHidden()
  })

  test('confirm action updates the result mirror', async ({ page }) => {
    await page.getByTestId('dialog-trigger').click()
    await page.getByTestId('dialog-confirm').click()
    await expect(page.getByTestId('dialog-mirror')).toHaveText('booked')
  })

  test('built-in close (X) button closes the dialog', async ({ page }) => {
    await page.getByTestId('dialog-trigger').click()
    const content = page.getByTestId('dialog-content')
    await content.getByRole('button', { name: 'Close' }).click()
    await expect(content).toBeHidden()
  })

  test('focus moves inside the dialog when opened', async ({ page }) => {
    await page.getByTestId('dialog-trigger').click()
    const content = page.getByTestId('dialog-content')
    const focusedInDialog = await content.evaluate(
      (el) => el.contains(document.activeElement),
    )
    expect(focusedInDialog).toBe(true)
  })
})

test.describe('AlertDialog', () => {
  test('cancel keeps the account, action deletes it', async ({ page }) => {
    await page.getByTestId('alert-dialog-trigger').click()
    const content = page.getByTestId('alert-dialog-content')
    await expect(content).toBeVisible()
    await content.getByTestId('alert-dialog-cancel').click()
    await expect(page.getByTestId('alert-dialog-mirror')).toHaveText('untouched')

    await page.getByTestId('alert-dialog-trigger').click()
    await page.getByTestId('alert-dialog-action').click()
    await expect(page.getByTestId('alert-dialog-mirror')).toHaveText('deleted')
  })
})

test.describe('Sheet', () => {
  test('opens as a right-side panel with title + description', async ({ page }) => {
    await page.getByTestId('sheet-trigger').click()
    const content = page.getByTestId('sheet-content')
    await expect(content).toBeVisible()
    await expect(content).toHaveAttribute('role', 'dialog')
    await expect(
      content.getByRole('heading', { name: 'Hà Nội → Huế express' }),
    ).toBeVisible()
    // Panel is anchored to the right edge of the viewport
    const box = await content.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.x + box!.width).toBeGreaterThan(1270) // 1280 viewport - 10px
    await page.keyboard.press('Escape')
    await expect(content).toBeHidden()
  })
})

test.describe('Drawer', () => {
  test('opens a bottom drawer and closes via footer button', async ({ page }) => {
    await page.getByTestId('drawer-trigger').click()
    const content = page.getByTestId('drawer-content')
    await expect(content).toBeVisible()
    await expect(
      content.getByRole('heading', { name: 'Filter trips' }),
    ).toBeVisible()
    await content.getByTestId('drawer-close').click()
    await expect(content).toBeHidden()
  })
})

test.describe('DropdownMenu', () => {
  test('opens and items are clickable with state update', async ({ page }) => {
    await page.getByTestId('dropdown-trigger').click()
    const content = page.getByTestId('dropdown-content')
    await expect(content).toBeVisible()
    await content.getByTestId('dropdown-profile').click()
    await expect(page.getByTestId('dropdown-mirror')).toHaveText('profile')
    await expect(content).toBeHidden() // closes after item click
  })

  test('submenu opens on hover and its items work', async ({ page }) => {
    await page.getByTestId('dropdown-trigger').click()
    const subTrigger = page.getByTestId('dropdown-sub-trigger')
    await subTrigger.hover()
    await page.getByTestId('dropdown-export').click()
    await expect(page.getByTestId('dropdown-mirror')).toHaveText('export')
  })

  test('checkbox item toggles checked state', async ({ page }) => {
    await page.getByTestId('dropdown-trigger').click()
    // closeOnClick={false} keeps the menu open while toggling
    await page.getByTestId('dropdown-checkbox').click()
    await expect(page.getByTestId('dropdown-hidden-mirror')).toHaveText('shown')
    await expect(page.getByTestId('dropdown-content')).toBeVisible()

    await page.getByTestId('dropdown-checkbox').click()
    await expect(page.getByTestId('dropdown-hidden-mirror')).toHaveText('hidden')
  })

  test('Escape closes the menu', async ({ page }) => {
    await page.getByTestId('dropdown-trigger').click()
    await expect(page.getByTestId('dropdown-content')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('dropdown-content')).toBeHidden()
  })
})

test.describe('Popover', () => {
  test('opens on click and shows anchored content', async ({ page }) => {
    await page.getByTestId('popover-trigger').click()
    const content = page.getByTestId('popover-content')
    await expect(content).toBeVisible()
    await expect(content.getByText('Included in fare')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(content).toBeHidden()
  })
})

test.describe('Tooltip', () => {
  test('shows on hover and hides on leave', async ({ page }) => {
    const trigger = page.getByTestId('tooltip-trigger')
    await trigger.hover()
    await expect(page.getByTestId('tooltip-content')).toBeVisible()
    await expect(page.getByTestId('tooltip-content')).toHaveText(
      'Seats are held for 10 minutes',
    )
    // Move the mouse far away — tooltip should close
    await page.mouse.move(640, 500)
    await expect(page.getByTestId('tooltip-content')).toBeHidden()
  })
})

test.describe('HoverCard', () => {
  test('shows rich preview on hover', async ({ page }) => {
    await page.getByTestId('hover-card-trigger').hover()
    const content = page.getByTestId('hover-card-content')
    await expect(content).toBeVisible()
    await expect(content.getByText('VeXeVN Support')).toBeVisible()
  })
})

test.describe('ContextMenu', () => {
  test('right-click opens menu, item click updates mirror', async ({ page }) => {
    const zone = page.getByTestId('context-zone')
    await zone.click({ button: 'right' })
    const content = page.getByTestId('context-content')
    await expect(content).toBeVisible()
    await content.getByTestId('context-copy').click()
    await expect(page.getByTestId('context-mirror')).toHaveText('copied')
  })
})
