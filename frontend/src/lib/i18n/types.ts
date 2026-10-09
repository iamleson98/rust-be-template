/** Supported UI languages. Adding one: create a dictionary file and
 *  register it in `./index.ts` (see the header docs there). */
export type Lang = 'vi' | 'en'

/** Flat translation map: i18n key → translated string. */
export type TranslationMap = Record<string, string>
