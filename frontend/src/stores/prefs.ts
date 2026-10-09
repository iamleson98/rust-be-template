import { create } from 'zustand'
import type { Lang } from '@/lib/i18n/types'
import { storage } from './storage'

export type Currency = 'VND' | 'USD'

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function initialLang(): Lang {
  const cookie = typeof document === 'undefined' ? undefined : /bus_lang=(vi|en)/.exec(document.cookie)?.[1]
  return (storage.get('bus_lang') ?? cookie) === 'en' ? 'en' : 'vi'
}

type PrefsState = {
  lang: Lang
  setLang: (lang: Lang) => void
  currency: Currency
  setCurrency: (currency: Currency) => void
}

/** Language + currency, persisted (the cookie lets the server read the language too). */
export const usePrefs = create<PrefsState>((set) => ({
  lang: initialLang(),
  setLang: (lang) => {
    storage.set('bus_lang', lang)
    if (typeof document !== 'undefined') {
      document.cookie = `bus_lang=${lang}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax`
    }
    set({ lang })
  },
  currency: storage.get('bus_currency') === 'USD' ? 'USD' : 'VND',
  setCurrency: (currency) => {
    storage.set('bus_currency', currency)
    set({ currency })
  },
}))
