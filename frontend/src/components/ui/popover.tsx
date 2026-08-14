"use client"

import { type ComponentProps, type ReactElement, isValidElement } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Popover.
 *
 * API differences handled:
 *  - `Popover.Root`     → Base UI `Popover.Root` (same)
 *  - `Popover.Trigger`  → Base UI `Popover.Trigger` (same). Radix `asChild`
 *                         translated to Base UI `render` prop.
 *  - `Popover.Portal`   → Base UI `Popover.Portal` (same)
 *  - `Popover.Content`  → Base UI `Popover.Positioner` + `Popover.Popup`.
 *                         Base UI requires the Popup to be wrapped in a
 *                         Positioner (unlike Radix where Content handles
 *                         positioning itself). `side`, `align`, `sideOffset`
 *                         props go on the Positioner (not the Popup).
 *  - `Popover.Anchor`   → No Base UI equivalent. Base UI uses an `anchor`
 *                         prop on the Positioner instead. The exported
 *                         `PopoverAnchor` is retained as a no-op span stub
 *                         for API compatibility (no consumer in this repo
 *                         uses it; new code should pass `anchor` to
 *                         `PopoverContent`).
 *
 * Radix `data-state="open|closed"` is emitted on the Popup via the `render`
 * prop, so tw-animate-css classes like `data-[state=open]:animate-in` continue
 * to work. Base UI also emits `data-side` and `data-align` on the Popup, so
 * CSS like `data-[side=bottom]:slide-in-from-top-2` works as-is.
 */

function Popover({
  ...props
}: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof PopoverPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <PopoverPrimitive.Trigger
        data-slot="popover-trigger"
        nativeButton={true}
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props}>
      {children}
    </PopoverPrimitive.Trigger>
  )
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  side = "bottom",
  ...props
}: Omit<ComponentProps<typeof PopoverPrimitive.Positioner>, "render" | "side" | "align" | "sideOffset"> &
  Omit<ComponentProps<typeof PopoverPrimitive.Popup>, "render"> & {
    side?: "top" | "right" | "bottom" | "left" | "inline-start" | "inline-end"
    sideOffset?: number
    align?: "start" | "center" | "end"
  }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          render={(componentProps, state) => (
            <div
              {...componentProps}
              data-state={state.open ? "open" : "closed"}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-72 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

/**
 * PopoverAnchor — no-op stub for API compatibility.
 *
 * Base UI does not have a separate Anchor primitive. To anchor a Popover to
 * a non-trigger element, pass an `anchor` ref to the `Positioner` (i.e., to
 * `PopoverContent`). Since no consumer in this repo uses `PopoverAnchor`,
 * this stub simply renders its children inside a span with the data-slot.
 */
function PopoverAnchor({ ...props }: ComponentProps<"span">) {
  return <span data-slot="popover-anchor" {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
