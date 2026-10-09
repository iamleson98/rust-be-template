import { useCallback } from 'react'
import { usePrefs } from '@/stores/prefs'
import type { Lang, TranslationMap } from './types'
import { vi } from './vi'
import { en } from './en'

export type { Lang, TranslationMap }

type Params = Record<string, string | number>

const dictionaries: Record<Lang, TranslationMap> = { vi, en }

/** `{name}` placeholders are interpolated; a missing key falls back to English, then to the key. */
export function translate(lang: Lang, key: string, params?: Params): string {
  let text = dictionaries[lang][key] ?? dictionaries.en[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
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
