"use client"

/**
 * NavigationMenu — Base UI implementation preserving the Radix/shadcn public API.
 *
 * Base UI's `NavigationMenu` module API is similar to Radix's:
 *
 * | Radix                          | Base UI                              |
 * | ------------------------------ | ------------------------------------ |
 * | `<NavigationMenu.Root>`        | `<NavigationMenu.Root>`              |
 * | `<NavigationMenu.List>`        | `<NavigationMenu.List>`              |
 * | `<NavigationMenu.Item>`        | `<NavigationMenu.Item>`              |
 * | `<NavigationMenu.Trigger>`     | `<NavigationMenu.Trigger>`           |
 * | `<NavigationMenu.Content>`     | `<NavigationMenu.Content>` (also: `<NavigationMenu.Popup>` for the popup wrapper) |
 * | `<NavigationMenu.Link>`        | `<NavigationMenu.Link>`              |
 * | `<NavigationMenu.Indicator>`   | no direct Base UI equivalent — rendered as a plain `<div>` placeholder |
 * | `<NavigationMenu.Viewport>`    | `<NavigationMenu.Viewport>`          |
 * | `<NavigationMenu.Portal>`      | `<NavigationMenu.Portal>`            |
 * | `data-[state=open]`            | `data-open` + (shimmed) `data-state="open"` via `render` |
 * | `data-[motion=from-end]`       | `data-starting-style` + `data-activation-direction="right"` |
 * | `--radix-navigation-menu-viewport-height` | `--popup-height` (Base UI popup CssVar) |
 * | `--radix-navigation-menu-viewport-width`  | `--popup-width`  (Base UI popup CssVar) |
 *
 * Public API preserved: all original export names (`NavigationMenu`, `NavigationMenuList`,
 * `NavigationMenuItem`, `NavigationMenuContent`, `NavigationMenuTrigger`, `NavigationMenuLink`,
 * `NavigationMenuIndicator`, `NavigationMenuViewport`, `navigationMenuTriggerStyle`).
 */
import { type ComponentProps } from "react"
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu"
import { cva } from "class-variance-authority"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function NavigationMenu({
  className,
  children,
  viewport = true,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Root> & {
  viewport?: boolean
}) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      data-viewport={viewport}
      className={cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      )}
      {...props}
    >
      {children}
      {viewport && <NavigationMenuViewport />}
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        "group flex flex-1 list-none items-center justify-center gap-1",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

const navigationMenuTriggerStyle = cva(
  "group inline-flex h-9 w-max items-center justify-center rounded-md bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:hover:bg-accent data-[state=open]:text-accent-foreground data-[state=open]:focus:bg-accent data-[state=open]:bg-accent/50 focus-visible:ring-ring/50 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1"
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Trigger>) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      // Emit `data-state` for backward-compat with the cva classes above and
      // the chevron rotate animation below (`group-data-[state=open]:rotate-180`).
      render={(componentProps: any, state: any) => (
        <button
          {...componentProps}
          data-state={state.open ? "open" : "closed"}
        />
      )}
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      {...props}
    >
      {children}{" "}
      <ChevronDownIcon
        className="relative top-px ml-1 size-3 transition duration-300 group-data-[state=open]:rotate-180"
        aria-hidden="true"
      />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Content>) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      render={(componentProps: any, state: any) => (
        <div
          {...componentProps}
          data-state={state.open ? "open" : "closed"}
          data-activation-direction={state.activationDirection ?? undefined}
        />
      )}
      className={cn(
        // Base UI equivalents for the Radix motion CSS selectors:
        //   data-[motion^=from-]:animate-in → data-[starting-style]:animate-in
        //   data-[motion^=to-]:animate-out   → data-[ending-style]:animate-out
        //   data-[motion=from-end]:slide-in-from-right-52 → data-[activation-direction=right]:slide-in-from-right-52 (starting-style)
        //   data-[motion=from-start]:slide-in-from-left-52 → data-[activation-direction=left]:slide-in-from-left-52 (starting-style)
        //   data-[motion=to-end]:slide-out-to-right-52 → data-[activation-direction=right]:slide-out-to-right-52 (ending-style)
        //   data-[motion=to-start]:slide-out-to-left-52 → data-[activation-direction=left]:slide-out-to-left-52 (ending-style)
        "data-starting-style:animate-in data-ending-style:animate-out data-starting-style:fade-in data-ending-style:fade-out data-[starting-style][data-activation-direction=right]:slide-in-from-right-52 data-[starting-style][data-activation-direction=left]:slide-in-from-left-52 data-[ending-style][data-activation-direction=right]:slide-out-to-right-52 data-[ending-style][data-activation-direction=left]:slide-out-to-left-52 top-0 left-0 w-full p-2 pr-2.5 md:absolute md:w-auto",
        "group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground group-data-[viewport=false]/navigation-menu:data-[state=open]:animate-in group-data-[viewport=false]/navigation-menu:data-[state=closed]:animate-out group-data-[viewport=false]/navigation-menu:data-[state=closed]:zoom-out-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:zoom-in-95 group-data-[viewport=false]/navigation-menu:data-[state=open]:fade-in-0 group-data-[viewport=false]/navigation-menu:data-[state=closed]:fade-out-0 group-data-[viewport=false]/navigation-menu:top-full group-data-[viewport=false]/navigation-menu:mt-1.5 group-data-[viewport=false]/navigation-menu:overflow-hidden group-data-[viewport=false]/navigation-menu:rounded-md group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:shadow group-data-[viewport=false]/navigation-menu:duration-200 **:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuViewport({
  className,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Viewport>) {
  return (
    <div className={cn("absolute top-full left-0 isolate z-50 flex justify-center")}>
      <NavigationMenuPrimitive.Viewport
        data-slot="navigation-menu-viewport"
        render={(componentProps: any, state: any) => (
          <div
            {...componentProps}
            data-state={state.open ? "open" : "closed"}
          />
        )}
        className={cn(
          // Base UI popup CSS vars: `--popup-height` and `--popup-width`
          // (replacing Radix's `--radix-navigation-menu-viewport-{height,width}`)
          "origin-top-center bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-90 relative mt-1.5 h-(--popup-height) w-full overflow-hidden rounded-md border shadow md:w-(--popup-width)",
          className
        )}
        {...props}
      />
    </div>
  )
}

function NavigationMenuLink({
  className,
  ...props
}: ComponentProps<typeof NavigationMenuPrimitive.Link>) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      className={cn(
        "data-[active=true]:focus:bg-accent data-[active=true]:hover:bg-accent data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus-visible:ring-ring/50 [&_svg:not([class*='text-'])]:text-muted-foreground flex flex-col gap-1 rounded-sm p-2 text-sm transition-all outline-none focus-visible:ring-[3px] focus-visible:outline-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/**
 * Base UI's NavigationMenu doesn't expose an `Indicator` primitive (the small
 * triangle below the active trigger). We render a plain `<div>` for API
 * compatibility — the indicator visual is purely decorative and the original
 * Radix component was unused in this codebase.
 */
function NavigationMenuIndicator({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="navigation-menu-indicator"
      className={cn(
        "data-[state=visible]:animate-in data-[state=hidden]:animate-out data-[state=hidden]:fade-out data-[state=visible]:fade-in top-full z-1 flex h-1.5 items-end justify-center overflow-hidden",
        className
      )}
      {...props}
    >
      <div className="bg-border relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm " />
    </div>
  )
}

export {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuContent,
  NavigationMenuTrigger,
  NavigationMenuLink,
  NavigationMenuIndicator,
  NavigationMenuViewport,
  navigationMenuTriggerStyle,
}
