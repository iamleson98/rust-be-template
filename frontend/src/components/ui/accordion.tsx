"use client"

import { type ComponentProps } from "react"
import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Accordion.
 *
 * API differences handled:
 *  - Radix `type="single" | "multiple"` → Base UI `multiple: boolean`
 *  - Radix `value: string | string[]`   → Base UI `value: Value[]` (always array)
 *  - Radix `Accordion.Content`          → Base UI `Accordion.Panel`
 *  - Radix `data-state="open|closed"`   → Base UI `data-open` (Panel) / `data-panel-open` (Trigger)
 *
 * The Radix `type` prop is preserved for backward compatibility — when `type="single"`,
 * string values are wrapped into a 1-element array on the way in, and unwrapped on the
 * way out of `onValueChange`. When `type="multiple"` (or `multiple` is set), arrays pass
 * through unchanged.
 */
function Accordion({
  type,
  multiple,
  value,
  defaultValue,
  onValueChange,
  ...props
}: Omit<
  ComponentProps<typeof AccordionPrimitive.Root>,
  "value" | "defaultValue" | "onValueChange" | "multiple"
> & {
  /** Radix-compat. Mapped to Base UI's `multiple` boolean. */
  type?: "single" | "multiple"
  /** Base UI native. Overrides `type` if both are passed. */
  multiple?: boolean
  /** Radix accepts string (single) or string[] (multiple); Base UI is always an array. */
  value?: string | string[]
  defaultValue?: string | string[]
  /**
   * Union of the two Radix callback shapes — pick one based on `type`.
   * A `Dispatch<SetStateAction<string[]>>` (from `useState<string[]>`) is
   * assignable to the array variant via parameter contravariance.
   */
  onValueChange?: ((value: string) => void) | ((value: string[]) => void)
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
    <AccordionPrimitive.Root
      data-slot="accordion"
      multiple={isMultiple}
      value={arrayValue as unknown as ComponentProps<typeof AccordionPrimitive.Root>["value"]}
      defaultValue={
        arrayDefaultValue as unknown as ComponentProps<
          typeof AccordionPrimitive.Root
        >["defaultValue"]
      }
      onValueChange={(next: unknown[]) => {
        if (!onValueChange) return
        if (isMultiple) {
          ;(onValueChange as (value: string[]) => void)(next as string[])
        } else {
          ;(onValueChange as (value: string) => void)(
            (next as string[])[0] ?? ""
          )
        }
      }}
      {...props}
    />
  )
}

function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b last:border-b-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "focus-visible:border-ring focus-visible:ring-ring/50 flex flex-1 items-start justify-between gap-4 rounded-md py-4 text-left text-sm font-medium transition-all outline-none hover:underline focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 [&[data-panel-open]>svg]:rotate-180",
          className
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="text-muted-foreground pointer-events-none size-4 shrink-0 translate-y-0.5 transition-transform duration-200" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Panel>) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      // tw-animate-css's `accordion-down`/`accordion-up` keyframes read
      // `--radix-accordion-content-height`. Base UI exposes the same value
      // under `--accordion-panel-height`, so alias it for backward compat.
      style={{
        // Cast: CSS custom properties are not in CSSProperties by default.
        ["--radix-accordion-content-height" as string]: "var(--accordion-panel-height)",
      }}
      className="data-ending-style:animate-accordion-up data-starting-style:animate-accordion-down overflow-hidden text-sm"
      {...props}
    >
      <div className={cn("pt-0 pb-4", className)}>{children}</div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
