import { describe, expect, it } from 'vitest'
import { loadConsoleStrings, loadLanguage, translate } from '@/lib/i18n'

describe('language loading', () => {
  it('serves Vietnamese until English has been loaded, then English', async () => {
    expect(translate('vi', 'common.close')).toBe('Đóng')
    // English not fetched yet: falls back to the bundled Vietnamese.
    expect(translate('en', 'common.close')).toBe('Đóng')
    await loadLanguage('en')
    expect(translate('en', 'common.close')).toBe('Close')
  })

  it('fills placeholders in one pass: a value that holds one is left alone', () => {
    expect(translate('vi', 'seo.page.corridorHeading', { from: '{to}', to: 'Huế' })).toBe(
      'Xe từ {to} đi Huế',
    )
    expect(translate('vi', 'seo.page.corridorHeading')).toBe('Xe từ {from} đi {to}')
  })

  it('falls back to the key for unknown strings', () => {
    expect(translate('vi', 'no.such.key')).toBe('no.such.key')
  })

  it('brings the admin console strings with the console, in both languages', async () => {
    await loadConsoleStrings('vi')
    expect(translate('vi', 'admin.dashboard')).toBe('Bảng điều khiển')
    await loadLanguage('en')
    expect(translate('en', 'admin.dashboard')).toBe('Dashboard')
  })
})
