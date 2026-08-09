"use client"

/**
 * DropdownMenu — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI doesn't ship a "DropdownMenu" component per se — it ships a `Menu`
 * primitive with `Menu.Trigger` (click to open). This is functionally equivalent
 * to Radix's `DropdownMenu`.
 *
 * | Radix                            | Base UI                              |
 * | -------------------------------- | ------------------------------------ |
 * | `<DropdownMenu.Root>`            | `<Menu.Root>`                        |
 * | `<DropdownMenu.Trigger>`         | `<Menu.Trigger>`                     |
 * | `<DropdownMenu.Portal>`          | `<Menu.Portal>`                      |
 * | `<DropdownMenu.Content>`         | `<Menu.Positioner>` + `<Menu.Popup>` |
 * | `<DropdownMenu.Item>`            | `<Menu.Item>`                        |
 * | `<DropdownMenu.CheckboxItem>`    | `<Menu.CheckboxItem>`                |
 * | `<DropdownMenu.ItemIndicator>`   | `<Menu.CheckboxItemIndicator>` (or `Menu.RadioItemIndicator`) |
 * | `<DropdownMenu.RadioGroup>`      | `<Menu.RadioGroup>`                  |
 * | `<DropdownMenu.RadioItem>`       | `<Menu.RadioItem>`                   |
 * | `<DropdownMenu.Group>`           | `<Menu.Group>`                       |
 * | `<DropdownMenu.Label>`           | `<Menu.GroupLabel>`                  |
 * | `<DropdownMenu.Separator>`       | `Separator` from `@base-ui/react/separator` (Base UI Menu has no Separator primitive) |
 * | `<DropdownMenu.Sub>`             | `<Menu.SubmenuRoot>`                 |
 * | `<DropdownMenu.SubTrigger>`      | `<Menu.SubmenuTrigger>`              |
 * | `<DropdownMenu.SubContent>`      | `<Menu.Portal>` + `<Menu.Positioner>` + `<Menu.Popup>` |
 * | `data-state="open|closed"`       | `data-open`/`data-closed` + (shimmed) `data-state` via `render` |
 * | `--radix-dropdown-menu-content-transform-origin` | `--transform-origin` |
 * | `--radix-dropdown-menu-content-available-height` | `--available-height` |
 *
 * Public API preserved: all original export names (`DropdownMenu`, `DropdownMenuTrigger`,
 * `DropdownMenuContent`, `DropdownMenuItem`, etc.) plus `asChild`, `align`, `sideOffset`,
 * `alignOffset`, `side`, `inset`, `variant`, `checked`, `onCheckedChange`, `value`,
 * `onValueChange`, `disabled`, etc.
 */
import { type ComponentProps, type ReactElement } from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Separator } from "@base-ui/react/separator"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function DropdownMenu({
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <MenuPrimitive.Root
      data-slot="dropdown-menu"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function DropdownMenuPortal({
  ...props
}: ComponentProps<typeof MenuPrimitive.Portal>) {
  return (
    <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
  )
}

function DropdownMenuTrigger({
  asChild = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Trigger> & {
  asChild?: boolean
}) {
  // Translate Radix `asChild` to Base UI's `render` prop. When `asChild`
  // is true, the consumer's child element replaces the default <button>.
  if (asChild) {
    const { children, ...rest } = props
    return (
      <MenuPrimitive.Trigger
        data-slot="dropdown-menu-trigger"
        nativeButton={false}
        render={children as ReactElement}
        {...rest}
      />
    )
  }
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...props}
    />
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align,
  alignOffset,
  side,
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.Positioner>,
  "render"
> &
  Omit<ComponentProps<typeof MenuPrimitive.Popup>, "render"> & {
    className?: string
  }) {
  return (
    <DropdownMenuPortal>
      <MenuPrimitive.Positioner
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        side={side}
        {...props}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          render={(state: any) => (
            <div
              data-state={state.open ? "open" : "closed"}
              data-side={state.side}
              data-align={state.align}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
            className
          )}
        />
      </MenuPrimitive.Positioner>
    </DropdownMenuPortal>
  )
}

function DropdownMenuGroup({
  ...props
}: ComponentProps<typeof MenuPrimitive.Group>) {
  return (
    <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  asChild = false,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Item>, "render"> & {
  inset?: boolean
  variant?: "default" | "destructive"
  asChild?: boolean
}) {
  if (asChild) {
    const { children, ...rest } = props
    return (
      <MenuPrimitive.Item
        data-slot="dropdown-menu-item"
        data-inset={inset}
        data-variant={variant}
        nativeButton={false}
        render={children as ReactElement}
        className={cn(
          "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...rest}
      />
    )
  }
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  onCheckedChange,
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.CheckboxItem>,
  "render" | "onCheckedChange"
> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      checked={checked}
      onCheckedChange={(c: boolean) => onCheckedChange?.(c)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.RadioGroup>,
  "onValueChange"
> & {
  value?: any
  defaultValue?: any
  onValueChange?: (value: any) => void
}) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v: any) => onValueChange?.(v)}
      {...props}
    />
  )
}

function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.RadioItem>, "render">) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.GroupLabel> & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="dropdown-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuSub({
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.SubmenuRoot>,
  "onOpenChange"
> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <MenuPrimitive.SubmenuRoot
      data-slot="dropdown-menu-sub"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.SubmenuTrigger>,
  "render"
> & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      render={(state: any) => (
        <div data-state={state.open ? "open" : "closed"} />
      )}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Positioner>, "render"> &
  Omit<ComponentProps<typeof MenuPrimitive.Popup>, "render"> & {
    className?: string
  }) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner {...props}>
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-sub-content"
          render={(state: any) => (
            <div
              data-state={state.open ? "open" : "closed"}
              data-side={state.side}
              data-align={state.align}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
            className
          )}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
