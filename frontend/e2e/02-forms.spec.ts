import { expect, test } from '@playwright/test'

import { gotoGallery } from './fixtures'

/**
 * Form base components — typing, toggling, keyboard interaction,
 * validation, and state mirrors.
 */
test.beforeEach(async ({ page }) => {
  await gotoGallery(page)
})

test.describe('Button', () => {
  test('counter increments on each click', async ({ page }) => {
    const counter = page.getByTestId('btn-counter')
    const value = page.getByTestId('btn-counter-value')
    await expect(value).toHaveText('0')
    await counter.click()
    await expect(value).toHaveText('1')
    await counter.dblclick()
    await expect(value).toHaveText('3')
  })

  test('disabled buttons are inert', async ({ page }) => {
    const disabled = page.getByTestId('btn-disabled')
    await expect(disabled).toBeDisabled()
    // Playwright auto-waits for actionability; a disabled button click
    // would time out, so assert the disabled state + no pointer events.
    const pointerEvents = await disabled.evaluate(
      (el) => getComputedStyle(el).pointerEvents,
    )
    expect(['none', '']).toContain(pointerEvents)
    const loading = page.getByTestId('btn-loading')
    await expect(loading).toBeDisabled()
  })

  test('all 6 variants render side by side', async ({ page }) => {
    const sec = page.getByTestId('sec-button')
    for (const v of [
      'default',
      'secondary',
      'destructive',
      'outline',
      'ghost',
      'link',
    ]) {
      await expect(sec.getByTestId(`btn-${v}`)).toBeVisible()
    }
    await expect(sec.getByTestId('btn-icon')).toHaveAttribute(
      'aria-label',
      'Search',
    )
  })

  test('keyboard focus reaches buttons in DOM order', async ({ page }) => {
    await page.locator('[data-testid="btn-default"]').focus()
    await expect(page.getByTestId('btn-default')).toBeFocused()
  })
})

test.describe('Input + Label', () => {
  test('typing updates value and mirror', async ({ page }) => {
    const input = page.getByTestId('input-demo')
    await input.fill('Nguyen Thi B')
    await expect(input).toHaveValue('Nguyen Thi B')
    await expect(page.getByTestId('input-mirror')).toHaveText('Nguyen Thi B')
    await input.fill('')
    await expect(page.getByTestId('input-mirror')).toHaveText('—')
  })

  test('label click focuses the associated input', async ({ page }) => {
    const sec = page.getByTestId('sec-input')
    await sec.getByLabel('Full name').click()
    await expect(page.getByTestId('input-demo')).toBeFocused()
  })

  test('disabled input cannot be typed into', async ({ page }) => {
    const input = page.getByTestId('input-disabled')
    await expect(input).toBeDisabled()
    await expect(input).toHaveValue('read-only value')
  })

  test('error input carries aria-invalid for styling', async ({ page }) => {
    const input = page.getByTestId('input-error')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  })
})

test.describe('Textarea', () => {
  test('typing updates the live character counter', async ({ page }) => {
    const ta = page.getByTestId('textarea-demo')
    await ta.fill('Wheelchair access please')
    await expect(page.getByTestId('textarea-count')).toHaveText('24')
  })

  test('maxLength caps the input at 100 characters', async ({ page }) => {
    const ta = page.getByTestId('textarea-demo')
    await ta.fill('x'.repeat(120))
    const len = await ta.evaluate((el) => (el as HTMLTextAreaElement).value.length)
    expect(len).toBe(100)
  })
})

test.describe('Checkbox', () => {
  test('default-checked box starts checked', async ({ page }) => {
    const cb = page.getByTestId('checkbox-1')
    await expect(cb).toBeChecked()
  })

  test('terms checkbox toggles state and mirror', async ({ page }) => {
    const cb = page.getByTestId('checkbox-terms')
    await expect(cb).not.toBeChecked()
    await cb.click()
    await expect(cb).toBeChecked()
    await expect(page.getByTestId('checkbox-mirror')).toHaveText('yes')
    await cb.click()
    await expect(cb).not.toBeChecked()
    await expect(page.getByTestId('checkbox-mirror')).toHaveText('no')
  })
})

