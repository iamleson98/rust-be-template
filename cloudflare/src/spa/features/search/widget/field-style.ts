/**
 * One look for every search field, so a row of them lines up: the same
 * label height, the same 44px control, and an error that floats under its
 * field from md up (a reserved message line pushed every control apart
 * and left an empty band under the form).
 */

/** The small caps label above a field (fixed height: controls line up). */
export const FIELD_LABEL =
  'block h-4 pl-1 text-[11px] leading-4 font-bold tracking-wider text-slate-600 uppercase dark:text-slate-300'

/** Every control's height and corners. */
// `md:h-11` too: Button and Input shrink to `md:h-9` on desktop by default.
export const FIELD_CONTROL = 'h-11 rounded-xl bg-white md:h-11'

/** The field wrapper: positions the floating error. */
export const FIELD_ITEM = 'relative space-y-1.5'

/** The error under a field: in flow on phones, floating from md up. */
export const FIELD_ERROR = 'text-xs leading-4 md:absolute md:top-full md:left-1 md:mt-0.5'
