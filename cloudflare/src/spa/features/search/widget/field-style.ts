/**
 * One look for every search field, so a row of them lines up: the same
 * label height and the same 44px control. An error adds its line under its
 * own field only; fields align to the top, so the others stay put.
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

/**
 * The label row an unlabelled control in a field row (swap, search) skips to
 * line up with the controls, the row being top-aligned: the label's h-4 plus
 * FIELD_ITEM's space-y-1.5, from the breakpoint the row forms at.
 */
export const LABEL_ROW_MD = "md:mt-[22px]";
export const LABEL_ROW_LG = "lg:mt-[22px]";

/** The field wrapper. */
export const FIELD_ITEM = "relative space-y-1.5";

/** The error under a field: plain red text in the flow, like any form's. */
export const FIELD_ERROR = "pl-1 text-xs leading-4 text-destructive";
