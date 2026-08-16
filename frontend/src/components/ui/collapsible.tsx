"use client"

import { type ComponentProps } from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

/**
 * Radix-compat wrapper around Base UI's Collapsible.
 *
 * API differences handled:
 *  - Radix `Collapsible.Content` → Base UI `Collapsible.Panel`
 *
 * Public API (`Collapsible`, `CollapsibleTrigger`, `CollapsibleContent`) preserved —
 * `CollapsibleContent` now renders a Base UI `Collapsible.Panel` under the hood.
 */

function Collapsible({
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  className,
  ...props
}: ComponentProps<typeof CollapsiblePrimitive.Panel>) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      // tw-animate-css's `collapsible-down`/`collapsible-up` keyframes read
      // `--radix-collapsible-content-height`. Base UI exposes the same value
      // under `--collapsible-panel-height`, so alias it for backward compat.
      style={{
        ["--radix-collapsible-content-height" as string]: "var(--collapsible-panel-height)",
      }}
      className={className}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
