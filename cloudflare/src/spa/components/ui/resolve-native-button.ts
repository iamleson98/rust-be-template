import { isValidElement, type ReactElement, type ReactNode } from 'react'

/**
 * Resolve Base UI's `nativeButton` prop for the Radix-style `asChild` →
 * Base UI `render` bridge used by our ui/ wrappers.
 *
 * Why: Base UI logs a console warning and double-applies button
 * semantics when `nativeButton={false}` while the rendered element IS a
 * native <button> — and silently skips role / aria-disabled / keyboard
 * handling when `nativeButton={true}` while the element is NOT a button.
 * Hardcoding either value is wrong for one of the two cases.
 *
 * Resolution rules:
 *  - plain DOM element child → match its actual tag
 *    ('button' → true, anything else → false)
 *  - component child (e.g. shadcn <Button>, which renders a <button>)
 *    → undefined, letting Base UI apply its default (native button)
 *
 * All comparisons are tag-name only — no child props are inspected.
 */
export function resolveNativeButton(children: ReactNode): boolean | undefined {
  if (!isValidElement(children)) return undefined
  const type = (children as ReactElement).type
  return typeof type === 'string' ? type === 'button' : undefined
}
