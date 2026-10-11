'use client'

import { type ComponentProps, type ReactElement, type ReactNode, isValidElement } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import {
  MODAL_CENTERED,
  MODAL_CLOSE,
  MODAL_DESCRIPTION,
  MODAL_FOOTER,
  MODAL_FULLSCREEN_ON_PHONE,
  MODAL_OVERLAY,
  MODAL_SHEET_ON_PHONE,
  MODAL_SURFACE,
  MODAL_TITLE,
} from './modal-styles'
import { resolveNativeButton } from './resolve-native-button'

/**
 * Radix-compat wrapper around Base UI's Dialog.
 *
 * API differences handled:
 *  - `Dialog.Root`     → Base UI `Dialog.Root` (same)
 *  - `Dialog.Trigger`  → Base UI `Dialog.Trigger` (same). Radix `asChild`
 *                        is translated to Base UI's `render` prop.
 *  - `Dialog.Portal`   → Base UI `Dialog.Portal` (same)
 *  - `Dialog.Overlay`  → Base UI `Dialog.Backdrop` (renamed)
 *  - `Dialog.Content`  → Base UI `Dialog.Popup` (renamed)
 *  - `Dialog.Title`    → Base UI `Dialog.Title` (same)
 *  - `Dialog.Description` → Base UI `Dialog.Description` (same)
 *  - `Dialog.Close`    → Base UI `Dialog.Close` (same)
 *
 * Base UI Dialog does NOT have a `Positioner` (unlike Tooltip/Popover) —
 * `Dialog.Portal` renders the backdrop and popup directly inside a portal.
 *
 * Radix `data-state="open|closed"` is emitted on Backdrop/Popup/Close via
 * the `render` prop, so tw-animate-css classes like `data-[state=open]:animate-in`
 * continue to work alongside Base UI's native `data-[open]` selectors.
 *
 * The `onOpenChange` callback signature is compatible: Base UI calls
 * `(open, eventDetails)` but consumers passing `(open) => void` work fine
 * (fewer-arg function is assignable to more-arg function type).
 */

function Dialog({
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Root>, 'children'> & {
  children?: ReactNode
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Trigger>, 'render'> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    // Translate Radix `asChild` to Base UI `render` prop. Base UI clones
    // the provided element with its own internal props (onClick, ref, etc.).
    return (
      <DialogPrimitive.Trigger
        data-slot="dialog-trigger"
        nativeButton={resolveNativeButton(children)}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props}>
      {children}
    </DialogPrimitive.Trigger>
  )
}

function DialogPortal({ ...props }: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Close>, 'render'> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <DialogPrimitive.Close
        data-slot="dialog-close"
        nativeButton={resolveNativeButton(children)}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  // Emit data-state="open" so consumer CSS selectors like
  // `data-[state=open]:bg-accent` (originally from Radix's context-inherited
  // data-state) keep working. The Close button is only rendered when the
  // dialog is open, so "open" is always correct here.
  return (
    <DialogPrimitive.Close
      data-slot="dialog-close"
      render={(componentProps) => <button {...componentProps} data-state="open" />}
      {...props}
    >
      {children}
    </DialogPrimitive.Close>
  )
}

function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      render={(componentProps, state) => (
        <div {...componentProps} data-state={state.open ? 'open' : 'closed'} />
      )}
      className={cn(MODAL_OVERLAY, className)}
      {...props}
    />
  )
}

/**
 * A centred dialog (see `modal-styles.ts`). On phones it is a bottom sheet,
 * or with `mobile="fullscreen"` it takes the whole screen (multi-step flows).
 */
function DialogContent({
  className,
  children,
  showCloseButton = true,
  mobile = 'sheet',
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Popup>, 'render'> & {
  showCloseButton?: boolean
  mobile?: 'sheet' | 'fullscreen'
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        render={(componentProps, state) => (
          <div {...componentProps} data-state={state.open ? 'open' : 'closed'} />
        )}
        className={cn(
          MODAL_SURFACE,
          MODAL_CENTERED,
          mobile === 'sheet' ? MODAL_SHEET_ON_PHONE : MODAL_FULLSCREEN_ON_PHONE,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={(componentProps) => <button {...componentProps} data-state="open" />}
            className={MODAL_CLOSE}
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

/** Tints for a header icon: the action's meaning, not decoration. */
const ICON_TONES = {
  primary: 'bg-primary/10 text-primary dark:bg-primary/20',
  danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
} as const

/**
 * Title and description, left-aligned. With `icon`, the icon sits in a tinted
 * tile beside them — one look for every dialog that has one.
 */
function DialogHeader({
  className,
  icon,
  tone = 'primary',
  children,
  ...props
}: ComponentProps<'div'> & { icon?: ReactNode; tone?: keyof typeof ICON_TONES }) {
  if (!icon) {
    return (
      <div
        data-slot="dialog-header"
        // pr-10 keeps header content clear of the close button (size-8 at top-4/right-4).
        className={cn('flex flex-col gap-1.5 pr-10 text-left', className)}
        {...props}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex items-start gap-3.5 pr-10 text-left', className)}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5',
          ICON_TONES[tone],
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">{children}</div>
    </div>
  )
}

function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn(MODAL_FOOTER, className)} {...props} />
}

function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(MODAL_TITLE, className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(MODAL_DESCRIPTION, className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
