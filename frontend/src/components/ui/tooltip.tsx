"use client"

import { type ComponentProps, type ReactElement, isValidElement } from "react"
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Tooltip.
 *
 * API differences handled:
 *  - `Tooltip.Root`     → Base UI `Tooltip.Root` (same)
 *  - `Tooltip.Trigger`  → Base UI `Tooltip.Trigger` (same). Radix `asChild`
 *                         translated to Base UI `render` prop.
 *  - `Tooltip.Provider` → Base UI `Tooltip.Provider` (same). Radix
 *                         `delayDuration` (ms) translated to Base UI `delay`.
 *  - `Tooltip.Portal`   → Base UI `Tooltip.Portal` (same)
 *  - `Tooltip.Content`  → Base UI `Tooltip.Positioner` + `Tooltip.Popup`.
 *                         Base UI requires the Popup to be wrapped in a
 *                         Positioner (unlike Radix where Content handles
 *                         positioning itself).
 *                         `side`, `align`, `sideOffset` props go on the
 *                         Positioner (not the Popup).
 *  - `Tooltip.Arrow`    → Base UI `Tooltip.Arrow` (same)
 *
 * Radix `data-state="delayed-open|instant-open|closed"` is collapsed to
 * `data-state="open|closed"` (via the `render` prop on Popup) so tw-animate-css
 * classes like `data-[state=closed]:animate-out` continue to work alongside
 * Base UI's native `data-open`/`data-closed`/`data-starting-style`/`data-ending-style`
 * attributes. Base UI also emits `data-side` and `data-align` on the Popup,
 * so CSS like `data-[side=bottom]:slide-in-from-top-2` works as-is.
 */

function TooltipProvider({
  delayDuration = 0,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Provider>, "delay" | "closeDelay"> & {
  /** Radix name. Maps to Base UI's `delay` prop (ms). */
  delayDuration?: number
}) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    // Note: Base UI's Tooltip.Trigger does not expose a `nativeButton` prop
    // (unlike Dialog/Popover triggers). The `render` prop clones the child
    // element with Base UI's internal props (onClick, ref, etc.).
    return (
      <TooltipPrimitive.Trigger
        data-slot="tooltip-trigger"
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  )
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 0,
  align = "center",
  children,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Positioner>, "render" | "side" | "align" | "sideOffset"> &
  Omit<ComponentProps<typeof TooltipPrimitive.Popup>, "render"> & {
    /** Radix names. Forwarded to the Positioner. */
    side?: "top" | "right" | "bottom" | "left" | "inline-start" | "inline-end"
    sideOffset?: number
    align?: "start" | "center" | "end"
  }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          data-slot="tooltip-content"
          render={(componentProps, state) => (
            <div
              {...componentProps}
              data-state={state.open ? "open" : "closed"}
            />
          )}
          className={cn(
            "bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--transform-origin) rounded-md px-3 py-1.5 text-xs text-balance",
            className
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="bg-primary fill-primary z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-[2px]" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
