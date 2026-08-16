"use client"

/**
 * ContextMenu — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI's `ContextMenu` module reuses `Menu` primitives for everything except
 * `Root` and `Trigger` (which are context-menu-specific: opened via right-click
 * or long-press instead of click). The full API mapping:
 *
 * | Radix                            | Base UI                                 |
 * | -------------------------------- | --------------------------------------- |
 * | `<ContextMenu.Root>`             | `<ContextMenu.Root>`                    |
 * | `<ContextMenu.Trigger>`          | `<ContextMenu.Trigger>`                 |
 * | `<ContextMenu.Portal>`           | `<ContextMenu.Portal>` (alias for `Menu.Portal`) |
 * | `<ContextMenu.Content>`          | `<ContextMenu.Positioner>` + `<ContextMenu.Popup>` |
 * | `<ContextMenu.Item>`             | `<ContextMenu.Item>`                    |
 * | `<ContextMenu.CheckboxItem>`     | `<ContextMenu.CheckboxItem>`            |
 * | `<ContextMenu.RadioGroup>`       | `<ContextMenu.RadioGroup>`              |
 * | `<ContextMenu.RadioItem>`        | `<ContextMenu.RadioItem>`               |
 * | `<ContextMenu.Group>`            | `<ContextMenu.Group>`                   |
 * | `<ContextMenu.Label>`            | `<ContextMenu.GroupLabel>`              |
 * | `<ContextMenu.Separator>`        | `<ContextMenu.Separator>`               |
 * | `<ContextMenu.Sub>`              | `<ContextMenu.SubmenuRoot>`             |
 * | `<ContextMenu.SubTrigger>`       | `<ContextMenu.SubmenuTrigger>`          |
 * | `<ContextMenu.SubContent>`       | `<ContextMenu.Portal>` + `<ContextMenu.Positioner>` + `<ContextMenu.Popup>` |
 * | `data-state="open|closed"`       | `data-open`/`data-closed` + (shimmed) `data-state` via `render` |
 */
import { type ComponentProps, type ReactElement } from "react"
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { CheckIcon, ChevronRightIcon, CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function ContextMenu({
  ...props
}: Omit<ComponentProps<typeof ContextMenuPrimitive.Root>, "onOpenChange"> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <ContextMenuPrimitive.Root
      data-slot="context-menu"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function ContextMenuTrigger({
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return (
    <ContextMenuPrimitive.Trigger
      data-slot="context-menu-trigger"
      {...props}
    />
  )
}

function ContextMenuGroup({
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Group>) {
  return (
    <ContextMenuPrimitive.Group data-slot="context-menu-group" {...props} />
  )
}

function ContextMenuPortal({
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return (
    <ContextMenuPrimitive.Portal data-slot="context-menu-portal" {...props} />
  )
}

function ContextMenuSub({
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.SubmenuRoot>,
  "onOpenChange"
> & {
  onOpenChange?: (open: boolean) => void
}) {
  return (
    <ContextMenuPrimitive.SubmenuRoot
      data-slot="context-menu-sub"
      onOpenChange={(open: boolean) => props.onOpenChange?.(open)}
      {...props}
    />
  )
}

function ContextMenuRadioGroup({
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.RadioGroup>,
  "onValueChange"
> & {
  value?: any
  defaultValue?: any
  onValueChange?: (value: any) => void
}) {
  return (
    <ContextMenuPrimitive.RadioGroup
      data-slot="context-menu-radio-group"
      value={value}
      defaultValue={defaultValue}
      onValueChange={(v: any) => onValueChange?.(v)}
      {...props}
    />
  )
}

function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.SubmenuTrigger>,
  "render"
> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.SubmenuTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      render={(state: any) => (
        <div data-state={state.open ? "open" : "closed"} />
      )}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-inset:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </ContextMenuPrimitive.SubmenuTrigger>
  )
}

function ContextMenuSubContent({
  className,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.Positioner>,
  "render"
> &
  Omit<ComponentProps<typeof ContextMenuPrimitive.Popup>, "render"> & {
    className?: string
  }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner {...props}>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-sub-content"
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
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuContent({
  className,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.Positioner>,
  "render"
> &
  Omit<ComponentProps<typeof ContextMenuPrimitive.Popup>, "render"> & {
    className?: string
  }) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner {...props}>
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
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
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  variant = "default",
  asChild = false,
  ...props
}: Omit<ComponentProps<typeof ContextMenuPrimitive.Item>, "render"> & {
  inset?: boolean
  variant?: "default" | "destructive"
  asChild?: boolean
}) {
  if (asChild) {
    const { children, ...rest } = props
    return (
      <ContextMenuPrimitive.Item
        data-slot="context-menu-item"
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
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
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

function ContextMenuCheckboxItem({
  className,
  children,
  checked,
  onCheckedChange,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>,
  "render" | "onCheckedChange"
> & {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}) {
  return (
    <ContextMenuPrimitive.CheckboxItem
      data-slot="context-menu-checkbox-item"
      checked={checked}
      onCheckedChange={(c: boolean) => onCheckedChange?.(c)}
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </ContextMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.CheckboxItem>
  )
}

function ContextMenuRadioItem({
  className,
  children,
  ...props
}: Omit<
  ComponentProps<typeof ContextMenuPrimitive.RadioItem>,
  "render"
>) {
  return (
    <ContextMenuPrimitive.RadioItem
      data-slot="context-menu-radio-item"
      className={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <ContextMenuPrimitive.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </ContextMenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </ContextMenuPrimitive.RadioItem>
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.GroupLabel> & {
  inset?: boolean
}) {
  return (
    <ContextMenuPrimitive.GroupLabel
      data-slot="context-menu-label"
      data-inset={inset}
      className={cn(
        "text-foreground px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      data-slot="context-menu-separator"
      className={cn("bg-border -mx-1 my-1 h-px", className)}
      {...props}
    />
  )
}

function ContextMenuShortcut({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
}
