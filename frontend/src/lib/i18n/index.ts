// i18n module — Vietnamese / English translation dictionary
//
// This is a lightweight, custom i18n implementation (no external
// library dependency). It's intentionally simple:
//
//   - `useT()` — React hook that returns a `t(key, params?)` function.
//     Re-renders when the language changes (via the Zustand store).
//   - `t(key, params?)` — looks up `key` in the current language's
//     dictionary, interpolates `{param}` placeholders, and falls back
//     to English if the key is missing in the current locale, then to
//     the raw key if missing in both.
//
// ## Structure
//
//   src/lib/i18n/
//     index.ts   — this file: the translate/useT API + registry
//     types.ts   — Lang + TranslationMap shared types
//     vi.ts      — Vietnamese dictionary
//     en.ts      — English dictionary
//
// ## Interpolation
//
// Strings can contain `{paramName}` placeholders:
//   'hero.trustBadge': 'Hơn {count} hành khách tin dùng'
//   t('hero.trustBadge', { count: 1000 }) → 'Hơn 1000 hành khách tin dùng'
//
// ## Adding a new language
//
// 1. Add the locale code to the `Lang` type in `types.ts`.
// 2. Create a new dictionary file (e.g. `ko.ts`) — copy the key list
//    from `en.ts` so parity is easy to eyeball.
// 3. Register it in the `dictionaries` map below.
// 4. Add a switcher option in `components/layout/header.tsx` (and the
//    admin shell).
//
// ## Parity guard
//
// `__tests__/i18n-parity.test.ts` asserts that the vi and en
// dictionaries carry exactly the same key set, so a missing
// translation fails CI instead of silently rendering the raw key.

import { useApp } from '../store'
import type { Lang, TranslationMap } from './types'
import { vi } from './vi'
import { en } from './en'

export type { Lang, TranslationMap }

const dictionaries: Record<Lang, TranslationMap> = { vi, en }

/**
 * Translate a key with optional interpolation params.
 *
 *   t('hero.trustBadge', { count: 1000 })
 *   → 'Hơn 1000 hành khách tin dùng' (vi) / 'Trusted by 1000+ passengers' (en)
 *
 * Falls back to English if the key is missing in the current locale,
 * then to the raw key if missing in both.
 */
export function translate(lang: Lang, key: string, params?: Record<string, string | number>): string {
  let str = dictionaries[lang]?.[key] ?? dictionaries.en?.[key] ?? key
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return str
}

/**
 * Hook-based translation — use this in React components for reactivity.
 * Re-renders when the language changes (via the Zustand store).
 *
 *   const t = useT()
 *   t('nav.home') → 'Trang chủ' (vi) / 'Home' (en)
 *   t('hero.trustBadge', { count: 1000 }) → 'Hơn 1000 hành khách tin dùng'
 */
export function useT() {
  const { lang } = useApp()
  return (key: string, params?: Record<string, string | number>): string =>
    translate(lang, key, params)
}
