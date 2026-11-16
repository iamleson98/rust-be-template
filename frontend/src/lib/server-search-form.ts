import { useSearchForm } from '@/stores/search-form'

const FIELDS = ['from', 'to', 'date'] as const

/**
 * The server writes the search card as a plain form (`src/web/content.rs`) that
 * works before the app has started. A visitor who began to fill it in while the
 * app was loading finds their entries in the app's own form: whatever differs
 * from what the server wrote is moved into the search store, which the app's
 * form starts from. Nothing the visitor did not touch is overwritten.
 */
export function carryOverServerSearchForm(root: ParentNode): void {
  const form = root.querySelector<HTMLFormElement>('form[action="/search"]')
  if (!form) return
  const typed: Partial<Record<(typeof FIELDS)[number], string>> = {}
  for (const name of FIELDS) {
    const input = form.elements.namedItem(name)
    if (input instanceof HTMLInputElement && input.value !== input.defaultValue) {
      typed[name] = input.value.trim()
    }
  }
  if (Object.keys(typed).length > 0) useSearchForm.getState().setSearchParams(typed)
}
