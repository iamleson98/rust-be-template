'use client'

import { type ComponentProps } from 'react'
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group'
import { Radio as RadioPrimitive } from '@base-ui/react/radio'

import { cn } from '@/lib/utils'

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

function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive>) {
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  )
}

function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioPrimitive.Root>) {
  return (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      render={(componentProps, state) => (
        <span {...componentProps} data-state={state.checked ? 'checked' : 'unchecked'} />
      )}
      // A grid that centres the dot (the root renders as a span, which has no layout).
      className={cn(
        'border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 data-[state=checked]:border-primary inline-grid aspect-square size-4 shrink-0 place-items-center rounded-full border bg-white transition-[color,box-shadow,border-color] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="size-2 rounded-full bg-primary"
      />
    </RadioPrimitive.Root>
  )
}

export { RadioGroup, RadioGroupItem }
