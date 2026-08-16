"use client"

import { type ComponentProps, useMemo } from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * Radix-compat wrapper around Base UI's Slider.
 *
 * API differences handled:
 *  - Radix `Slider.Range` → Base UI `Slider.Indicator` (Base UI has no `Range`
 *    component — `Indicator` renders the filled portion of the track, which is
 *    what Radix's `Range` did)
 *  - `value` / `onValueChange` prop names are the same.
 *
 * Note on `onValueChange`: Radix's callback is `(value: number[], event: Event) => void`
 * while Base UI's is `(value: number | readonly number[], eventDetails) => void`. To
 * preserve the Radix-compatible consumer API, this wrapper overrides
 * `onValueChange` to accept `(value: number[]) => void` (always a mutable array,
 * no eventDetails) and normalizes Base UI's call signature internally — single
 * numbers are wrapped into `[n]`, readonly arrays are spread into a mutable array.
 */

function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof SliderPrimitive.Root>, "onValueChange"> & {
  onValueChange?: (value: number[]) => void
}) {
  const _values = useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      onValueChange={(next, _eventDetails) => {
        // Base UI calls with `number | readonly number[]`; normalize to mutable `number[]`
        const arr = Array.isArray(next) ? Array.from(next) : [next]
        onValueChange?.(arr)
      }}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "bg-muted relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
        )}
      >
        <SliderPrimitive.Indicator
          data-slot="slider-range"
          className={cn(
            "bg-primary absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          index={index}
          className="border-primary bg-background ring-ring/50 block size-4 shrink-0 rounded-full border shadow-sm transition-[color,box-shadow] hover:ring-4 focus-visible:ring-4 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
