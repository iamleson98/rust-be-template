"use client"

/**
 * Toast — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI's Toast.Root requires a `toast` prop (a `ToastObject` with id/title/
 * description/etc.). Radix's Toast.Root did not — the shadcn wrapper exposes a
 * simpler API where the parent (toaster.tsx) renders `<Toast>` directly and
 * supplies children (`<ToastTitle>`, `<ToastDescription>`, `<ToastClose>`).
 *
 * To bridge the two, the `Toast` wrapper below accepts the Radix-style props
 * (`duration`, `defaultOpen`, `open`, `onOpenChange`, `variant`, etc.), constructs
 * a synthetic `ToastObject` internally, and forwards it to Base UI's `Toast.Root`.
 *
 * NOTE: The actual notification UI in this app is provided by `sonner` (see
 * `src/components/ui/sonner.tsx` and App.tsx). The `<Toaster />` in this folder
 * remains for backward-compat with any consumer that imports it, but the real
 * toast surface is sonner's. This module's primary purpose is therefore to
 * preserve the public API so consumers can still type-check.
 */
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type ReactElement,
  forwardRef,
  useMemo,
} from "react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"
import { cva, type VariantProps } from "class-variance-authority"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

const ToastProvider = ToastPrimitive.Provider

const ToastViewport = forwardRef<
  ElementRef<typeof ToastPrimitive.Viewport>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-4 pr-6  transition-all data-open:animate-in data-closed:animate-out data-closed:fade-out-80 data-closed:slide-out-to-right-full data-open:slide-in-from-top-full data-open:sm:slide-in-from-bottom-full",
  {
    variants: {
      variant: {
        default: "border bg-background text-foreground",
        destructive:
          "destructive group border-destructive bg-destructive text-destructive-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type ToastWrapperProps = Omit<
  ComponentPropsWithoutRef<typeof ToastPrimitive.Root>,
  "toast"
> &
  VariantProps<typeof toastVariants> & {
    /** Synthetic id used to construct Base UI's required `toast` object. */
    id?: string
  }

const Toast = forwardRef<
  ElementRef<typeof ToastPrimitive.Root>,
  ToastWrapperProps
>(({ className, variant, id, ...props }, ref) => {
  // Base UI requires a `toast` prop containing a ToastObject. Radix didn't, so
  // the shadcn consumer passes `id`, `title`, etc. as plain props. Build a
  // minimal synthetic toast object so Base UI's invariant is satisfied.
  const syntheticToast = useMemo(
    () => ({ id: id ?? `toast-${Math.random().toString(36).slice(2)}` }),
    [id]
  )

  return (
    <ToastPrimitive.Root
      ref={ref}
      toast={syntheticToast as any}
      className={cn(toastVariants({ variant }), className)}
      {...props}
    />
  )
})
Toast.displayName = "Toast"

const ToastAction = forwardRef<
  ElementRef<typeof ToastPrimitive.Action>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-secondary focus:outline-none focus:ring-1 focus:ring-ring disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-muted/40 group-[.destructive]:hover:border-destructive/30 group-[.destructive]:hover:bg-destructive group-[.destructive]:hover:text-destructive-foreground group-[.destructive]:focus:ring-destructive",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitive.Action.displayName

const ToastClose = forwardRef<
  ElementRef<typeof ToastPrimitive.Close>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "absolute right-1 top-1 rounded-md p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-1 group-hover:opacity-100 group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50 group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600",
      className
    )}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

const ToastTitle = forwardRef<
  ElementRef<typeof ToastPrimitive.Title>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-sm font-semibold [&+div]:text-xs", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

const ToastDescription = forwardRef<
  ElementRef<typeof ToastPrimitive.Description>,
  ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("text-sm opacity-90", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

type ToastProps = ComponentPropsWithoutRef<typeof Toast>

type ToastActionElement = ReactElement<typeof ToastAction>

export {
  type ToastProps,
  type ToastActionElement,
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
}
