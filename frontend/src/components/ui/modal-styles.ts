/**
 * The one look every modal shares (Dialog, AlertDialog, Sheet, Drawer): a
 * soft dimmed backdrop, a white surface with a hairline ring and a deep
 * diffuse shadow instead of a hard border, and a round close button.
 *
 * On phones a centred dialog becomes a bottom sheet: full width, anchored to
 * the bottom edge where the thumb is, sliding up, clear of the home bar.
 */

export const MODAL_OVERLAY =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[3px] duration-200'

/** The modal surface: no border, a ring and a long soft shadow. */
export const MODAL_SURFACE =
  'bg-background text-foreground ring-1 ring-slate-900/5 shadow-[0_24px_64px_-12px_rgb(15_23_42/0.32)] dark:ring-white/10'

/** A centred dialog from `sm` up. */
export const MODAL_CENTERED =
  'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto overscroll-contain rounded-2xl p-6 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95'

/** …that is a bottom sheet on phones. */
export const MODAL_SHEET_ON_PHONE =
  'max-sm:top-auto max-sm:bottom-0 max-sm:left-0 max-sm:w-full max-sm:max-w-none max-sm:max-h-[calc(100dvh-1.5rem)] max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-b-none max-sm:rounded-t-[1.75rem] max-sm:p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom'

/** …or takes the whole screen on phones and small tablets (multi-step flows). */
export const MODAL_FULLSCREEN_ON_PHONE =
  'max-md:inset-0 max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:ring-0 max-md:data-[state=open]:zoom-in-100 max-md:data-[state=closed]:zoom-out-100 max-md:data-[state=open]:slide-in-from-bottom max-md:data-[state=closed]:slide-out-to-bottom'

/** The round close button in a modal's top-right corner. */
export const MODAL_CLOSE =
  "absolute top-4 right-4 z-10 grid size-8 place-items-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:pointer-events-none dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"

/** Title and description, left-aligned on every screen. */
export const MODAL_TITLE = 'text-lg leading-snug font-semibold tracking-tight text-foreground'
export const MODAL_DESCRIPTION = 'text-sm leading-relaxed text-muted-foreground'

/** Actions: side by side at the end from `sm`, full-width and stacked on phones. */
export const MODAL_FOOTER =
  'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end max-sm:[&>*]:h-11 max-sm:[&>*]:w-full'