test.describe('Switch', () => {
  test('toggles on/off with state mirror', async ({ page }) => {
    const sw = page.getByTestId('switch-demo')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('switch-mirror')).toHaveText('on')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('switch-mirror')).toHaveText('off')
  })
})

test.describe('RadioGroup', () => {
  test('selecting an option updates mirror and deselects the previous', async ({ page }) => {
    await expect(page.getByTestId('radio-mirror')).toHaveText('momo')
    // Base UI renders a visually-hidden native input; clicking the
    // associated <label> is the accessible way to select.
    await page.getByText('VNPay QR', { exact: true }).click()
    await expect(page.getByTestId('radio-mirror')).toHaveText('vnpay')
    await expect(page.locator('#gallery-radio-momo')).not.toBeChecked()
    await page.getByText('Cash on delivery', { exact: true }).click()
    await expect(page.getByTestId('radio-mirror')).toHaveText('cod')
  })
})

test.describe('InputOTP', () => {
  test('typing digits fills slots and mirror', async ({ page }) => {
    // input-otp renders a transparent native <input> overlaying the group;
    // clicking it focuses the OTP entry.
    const input = page.getByTestId('otp-demo')
    const group = page.getByTestId('otp-group')
    await input.click()
    await page.keyboard.type('123456', { delay: 30 })
    await expect(page.getByTestId('otp-mirror')).toHaveText('123456')
    // First slot shows the first digit
    await expect(group.locator('[data-slot="input-otp-slot"]').first()).toHaveText('1')
  })

  test('partial entry keeps the mirror in sync', async ({ page }) => {
    await page.getByTestId('otp-demo').click()
    await page.keyboard.type('42', { delay: 30 })
    await expect(page.getByTestId('otp-mirror')).toHaveText('42')
  })
})

test.describe('Slider', () => {
  test('keyboard arrows adjust the value', async ({ page }) => {
    const slider = page.getByTestId('slider-demo')
    const thumb = slider.getByRole('slider')
    await expect(page.getByTestId('slider-mirror')).toHaveText('40')
    await thumb.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('slider-mirror')).toHaveText('41')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByTestId('slider-mirror')).toHaveText('39')
  })

  test('Home/End jump to extremes', async ({ page }) => {
    const thumb = page.getByTestId('slider-demo').getByRole('slider')
    await thumb.focus()
    await page.keyboard.press('Home')
    await expect(page.getByTestId('slider-mirror')).toHaveText('0')
    await page.keyboard.press('End')
    await expect(page.getByTestId('slider-mirror')).toHaveText('100')
  })
})

test.describe('Form (react-hook-form + zod)', () => {
  test('empty submit shows validation messages and blocks save', async ({ page }) => {
    await page.getByTestId('form-submit').click()
    await expect(page.getByTestId('form-username-error')).toContainText(
      'at least 3 characters',
    )
    await expect(page.getByTestId('form-email-error')).toContainText(
      'valid email',
    )
    await expect(page.getByTestId('form-status')).toHaveText('idle')
  })

  test('valid input submits and shows success status', async ({ page }) => {
    await page.getByTestId('form-username').fill('leson')
    await page.getByTestId('form-email').fill('leson@vexevn.vn')
    await page.getByTestId('form-submit').click()
    await expect(page.getByTestId('form-status')).toHaveText('ok:leson')
    // Errors are gone once valid
    await expect(page.getByTestId('form-username-error')).toBeHidden()
  })

  test('clearing a field re-triggers validation', async ({ page }) => {
    await page.getByTestId('form-username').fill('leson')
    await page.getByTestId('form-email').fill('leson@vexevn.vn')
    await page.getByTestId('form-username').fill('ab')
    await page.getByTestId('form-submit').click()
    await expect(page.getByTestId('form-username-error')).toBeVisible()
    // Still not submitted (invalid), so status remains idle
    await expect(page.getByTestId('form-status')).toHaveText('idle')
  })
})
