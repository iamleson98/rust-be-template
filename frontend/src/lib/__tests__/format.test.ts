import { beforeEach, describe, expect, it } from 'vitest'
import { usePrefs } from '@/stores/prefs'
import { formatVndShort } from '../format'

describe('formatVndShort', () => {
  beforeEach(() => usePrefs.setState({ lang: 'vi' }))

  it('rounds to thousands below a million', () => {
    expect(formatVndShort(350_000)).toBe('350k')
    expect(formatVndShort(262_500)).toBe('263k')
  })

  it('uses millions above, in the visitor language', () => {
    expect(formatVndShort(1_250_000)).toBe('1.3tr')
    expect(formatVndShort(2_000_000)).toBe('2tr')
    usePrefs.setState({ lang: 'en' })
    expect(formatVndShort(2_000_000)).toBe('2M')
  })
})
