"use client"

import { type ComponentProps, type ReactElement, type ReactNode, isValidElement } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

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
}: Omit<ComponentProps<typeof DialogPrimitive.Root>, "children"> & {
  children?: ReactNode
}) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    // Translate Radix `asChild` to Base UI `render` prop. Base UI clones
    // the provided element with its own internal props (onClick, ref, etc.).
    return (
      <DialogPrimitive.Trigger
        data-slot="dialog-trigger"
        nativeButton={false}
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

function DialogPortal({
  ...props
}: ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Close>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <DialogPrimitive.Close
        data-slot="dialog-close"
        nativeButton={false}
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
      render={(componentProps) => (
        <button {...componentProps} data-state="open" />
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Close>
  )
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Backdrop>) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      render={(componentProps, state) => (
        <div
          {...componentProps}
          data-state={state.open ? "open" : "closed"}
        />
      )}
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Popup>, "render"> & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        render={(componentProps, state) => (
          <div
            {...componentProps}
            data-state={state.open ? "open" : "closed"}
          />
        )}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6  duration-200",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={(componentProps) => (
              <button {...componentProps} data-state="open" />
            )}
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
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
      className={cn("text-muted-foreground text-sm", className)}
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
