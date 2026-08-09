"use client"

/**
 * Proof-of-concept: Base UI Tooltip wrapper.
 *
 * This is a drop-in replacement for the shadcn/ui Tooltip that uses
 * `@base-ui-components/react` instead of `@radix-ui/react-tooltip`.
 *
 * It demonstrates the migration pattern:
 *   1. Base UI primitives use named exports (Accordion.Root → AccordionRoot)
 *   2. State is exposed via a render prop or hook (BaseUIComponentProps.Props.State)
 *   3. Styling uses `data-[open]` or `data-[popup-open]` attribute selectors
 *      instead of Radix's `data-[state=open]`
 *   4. Animation classes need to reference the new data attributes
 *
 * Not yet wired into the app — kept side-by-side with the Radix version
 * (`ui/tooltip.tsx`) so the migration can be validated incrementally.
 *
 * To switch the app to Base UI tooltips:
 *   - Rename this file to `tooltip.tsx` (back up the Radix version first)
 *   - Run `bun run build` and verify the bundle no longer imports `@radix-ui/react-tooltip`
 *   - Run the app and verify all tooltips render correctly
 */

import * as React from "react"
import { Tooltip as BaseTooltip } from "@base-ui-components/react/tooltip"
import { cn } from "@/lib/utils"

function TooltipProvider({ children, ...props }: React.PropsWithChildren<object>) {
  // Base UI doesn't require a provider — it's a no-op for API compat.
  return <>{children}</>
}

function Tooltip(props: React.ComponentProps<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root {...props} />
}

type TooltipTriggerElement = React.ElementRef<typeof BaseTooltip.Trigger>
type TooltipTriggerProps = React.ComponentPropsWithoutRef<typeof BaseTooltip.Trigger>

const TooltipTrigger = React.forwardRef<TooltipTriggerElement, TooltipTriggerProps>(
  ({ className, ...props }, ref) => (
    <BaseTooltip.Trigger
      ref={ref}
      className={cn("outline-none", className)}
      {...props}
    />
  ),
)
TooltipTrigger.displayName = "TooltipTrigger"

type TooltipContentElement = React.ElementRef<typeof BaseTooltip.Popup>
type TooltipContentProps = React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup> & {
  /** Pixels between the trigger and the tooltip popup. Passed to the Positioner. */
  sideOffset?: number
}

const TooltipContent = React.forwardRef<TooltipContentElement, TooltipContentProps>(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner sideOffset={sideOffset}>
        <BaseTooltip.Popup
          ref={ref}
          className={cn(
            // Same Tailwind classes as the Radix version, but using
            // `data-[popup-open]` instead of `data-[state=delayed-open]`.
            "bg-primary text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[popup-open]:animate-in data-[popup-open]:fade-in-0 data-[popup-open]:zoom-in-95 data-[closed]:animate-out data-[closed]:fade-out-0 data-[closed]:zoom-out-95",
            "z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance",
            className,
          )}
          {...props}
        />
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  ),
)
TooltipContent.displayName = "TooltipContent"

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
