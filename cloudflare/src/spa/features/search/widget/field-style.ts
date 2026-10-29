/**
 * One look for every search field, so a row of them lines up: the same
 * label height, the same 44px control, and an error that floats under its
 * field from md up (a reserved message line pushed every control apart
 * and left an empty band under the form).
 */

/**
 * The small caps label above a field (fixed height: controls line up). It
 * keeps its colour on an error: the field's border and message say it, and a
 * row of red labels only shouts.
 */
export const FIELD_LABEL =
  "block h-4 pl-1 text-[11px] leading-4 font-bold tracking-wider text-slate-600 uppercase data-[error=true]:text-slate-600 dark:text-slate-300 dark:data-[error=true]:text-slate-300";

/** Every control's height and corners. */
// `md:h-11` too: Button and Input shrink to `md:h-9` on desktop by default.
export const FIELD_CONTROL = "h-11 rounded-xl bg-white md:h-11";

/** A control that is not an `<input>` marked like one with `aria-invalid`. */
export const FIELD_INVALID = "border-destructive ring-destructive/20";

/** The field wrapper: positions the floating error. */
export const FIELD_ITEM = "relative space-y-1.5";

/**
 * The error under a field: in flow on phones; from md up a small callout
 * pinned under its own field, over whatever is below, so the row never moves.
 */
export const FIELD_ERROR =
  "pl-1 text-xs leading-4 font-medium text-red-600 md:pointer-events-none md:absolute md:top-full md:left-0 md:z-10 md:mt-1.5 md:w-max md:max-w-full md:rounded-lg md:bg-white md:px-2.5 md:py-1 md:shadow-md md:ring-1 md:ring-red-200 dark:md:bg-slate-900";
