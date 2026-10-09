import type { Lang, TranslationMap } from './types'
import { vi } from './vi'

/**
 * Vietnamese (the default and the fallback) ships with the app; English is
 * fetched the first time someone switches to it, so most visitors never
 * download it.
 */
const loaded: Partial<Record<Lang, TranslationMap>> = { vi }

export const dictionary = (lang: Lang): TranslationMap => loaded[lang] ?? vi

export const fallbackDictionary = vi

/** Make `lang`'s strings available; resolves at once when they already are. */
export async function loadLanguage(lang: Lang): Promise<void> {
  if (loaded[lang]) return
  if (lang === 'en') loaded.en = (await import('./en')).en
}
