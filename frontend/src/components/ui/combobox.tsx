"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { CheckIcon, ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Combobox — searchable dropdown built on Base UI's Combobox primitive.
 *
 * Use Combobox instead of Select when the user needs to TYPE to filter
 * the list (e.g. picking from hundreds of places, brands, or routes).
 * Select is for short, fixed lists where a button click is enough.
 *
 * ## API
 *
 * ```tsx
 * <Combobox>
 *   <ComboboxTrigger>
 *     <ComboboxValue placeholder="Chọn địa điểm..." />
 *   </ComboboxTrigger>
 *   <ComboboxContent>
 *     <ComboboxInput placeholder="Tìm..." />
 *     <ComboboxList>
 *       <ComboboxItem value="hanoi">Hà Nội</ComboboxItem>
 *       <ComboboxItem value="hcm">Hồ Chí Minh</ComboboxItem>
 *       <ComboboxEmpty>Không tìm thấy</ComboboxEmpty>
 *     </ComboboxList>
 *   </ComboboxContent>
 * </Combobox>
 * ```
 *
 * ## Base UI notes
 *
 * - `ComboboxValue` does NOT render its own HTML element — it's a
 *   text-only component. Place it inside the `ComboboxTrigger`.
 * - `ComboboxItem` renders children directly (no `ItemText` wrapper).
 * - `ComboboxEmpty` requires the `items` prop on the Root to work
 *   (it compares against the item count). Without `items`, render
 *   an empty state manually inside the list.
 */

const Combobox = ComboboxPrimitive.Root

function ComboboxValue({
  placeholder,
  children,
}: React.ComponentProps<typeof ComboboxPrimitive.Value>) {
  // ComboboxValue doesn't render its own element — it's a text-only
  // component. We wrap it in a span so it can be laid out inside the
  // trigger button.
  return (
    <span className="flex flex-1 text-left">
      <ComboboxPrimitive.Value data-slot="combobox-value" placeholder={placeholder}>
        {children}
      </ComboboxPrimitive.Value>
    </span>
  )
}

function ComboboxTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Trigger>) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "border-input data-placeholder:text-muted-foreground",
        "[&_svg:not([class*='text-'])]:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50",
        "flex w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap  transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        "h-9",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.Icon>
        <ChevronDownIcon className="pointer-events-none size-4 opacity-50" />
      </ComboboxPrimitive.Icon>
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxInput({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "border-input placeholder:text-muted-foreground h-9 w-full border-b bg-transparent px-3 py-2 text-sm outline-none",
        className,
      )}
      {...props}
    />
  )
}

function ComboboxContent({
  className,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof ComboboxPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  >) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          className={cn(
            "bg-popover text-popover-foreground",
            "relative z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-hidden rounded-md border ",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.List>) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("max-h-72 overflow-y-auto overscroll-contain p-1", className)}
      {...props}
    />
  )
}

function ComboboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground",
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({
  className,
  ...props
}: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("py-2 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
}
