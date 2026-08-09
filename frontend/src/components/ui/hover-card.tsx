"use client"

import { type ComponentProps, type ReactElement, isValidElement } from "react"
import { PreviewCard as PreviewCardPrimitive } from "@base-ui/react/preview-card"

import { cn } from "@/lib/utils"

/**
 * Radix-compat HoverCard wrapper around Base UI's PreviewCard.
 *
 * Base UI does not ship a `HoverCard` component — `PreviewCard` is the
 * equivalent (hover-triggered popup with positioning). The public API
 * (`HoverCard`, `HoverCardTrigger`, `HoverCardContent`) is preserved
 * exactly as shadcn consumers expect.
 *
 * API differences handled:
 *  - `HoverCard.Root`     → Base UI `PreviewCard.Root` (same)
 *  - `HoverCard.Trigger`  → Base UI `PreviewCard.Trigger` (same — both
 *                           render an `<a>` by default). Radix `asChild`
 *                           translated to Base UI `render` prop.
 *  - `HoverCard.Portal`   → Base UI `PreviewCard.Portal` (same)
 *  - `HoverCard.Content`  → Base UI `PreviewCard.Positioner` +
 *                           `PreviewCard.Popup`. Base UI requires the Popup
 *                           to be wrapped in a Positioner. `side`, `align`,
 *                           `sideOffset` props go on the Positioner.
 *
 * Radix `data-state="open|closed"` is emitted on the Popup via the `render`
 * prop, so tw-animate-css classes like `data-[state=open]:animate-in` continue
 * to work. Base UI also emits `data-side` and `data-align` on the Popup, so
 * CSS like `data-[side=bottom]:slide-in-from-top-2` works as-is.
 */

function HoverCard({
  ...props
}: ComponentProps<typeof PreviewCardPrimitive.Root>) {
  return <PreviewCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
  asChild,
  children,
  ...props
}: Omit<ComponentProps<typeof PreviewCardPrimitive.Trigger>, "render"> & {
  asChild?: boolean
}) {
  if (asChild && isValidElement(children)) {
    return (
      <PreviewCardPrimitive.Trigger
        data-slot="hover-card-trigger"
        render={children as ReactElement}
        {...props}
      />
    )
  }
  return (
    <PreviewCardPrimitive.Trigger data-slot="hover-card-trigger" {...props}>
      {children}
    </PreviewCardPrimitive.Trigger>
  )
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  side = "bottom",
  ...props
}: Omit<ComponentProps<typeof PreviewCardPrimitive.Positioner>, "render" | "side" | "align" | "sideOffset"> &
  Omit<ComponentProps<typeof PreviewCardPrimitive.Popup>, "render"> & {
    side?: "top" | "right" | "bottom" | "left" | "inline-start" | "inline-end"
    sideOffset?: number
    align?: "start" | "center" | "end"
  }) {
  return (
    <PreviewCardPrimitive.Portal data-slot="hover-card-portal">
      <PreviewCardPrimitive.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
      >
        <PreviewCardPrimitive.Popup
          data-slot="hover-card-content"
          render={(componentProps, state) => (
            <div
              {...componentProps}
              data-state={state.open ? "open" : "closed"}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-64 origin-(--transform-origin) rounded-md border p-4 shadow-md outline-hidden",
            className
          )}
          {...props}
        />
      </PreviewCardPrimitive.Positioner>
    </PreviewCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
