"use client"

import { type ComponentProps, createContext, useContext } from "react"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

/**
 * Radix-compat wrapper around Base UI's ToggleGroup + Toggle (used as items).
 *
 * API differences handled:
 *  - Radix `ToggleGroup.Root`        → Base UI `ToggleGroup` (single component, not a namespace)
 *  - Radix `ToggleGroup.Item`        → Base UI `Toggle` with `value` prop (Base UI uses the
 *                                       same Toggle primitive inside a ToggleGroup — a Toggle
 *                                       with a `value` automatically registers as a group item)
 *  - Radix `type="single|multiple"`  → Base UI `multiple: boolean`
 *  - Radix `value: string|string[]`  → Base UI `value: Value[]` (always array)
 *  - Radix `data-state="on|off"`     → Base UI `data-pressed` (present-only)
 *
 * The Radix `data-state="on|off"` attribute is ALSO emitted on each item via the
 * `render` prop, so any consumer CSS using `data-[state=on]:` continues to work.
 */

const ToggleGroupContext = createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
})

function ToggleGroup({
  className,
  variant,
  size,
  children,
  type,
  multiple,
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof ToggleGroupPrimitive>,
  "value" | "defaultValue" | "onValueChange" | "multiple"
> &
  VariantProps<typeof toggleVariants> & {
    /** Radix-compat. Mapped to Base UI's `multiple` boolean. */
    type?: "single" | "multiple"
    /** Base UI native. Overrides `type` if both are passed. */
    multiple?: boolean
    /** Radix accepts string (single) or string[] (multiple); Base UI is always an array. */
    value?: string | string[]
    defaultValue?: string | string[]
    onValueChange?: (value: string | string[]) => void
  }) {
  const isMultiple = multiple ?? type === "multiple"

  const arrayValue =
    value === undefined
      ? undefined
      : Array.isArray(value)
        ? value
        : value === ""
          ? []
          : [value]
  const arrayDefaultValue =
    defaultValue === undefined
      ? undefined
      : Array.isArray(defaultValue)
        ? defaultValue
        : defaultValue === ""
          ? []
          : [defaultValue]

  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      data-variant={variant}
      data-size={size}
      className={cn(
        "group/toggle-group flex w-fit items-center rounded-md data-[variant=outline]:shadow-xs",
        className
      )}
      multiple={isMultiple}
      value={arrayValue as unknown as ComponentProps<typeof ToggleGroupPrimitive>["value"]}
      defaultValue={
        arrayDefaultValue as unknown as ComponentProps<
          typeof ToggleGroupPrimitive
        >["defaultValue"]
      }
      onValueChange={(next: unknown[]) => {
        if (!onValueChange) return
        if (isMultiple) onValueChange(next as string[])
        else onValueChange((next as string[])[0] ?? "")
      }}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size }}>
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant,
  size,
  ...props
}: ComponentProps<typeof TogglePrimitive> &
  VariantProps<typeof toggleVariants>) {
  const context = useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      render={(componentProps, state) => (
        <button
          {...componentProps}
          data-state={state.pressed ? "on" : "off"}
        />
      )}
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "min-w-0 flex-1 shrink-0 rounded-none shadow-none first:rounded-l-md last:rounded-r-md focus:z-10 focus-visible:z-10 data-[variant=outline]:border-l-0 data-[variant=outline]:first:border-l",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
