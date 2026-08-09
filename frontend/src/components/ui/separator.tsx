"use client"

import { type ComponentProps } from "react"
import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "@/lib/utils"

type SeparatorPrimitiveProps = ComponentProps<typeof SeparatorPrimitive>

interface SeparatorProps extends Omit<SeparatorPrimitiveProps, "role" | "aria-orientation"> {
  /**
   * Whether the separator is purely visual (hidden from assistive
   * technology). When `false`, the element exposes `role="separator"`.
   * @default true
   */
  decorative?: boolean
}

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: SeparatorProps) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      role={decorative ? "none" : "separator"}
      aria-orientation={decorative ? undefined : orientation}
      orientation={orientation}
      className={cn(
        "bg-border shrink-0 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
export type { SeparatorProps }
