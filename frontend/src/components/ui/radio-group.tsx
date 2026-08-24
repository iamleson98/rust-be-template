"use client"

import { type ComponentProps } from "react"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { CircleIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's RadioGroup + Radio primitives.
 *
 * API differences handled:
 *  - Radix `RadioGroup.Root`     → Base UI `RadioGroup` (single component from `@base-ui/react/radio-group`)
 *  - Radix `RadioGroup.Item`     → Base UI `Radio.Root` (from `@base-ui/react/radio`)
 *  - Radix `RadioGroup.Indicator`→ Base UI `Radio.Indicator`
 *  - `value` / `onValueChange` props on the group are the same
 *  - `value` prop on each item is the same
 *
 * Base UI's Radio.Root data attributes (`data-checked` / `data-unchecked`) are
 * used for the shadcn styles. The Radix `data-state="checked|unchecked"`
 * attribute is ALSO emitted via the `render` prop for consumer CSS compat.
 */

function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("grid gap-3", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      render={(componentProps, state) => (
        <span
          {...componentProps}
          data-state={state.checked ? "checked" : "unchecked"}
        />
      )}
      className={cn(
        "border-input text-primary focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 aspect-square size-4 shrink-0 rounded-full border  transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <CircleIcon className="fill-primary absolute top-1/2 left-1/2 size-2 -translate-x-1/2 -translate-y-1/2" />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
