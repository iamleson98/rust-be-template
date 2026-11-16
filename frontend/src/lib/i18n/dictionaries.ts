import type { Lang, TranslationMap } from './types'
import { vi } from './vi'

/**
 * Vietnamese (the default and the fallback) ships with the app; English is
 * fetched the first time someone switches to it, so most visitors never
 * download it. The admin console's strings (a third of each dictionary) are a
 * file of their own per language, fetched when the console opens.
 */
const loaded: Partial<Record<Lang, TranslationMap>> = { vi }

export const dictionary = (lang: Lang): TranslationMap => loaded[lang] ?? vi

export const fallbackDictionary = vi

/** Whether the console's strings are wanted: from then on a language is loaded with them. */
let consoleWanted = false
const consoleMerges = new Map<Lang, Promise<void>>()

/** Adds the console's strings to the language's own map (in place: lookups read the same object). */
function mergeConsoleStrings(lang: Lang): Promise<void> {
  const target = loaded[lang]
  if (!target) return Promise.resolve()
  let merge = consoleMerges.get(lang)
  if (!merge) {
    merge = (lang === 'en' ? import('./en-admin') : import('./vi-admin')).then((m) => {
      Object.assign(target, 'enAdmin' in m ? m.enAdmin : m.viAdmin)
    })
    consoleMerges.set(lang, merge)
  }
  return merge
}

/** Make `lang`'s strings available; resolves at once when they already are. */
export async function loadLanguage(lang: Lang): Promise<void> {
  if (!loaded[lang] && lang === 'en') loaded.en = (await import('./en')).en
  if (consoleWanted) await mergeConsoleStrings(lang)
}

/** Make the admin console's strings available, in `lang` now and in the other language once it is chosen. */
export async function loadConsoleStrings(lang: Lang): Promise<void> {
  consoleWanted = true
  await loadLanguage(lang)
  await mergeConsoleStrings(lang)
  // Vietnamese is also the fallback of every other language.
  if (lang !== 'vi') await mergeConsoleStrings('vi')
}
