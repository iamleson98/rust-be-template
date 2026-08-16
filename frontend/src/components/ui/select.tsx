"use client"

/**
 * Select — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI Select vs Radix Select — key API differences:
 *
 * | Radix                       | Base UI                              |
 * | --------------------------- | ------------------------------------ |
 * | `<Select.Content>`          | `<Select.Positioner>` + `<Select.Popup>` |
 * | `<Select.Viewport>`         | `<Select.Popup>` (acts as the scroll container) or `<Select.List>` |
 * | `<Select.ScrollUpButton>`   | `<Select.ScrollUpArrow>`             |
 * | `<Select.ScrollDownButton>` | `<Select.ScrollDownArrow>`           |
 * | `onValueChange(value)`      | `onValueChange(value, eventDetails)`  |
 * | `data-state="open"`         | `data-open` + (shimmed) `data-state="open"` via `render` |
 * | `--radix-select-content-available-height` | `--available-height` |
 * | `--radix-select-trigger-height` | `--anchor-height`               |
 * | `--radix-select-trigger-width`  | `--anchor-width`                |
 * | `--radix-select-content-transform-origin` | `--transform-origin` |
 *
 * The wrappers below translate these so existing consumers (e.g. booking-dialog.tsx,
 * route-form.tsx, reviews-panel.tsx) continue to work without changes.
 */
import { type ComponentProps } from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Root wrapper — translates Radix's `onValueChange: (value) => void` call
 * signature to Base UI's `(value, eventDetails) => void` (drops the details arg).
 *
 * Also accepts Radix's `name`, `disabled`, `required`, `value`, `defaultValue`,
 * `defaultOpen`, `open`, `onOpenChange`, `modal` props (all of which exist on
 * Base UI's SelectRootProps directly or with the same name).
 */
function Select({
  value,
  defaultValue,
  onValueChange,
  onOpenChange,
  ...props
}: Omit<
  ComponentProps<typeof SelectPrimitive.Root>,
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
      value={value as any}
      defaultValue={defaultValue as any}
      onValueChange={(val: any) => {
        // Base UI calls with (value | null, eventDetails). Radix consumers
        // expect a non-null value (the empty string is used for "no value").
        onValueChange?.(val ?? "")
      }}
      onOpenChange={(open: boolean) => onOpenChange?.(open)}
      {...props}
    />
  )
}

function SelectGroup({
  ...props
}: ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />
}

function SelectValue({
  ...props
}: ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      // Emit `data-state` for backward-compat with consumer CSS (e.g. tw-animate-css
      // `data-[state=open]:` selectors). Base UI natively emits `data-open`/`data-closed`.
      render={(state: any) => (
        <button
          data-state={state.open ? "open" : "closed"}
          data-placeholder={state.placeholder ? "" : undefined}
        />
      )}
      className={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
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

function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: Omit<
  ComponentProps<typeof SelectPrimitive.Positioner>,
  "render" | "className"
> &
  Omit<ComponentProps<typeof SelectPrimitive.Popup>, "render"> & {
    className?: string
    position?: "popper" | "item-aligned"
  }) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        // sideOffset equivalent — Base UI uses `--anchor-offset` via `sideOffset` prop.
        // The position prop is preserved but currently both map to default behavior
        // (Base UI always uses popper-style positioning via Floating UI).
        className={cn(
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        {...props}
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          render={(state: any) => (
            <div
              data-state={state.open ? "open" : "closed"}
              data-side={state.side}
              data-align={state.align}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
            "p-1",
            position === "popper" &&
              "h-[var(--anchor-height)] w-full min-w-[var(--anchor-width)] scroll-my-1"
          )}
        >
          <SelectScrollUpButton />
          {children}
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  textValue,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item> & {
  /** Radix-compat alias for Base UI's `label` prop (used for typeahead matching). */
  textValue?: string
}) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      label={textValue}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: ComponentProps<typeof SelectPrimitive.Separator>) {
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
}: ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
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
}: ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
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
