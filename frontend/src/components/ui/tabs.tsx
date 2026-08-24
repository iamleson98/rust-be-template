"use client"

import { type ComponentProps } from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Tabs.
 *
 * API differences handled:
 *  - Radix `Tabs.List`    → Base UI `Tabs.List` (same name; Base UI exports `TabsList` as `Tabs.List`)
 *  - Radix `Tabs.Trigger` → Base UI `Tabs.Tab`
 *  - Radix `Tabs.Content` → Base UI `Tabs.Panel`
 *  - Radix `data-state="active|inactive"` → Base UI `data-active` (present-only)
 *
 * The Radix `data-state="active|inactive"` attribute is ALSO emitted on the Tab
 * via the `render` prop, so consumer CSS classes like `data-[state=active]:bg-blue-50`
 * continue to work alongside Base UI's native `data-[active]:` selectors.
 */

function Tabs({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      render={(componentProps, state) => (
        <button
          {...componentProps}
          data-state={state.active ? "active" : "inactive"}
        />
      )}
      className={cn(
        "data-[active]:bg-background dark:data-[active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring dark:data-[active]:border-input dark:data-[active]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 data-[active]: [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
