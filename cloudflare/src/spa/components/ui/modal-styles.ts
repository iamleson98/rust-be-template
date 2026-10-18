/**
 * The one look every modal shares (Dialog, AlertDialog, Sheet, Drawer): a
 * soft dimmed backdrop, a white surface with a hairline ring and a deep
 * diffuse shadow instead of a hard border, and a round close button.
 *
 * On phones a centred dialog becomes a bottom sheet: full width, anchored to
 * the bottom edge where the thumb is, sliding up, clear of the home bar.
 *
 * A dialog taller than the screen scrolls with the page, not inside itself:
 * the popup sits in a full-screen scrolling viewport and grows with its
 * content (centred while it fits, from the top once it does not).
 */

export const MODAL_OVERLAY =
  "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[3px] duration-200";

/** The modal surface: no border, a ring and a long soft shadow. */
export const MODAL_SURFACE =
  "bg-background text-foreground ring-1 ring-slate-900/5 shadow-[0_24px_64px_-12px_rgb(15_23_42/0.32)] dark:ring-white/10";

/**
 * The full-screen layer that holds the popup and scrolls when it is taller
 * than the screen. One grid cell: as tall as the screen while the popup fits
 * (centring it), as tall as the popup once it does not (scrolling from the top).
 */
export const MODAL_VIEWPORT =
  "fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain p-4 sm:p-8";

/** The viewport of a phone bottom sheet: the sheet sits on the bottom edge. */
export const MODAL_VIEWPORT_SHEET_ON_PHONE = "max-sm:place-items-end max-sm:p-0 max-sm:pt-6";

/** The viewport of a full-screen phone dialog: edge to edge. */
export const MODAL_VIEWPORT_FULLSCREEN_ON_PHONE = "max-md:p-0";

/** A centred dialog from `sm` up. */
export const MODAL_CENTERED =
  "relative grid w-full gap-5 rounded-2xl p-6 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

/** …that is a bottom sheet on phones. */
export const MODAL_SHEET_ON_PHONE =
  "max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[1.75rem] max-sm:p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom";

/** …or takes the whole screen on phones and small tablets (multi-step flows). */
export const MODAL_FULLSCREEN_ON_PHONE =
  "max-md:min-h-dvh max-md:w-full max-md:max-w-none max-md:rounded-none max-md:ring-0 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom";

/** The round close button in a modal's top-right corner. */
export const MODAL_CLOSE =
  "absolute top-4 right-4 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

/** Title and description, left-aligned on every screen. */
export const MODAL_TITLE = "text-lg leading-snug font-semibold tracking-tight text-foreground";
export const MODAL_DESCRIPTION = "text-sm leading-relaxed text-muted-foreground";

/** Actions: side by side at the end from `sm`, full-width and stacked on phones. */
export const MODAL_FOOTER =
  "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end max-sm:[&>*]:h-11 max-sm:[&>*]:w-full";
