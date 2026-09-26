/**
 * Safe extraction of a human-readable message from a thrown value.
 *
 * Thrown values in JS/TS are `unknown` by nature (Error, string, number,
 * structured API error bodies — anything). This narrows properly instead
 * of the old `catch (e: any) { e?.error?.message ?? e?.message }` pattern,
 * which TypeScript cannot check.
 *
 * Handles the shapes this app actually throws/receives:
 *  - `Error` (and subclasses)            → `.message`
 *  - API error body `{ error: { message } }` → nested message
 *  - plain objects with a `message` field
 *  - strings / numbers                   → String(value)
 */
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

export function getErrorMessage(e: unknown, fallback?: string): string {
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'object' && e !== null) {
    const err = (e as { error?: { message?: unknown } }).error
    if (typeof err?.message === 'string' && err.message) return err.message
    const msg = (e as { message?: unknown }).message
    if (typeof msg === 'string' && msg) return msg
  }
  if (typeof e === 'string' && e) return e
  if (typeof e === 'number' && Number.isFinite(e)) return String(e)
  // Fallback follows the app language (vi default) — same string in
  // VI mode, English when the user switched.
  return fallback ?? translate(useApp.getState().lang, 'common.errorOccurred')
}
