"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Root ────────────────────────────────────────────────────────
// Thin wrapper around Base UI's Select.Root that adapts the
// `onValueChange` callback to match the Radix-style API:
//   - Base UI:   `(value: string | null, eventDetails) => void`
//   - Radix/shadcn callers: `(value: string) => void`
// We strip the null (convert to empty string) + drop the eventDetails
// so existing callers like `onValueChange={field.onChange}` from
// react-hook-form keep working without type errors.
//
// We also convert `value` / `defaultValue` from `string | null` to
// `string | undefined` — Base UI treats `null` as "controlled empty"
// but `undefined` as "uncontrolled", which is what react-hook-form
// expects when a field has no default value.
function Select({
  value,
  defaultValue,
  onValueChange,
  onOpenChange,
  ...props
}: Omit<
  React.ComponentProps<typeof SelectPrimitive.Root>,
  "onValueChange" | "onOpenChange"
> & {
  value?: string | null
  defaultValue?: string | null
  onValueChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <SelectPrimitive.Root
      data-slot="select"
      value={value ?? undefined}
      defaultValue={defaultValue ?? undefined}
      onValueChange={(val) => onValueChange?.((val ?? "") as string)}
      onOpenChange={(open) => onOpenChange?.(open)}
      {...props}
    />
  )
}

function SelectGroup({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("p-1", className)}
      {...props}
    />
  )
}

// ── Value ───────────────────────────────────────────────────────
// NO children render function — let Base UI render the placeholder
// natively via the `placeholder` prop. The previous code used:
//   <SelectPrimitive.Value>
//     {(value) => value ?? placeholder}
//   </SelectPrimitive.Value>
// which returned `""` (empty string) when react-hook-form initialized
// fields to `""`, making the trigger collapse to just the chevron icon
// (≈16px wide) — effectively invisible.
function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

// ── Trigger ─────────────────────────────────────────────────────
// Base UI's Trigger already renders a native <button> — no `render`
// prop shim needed. The previous `render` prop added an extra wrapper
// + manually set `data-state` + `data-placeholder`, which Base UI
// already sets via `data-popup-open` + its own placeholder logic.
function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "border-input data-placeholder:text-muted-foreground",
        "[&_svg:not([class*='text-'])]:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        "aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50",
        "flex w-fit items-center justify-between gap-2 rounded-md border bg-white px-3 py-2 text-sm whitespace-nowrap  transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        "data-[size=default]:h-9 data-[size=sm]:h-8",
        "*:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

// ── Content (Portal + Positioner + Popup + List) ────────────────
// Base UI uses `alignItemWithTrigger` (boolean) instead of Radix's
// `position="popper" | "item-aligned"`. The CSS var is
// `--available-height` (NOT `--anchor-available-height`).
//
// Base UI sets `data-open` / `data-closed` (NOT `data-state="open"`),
// so we use `data-open:` / `data-closed:` for animation classes.
function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup> &
  Pick<
    React.ComponentProps<typeof SelectPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset" | "alignItemWithTrigger"
  >) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "bg-popover text-popover-foreground",
            "relative z-50 max-h-(--available-height) min-w-32 w-(--anchor-width) origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 ",
            // Base UI native attributes (NOT data-[state=open])
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
            className,
          )}
          {...props}
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

// ── Item ────────────────────────────────────────────────────────
// Base UI's Item uses `value` + `label` (for keyboard nav text).
// The `label` defaults to the item's text content, but callers that
// migrated from Radix may pass `textValue` — we map it to `label`.
function SelectItem({
  className,
  children,
  textValue,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item> & {
  textValue?: string
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      label={textValue}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground",
        "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        "hover:bg-accent hover:text-accent-foreground",
        "transition-colors duration-150",
        "relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-pointer items-center justify-center bg-popover py-1",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon className="size-4" />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-pointer items-center justify-center bg-popover py-1",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon className="size-4" />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
