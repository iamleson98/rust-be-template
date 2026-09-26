import { describe, expect, it } from 'vitest'
import { vi as viDict } from '@/lib/i18n/vi'
import { en as enDict } from '@/lib/i18n/en'

/**
 * Dictionary parity guard — the vi and en dictionaries must carry
 * EXACTLY the same key set. A missing translation would silently render
 * the raw i18n key (or the wrong language after the fallback chain), so
 * drift is caught here at CI time instead.
 */
describe('i18n dictionaries', () => {
  it('vi and en expose the same key set', () => {
    const viKeys = Object.keys(viDict).sort()
    const enKeys = Object.keys(enDict).sort()
    expect(viKeys).toEqual(enKeys)
  })

  it('no empty translations', () => {
    for (const [key, value] of Object.entries(viDict)) {
      expect(value.trim(), `vi.${key} is empty`).not.toBe('')
    }
    for (const [key, value] of Object.entries(enDict)) {
      expect(value.trim(), `en.${key} is empty`).not.toBe('')
    }
  })

  it('placeholder params match across languages', () => {
    // Every {param} used in the vi string must appear in the en string
    // (and vice versa) — otherwise one language interpolates a value the
    // other drops.
    const placeholders = (s: string) =>
      Array.from(s.matchAll(/\{(\w+)\}/g))
        .map((m) => m[1])
        .sort()
        .join(',')
    for (const [key, viValue] of Object.entries(viDict)) {
      const enValue = enDict[key]
      expect(placeholders(viValue), `placeholder mismatch for ${key}`).toBe(
        placeholders(enValue),
      )
    }
  })
})
