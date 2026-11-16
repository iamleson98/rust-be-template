import { useCallback } from 'react'
import { usePrefs } from '@/stores/prefs'
import { dictionary, fallbackDictionary } from './dictionaries'
import type { Lang, TranslationMap } from './types'

export { loadConsoleStrings, loadLanguage } from './dictionaries'
export type { Lang, TranslationMap }

type Params = Record<string, string | number>

/**
 * `{name}` placeholders are interpolated in one pass (a value that holds
 * `{other}` is left as it is); a missing key falls back to Vietnamese, then to the key.
 */
export function translate(lang: Lang, key: string, params?: Params): string {
  const text = dictionary(lang)[key] ?? fallbackDictionary[key] ?? key
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  )
}

/** BCP 47 locale for `Intl` / `toLocaleString`. */
export const localeOf = (lang: Lang) => (lang === 'en' ? 'en-US' : 'vi-VN')

/** The current locale, reactive like `useT`. */
export const useLocale = () => localeOf(usePrefs((s) => s.lang))

/** Reactive translator for components; re-renders when the language changes. */
export function useT() {
  const lang = usePrefs((s) => s.lang)
  return useCallback((key: string, params?: Params) => translate(lang, key, params), [lang])
}

/** Translate outside React (zod messages, toasts, helpers) in the current language. */
export const tSync = (key: string, params?: Params) =>
  translate(usePrefs.getState().lang, key, params)
