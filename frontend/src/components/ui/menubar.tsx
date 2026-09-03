"use client"

/**
 * Menubar — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI's `Menubar` module exports ONLY the container `<Menubar>` (which
 * creates a menubar context). Inside, you compose `Menu.Root`, `Menu.Trigger`,
 * `Menu.Popup`, etc. — they automatically detect the menubar parent context
 * and inherit roving-tab behavior.
 *
 * | Radix                          | Base UI                              |
 * | ------------------------------ | ------------------------------------ |
 * | `<Menubar>`                    | `<Menubar>`                          |
 * | `<Menubar.Menu>`               | `<Menu.Root>`                        |
 * | `<Menubar.Trigger>`            | `<Menu.Trigger>`                     |
 * | `<Menubar.Portal>`             | `<Menu.Portal>`                      |
 * | `<Menubar.Content>`            | `<Menu.Positioner>` + `<Menu.Popup>` |
 * | `<Menubar.Item>`               | `<Menu.Item>`                        |
 * | `<Menubar.CheckboxItem>`       | `<Menu.CheckboxItem>`                |
 * | `<Menubar.RadioGroup>`         | `<Menu.RadioGroup>`                  |
 * | `<Menubar.RadioItem>`          | `<Menu.RadioItem>`                   |
 * | `<Menubar.Group>`              | `<Menu.Group>`                       |
 * | `<Menubar.Label>`              | `<Menu.GroupLabel>`                  |
 * | `<Menubar.Separator>`          | `Separator` from `@base-ui/react/separator` |
 * | `<Menubar.Sub>`                | `<Menu.SubmenuRoot>`                 |
 * | `<Menubar.SubTrigger>`         | `<Menu.SubmenuTrigger>`              |
 * | `<Menubar.SubContent>`         | `<Menu.Portal>` + `<Menu.Positioner>` + `<Menu.Popup>` |
 * | `data-state="open|closed"`     | `data-open`/`data-closed` + (shimmed) `data-state` via `render` |
 */
import { type ComponentProps, type ReactElement } from "react"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Separator } from "@base-ui/react/separator"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Menubar({
  className,
  ...props
}: ComponentProps<typeof MenubarPrimitive>) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn(
        "bg-background flex h-9 items-center gap-1 rounded-md border p-1 ",
        className
      )}
      {...props}
    />
  )
}

function MenubarMenu({
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <MenuPrimitive.Root
      data-slot="menubar-menu"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function MenubarGroup({
  ...props
}: ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group data-slot="menubar-group" {...props} />
}

function MenubarPortal({
  ...props
}: ComponentProps<typeof MenuPrimitive.Portal>) {
  return <MenuPrimitive.Portal data-slot="menubar-portal" {...props} />
}

function MenubarRadioGroup({
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
      data-slot="menubar-radio-group"
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v: any) => onValueChange?.(v)}
      {...props}
    />
  )
}

function MenubarTrigger({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Trigger>) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menubar-trigger"
      render={(componentProps: any, state: any) => (
        <button
          {...componentProps}
          data-state={state.open ? "open" : "closed"}
        />
      )}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex items-center rounded-sm px-2 py-1 text-sm font-medium outline-hidden select-none",
        className
      )}
      {...props}
    />
  )
}

function MenubarContent({
  className,
  align = "start",
  alignOffset = -4,
  sideOffset = 8,
  side,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Popup>, "render"> &
  Pick<
    ComponentProps<typeof MenuPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  >) {
  return (
    <MenubarPortal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        side={side}
      >
        <MenuPrimitive.Popup
          data-slot="menubar-content"
          render={(componentProps: any, state: any) => (
            <div
              {...componentProps}
              data-state={state.open ? "open" : "closed"}
              data-side={state.side}
              data-align={state.align}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[12rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 ",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenubarPortal>
  )
}

function MenubarItem({
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
        data-slot="menubar-item"
        data-inset={inset}
        data-variant={variant}
        nativeButton={false}
        render={children as ReactElement}
        className={cn(
          "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
          className
        )}
        {...rest}
      />
    )
  }
  return (
    <MenuPrimitive.Item
      data-slot="menubar-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function MenubarCheckboxItem({
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
      data-slot="menubar-checkbox-item"
      checked={checked}
      onCheckedChange={(c: boolean) => onCheckedChange?.(c)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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

function MenubarRadioItem({
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.RadioItem>, "render">) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="menubar-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-xs py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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

function MenubarLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof MenuPrimitive.GroupLabel> & {
  inset?: boolean
}) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="menubar-label"
      data-inset={inset}
      className={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function MenubarSeparator({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="menubar-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function MenubarShortcut({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="menubar-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

function MenubarSub({
  ...props
}: Omit<
  ComponentProps<typeof MenuPrimitive.SubmenuRoot>,
  "onOpenChange"
> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <MenuPrimitive.SubmenuRoot
      data-slot="menubar-sub"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function MenubarSubTrigger({
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
      data-slot="menubar-sub-trigger"
      data-inset={inset}
      render={(componentProps: any, state: any) => (
        <div
          {...componentProps}
          data-state={state.open ? "open" : "closed"}
        />
      )}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[inset]:pl-8",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto h-4 w-4" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function MenubarSubContent({
  className,
  side = "bottom",
  sideOffset = 0,
  align = "start",
  alignOffset = 0,
  ...props
}: Omit<ComponentProps<typeof MenuPrimitive.Popup>, "render"> &
  Pick<
    ComponentProps<typeof MenuPrimitive.Positioner>,
    "side" | "align" | "sideOffset" | "alignOffset"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
      >
        <MenuPrimitive.Popup
          data-slot="menubar-sub-content"
          render={(componentProps: any, state: any) => (
            <div
              {...componentProps}
              data-state={state.open ? "open" : "closed"}
              data-side={state.side}
              data-align={state.align}
            />
          )}
          className={cn(
            "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] origin-(--transform-origin) overflow-hidden rounded-md border p-1 ",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

export {
  Menubar,
  MenubarPortal,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  MenubarGroup,
  MenubarSeparator,
  MenubarLabel,
  MenubarItem,
  MenubarShortcut,
  MenubarCheckboxItem,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSub,
  MenubarSubTrigger,
  MenubarSubContent,
}
