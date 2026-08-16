"use client"

import { type ComponentProps } from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Switch.
 *
 * API differences handled:
 *  - `Switch.Root` → Base UI `Switch.Root` (same)
 *  - `Switch.Thumb` → Base UI `Switch.Thumb` (same)
 *  - `checked` / `onCheckedChange` props are the same
 *  - Radix `data-state="checked|unchecked"` → Base UI `data-checked` / `data-unchecked`
 *
 * The Radix `data-state="checked|unchecked"` attribute is ALSO emitted via the
 * `render` prop, so any consumer CSS using `data-[state=checked]:` continues to work.
 */

function Switch({
  className,
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      render={(componentProps, state) => (
        <span
          {...componentProps}
          data-state={state.checked ? "checked" : "unchecked"}
        />
      )}
      className={cn(
        "peer data-[checked]:bg-primary data-[unchecked]:bg-input focus-visible:border-ring focus-visible:ring-ring/50 dark:data-[unchecked]:bg-input/80 inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "bg-background dark:data-[unchecked]:bg-foreground dark:data-[checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[checked]:translate-x-[calc(100%-2px)] data-[unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
