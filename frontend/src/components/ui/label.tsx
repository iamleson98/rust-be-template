"use client"

import { type LabelHTMLAttributes } from "react"

import { Slot } from "@/components/ui/slot"
import { cn } from "@/lib/utils"

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement> {
  /**
   * When `true`, the props are merged onto the single child element
   * instead of rendering a `<label>` wrapper. Mirrors the Radix
   * `asChild` prop pattern so existing consumers continue to work.
   * @default false
   */
  asChild?: boolean
}

/**
 * Label — plain HTML replacement for @radix-ui/react-label.
 *
 * Base UI's `Field` component is a different abstraction, so we use a
 * native `<label>` element and preserve the public shadcn API
 * (including the `asChild` prop, handled via our custom Slot utility).
 */
function Label({
  className,
  asChild = false,
  ...props
}: LabelProps) {
  const Comp = asChild ? Slot : "label"

  return (
    <Comp
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
