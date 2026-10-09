import { describe, expect, it } from 'vitest'
import { loadLanguage, translate } from '@/lib/i18n'

describe('language loading', () => {
  it('serves Vietnamese until English has been loaded, then English', async () => {
    expect(translate('vi', 'common.close')).toBe('Đóng')
    // English not fetched yet: falls back to the bundled Vietnamese.
    expect(translate('en', 'common.close')).toBe('Đóng')
    await loadLanguage('en')
    expect(translate('en', 'common.close')).toBe('Close')
  })

  it('falls back to the key for unknown strings', () => {
    expect(translate('vi', 'no.such.key')).toBe('no.such.key')
  })
})
