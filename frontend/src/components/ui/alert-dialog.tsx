"use client"

import { type ComponentProps, type ReactElement, type ReactNode, isValidElement } from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

/**
 * Radix-compat wrapper around Base UI's AlertDialog.
 *
 * API differences handled:
 *  - `AlertDialog.Root`     → Base UI `AlertDialog.Root` (same)
 *  - `AlertDialog.Trigger`  → Base UI `AlertDialog.Trigger` (same). Radix
 *                             `asChild` translated to Base UI `render` prop.
 *  - `AlertDialog.Portal`   → Base UI `AlertDialog.Portal` (same)
 *  - `AlertDialog.Overlay`  → Base UI `AlertDialog.Backdrop` (renamed)
 *  - `AlertDialog.Content`  → Base UI `AlertDialog.Popup` (renamed)
 *  - `AlertDialog.Title`    → Base UI `AlertDialog.Title` (same)
 *  - `AlertDialog.Description` → Base UI `AlertDialog.Description` (same)
 *  - `AlertDialog.Action`   → Base UI `AlertDialog.Close` (no separate
 *                             Action primitive; Action is a Close with
 *                             default button variant styling)
 *  - `AlertDialog.Cancel`   → Base UI `AlertDialog.Close` (no separate
 *                             Cancel primitive; Cancel is a Close with
 *                             outline button variant styling)
 *
 * Base UI AlertDialog always forces `modal=true` and disallows closing on
 * outside pointer press (Radix-compat alert semantics).
 *
 * Radix `data-state="open|closed"` is emitted on Backdrop/Popup/Close via
 * the `render` prop, so tw-animate-css classes like `data-[state=open]:animate-in`
 * continue to work.
 */

function AlertDialog({
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Root>, "children"> & {
  children?: ReactNode
}) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <AlertDialogPrimitive.Trigger
        data-slot="alert-dialog-trigger"
        nativeButton={false}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props}>
      {children}
    </AlertDialogPrimitive.Trigger>
  )
}

function AlertDialogPortal({
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Backdrop>) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
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

function AlertDialogContent({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Popup>, "render">) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        render={(componentProps, state) => (
          <div
            {...componentProps}
            data-state={state.open ? "open" : "closed"}
          />
        )}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6  duration-200 sm:max-w-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Close>, "render">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      render={(componentProps) => (
        <button {...componentProps} data-state="open" />
      )}
      className={cn(buttonVariants(), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: Omit<ComponentProps<typeof AlertDialogPrimitive.Close>, "render">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={(componentProps) => (
        <button {...componentProps} data-state="open" />
      )}
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
