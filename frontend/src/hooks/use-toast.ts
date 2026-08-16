/**
 * useToast — minimal shim returning an empty toast list.
 *
 * The actual notification UI in this app is provided by `sonner` (see
 * `src/components/ui/sonner.tsx` and App.tsx). The original shadcn `useToast`
 * hook (with `toast()`, `dismiss()`, `update()` action creators) is not used
 * by any consumer in this codebase — only `ui/toaster.tsx` imports it, and
 * `<Toaster />` itself is not rendered by App.
 *
 * This shim therefore preserves the `useToast` API surface so `toaster.tsx`
 * type-checks, without depending on Radix or any global toast store.
 */
import { type ReactElement, type ReactNode } from "react"

export type ToastProps = {
  id?: string
  title?: ReactNode
  description?: ReactNode
  action?: ReactElement
  variant?: "default" | "destructive"
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export type ToasterToast = ToastProps & { id: string }

export type UseToastOptions = {
  toasts: ToasterToast[]
  toast: (props: ToastProps) => void
  dismiss: (toastId?: string) => void
  update: (toastId: string, props: ToastProps) => void
}

export function useToast(): UseToastOptions {
  return {
    toasts: [],
    toast: () => {},
    dismiss: () => {},
    update: () => {},
  }
}
