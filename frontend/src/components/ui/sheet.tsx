"use client"

import { type ComponentProps, type ReactElement, type ReactNode, isValidElement } from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix-compat Sheet wrapper around Base UI's Dialog.
 *
 * A "Sheet" is a Radix Dialog variant that slides in from one edge of the
 * screen (top/right/bottom/left). The `side` prop controls which CSS
 * animation classes apply.
 *
 * API differences handled (same as `dialog.tsx`):
 *  - `Sheet.Root`     → Base UI `Dialog.Root`
 *  - `Sheet.Trigger`  → Base UI `Dialog.Trigger` (with `asChild`→`render`)
 *  - `Sheet.Portal`   → Base UI `Dialog.Portal`
 *  - `Sheet.Overlay`  → Base UI `Dialog.Backdrop`
 *  - `Sheet.Content`  → Base UI `Dialog.Popup`
 *  - `Sheet.Close`    → Base UI `Dialog.Close`
 *  - `Sheet.Title`    → Base UI `Dialog.Title`
 *  - `Sheet.Description` → Base UI `Dialog.Description`
 *
 * Base UI Dialog has no `Positioner` — the Popup is rendered directly inside
 * the Portal. The slide-in/out animations are pure CSS (tw-animate-css)
 * driven by `data-state="open|closed"` which we emit via the `render` prop.
 */

function Sheet({
  ...props
}: Omit<ComponentProps<typeof SheetPrimitive.Root>, "children"> & {
  children?: ReactNode
}) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof SheetPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <SheetPrimitive.Trigger
        data-slot="sheet-trigger"
        nativeButton={false}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props}>
      {children}
    </SheetPrimitive.Trigger>
  )
}

function SheetClose({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof SheetPrimitive.Close>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <SheetPrimitive.Close
        data-slot="sheet-close"
        nativeButton={false}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <SheetPrimitive.Close data-slot="sheet-close" {...props}>
      {children}
    </SheetPrimitive.Close>
  )
}

function SheetPortal({
  ...props
}: ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Backdrop>) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
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

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: Omit<ComponentProps<typeof SheetPrimitive.Popup>, "render"> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        render={(componentProps, state) => (
          <div
            {...componentProps}
            data-state={state.open ? "open" : "closed"}
          />
        )}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          data-slot="sheet-close"
          render={(componentProps) => (
            <button {...componentProps} data-state="open" />
          )}
          className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none"
        >
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
