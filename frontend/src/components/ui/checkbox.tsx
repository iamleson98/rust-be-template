"use client"

import { type ComponentProps } from "react"
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Checkbox.
 *
 * API differences handled:
 *  - `Checkbox.Root`      → Base UI `Checkbox.Root` (same)
 *  - `Checkbox.Indicator` → Base UI `Checkbox.Indicator` (same)
 *  - `checked` / `onCheckedChange` props are the same
 *  - Radix `data-state="checked|unchecked|indeterminate"` → Base UI
 *    `data-checked` / `data-unchecked` / `data-indeterminate` (present-only)
 *
 * The Radix `data-state="..."` attribute is ALSO emitted via the `render` prop
 * so consumer CSS using `data-[state=checked]:bg-blue-600` etc. continues to
 * work alongside Base UI's native `data-[checked]:` selectors.
 */

function Checkbox({
  className,
  ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      render={(componentProps, state) => (
        <span
          {...componentProps}
          data-state={
            state.indeterminate
              ? "indeterminate"
              : state.checked
                ? "checked"
                : "unchecked"
          }
        />
      )}
      className={cn(
        "peer border-input dark:bg-input/30 data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary data-checked:border-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive size-4 shrink-0 rounded-lg border shadow-xs transition-shadow outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
