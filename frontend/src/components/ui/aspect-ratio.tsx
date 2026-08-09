"use client"

import { type ComponentProps } from "react"

import { cn } from "@/lib/utils"

export interface AspectRatioProps extends ComponentProps<"div"> {
  /**
   * The desired aspect ratio (width / height). Defaults to 16/9.
   * @default 16 / 9
   */
  ratio?: number
}

/**
 * AspectRatio — plain HTML replacement for @radix-ui/react-aspect-ratio.
 *
 * Base UI does not ship an aspect-ratio component, so we replicate the
 * Radix layout with a `<div>` using the modern `aspect-ratio` CSS property.
 * Children are wrapped in an absolutely-positioned container so existing
 * consumers (e.g. `<img className="size-full object-cover" />`) work
 * unchanged.
 *
 * Public API preserved: `<AspectRatio ratio={16/9}>...</AspectRatio>`.
 */
function AspectRatio({
  className,
  ratio = 16 / 9,
  children,
  ...props
}: AspectRatioProps) {
  return (
    <div
      data-slot="aspect-ratio"
      style={{ aspectRatio: String(ratio) }}
      className={cn("relative size-full w-full", className)}
      {...props}
    >
      <div className="absolute inset-0">{children}</div>
    </div>
  )
}

export { AspectRatio }
