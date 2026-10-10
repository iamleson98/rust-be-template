'use client'

import { type ComponentProps, forwardRef, type Ref } from 'react'
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'

import { cn } from '@/lib/utils'

type ScrollAreaProps = ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  /** Ref to the element that actually scrolls (the root only clips). */
  viewportRef?: Ref<HTMLDivElement>
}

const ScrollArea = forwardRef<React.ComponentRef<typeof ScrollAreaPrimitive.Root>, ScrollAreaProps>(
  function ScrollArea({ className, children, viewportRef, ...props }, ref) {
    return (
      <ScrollAreaPrimitive.Root
        ref={ref}
        data-slot="scroll-area"
        className={cn('relative', className)}
        {...props}
      >
        <ScrollAreaPrimitive.Viewport
          ref={viewportRef}
          data-slot="scroll-area-viewport"
          className="focus-visible:ring-ring/50 size-full rounded-[inherit] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:outline-1"
        >
          {children}
        </ScrollAreaPrimitive.Viewport>
        <ScrollBar />
        <ScrollAreaPrimitive.Corner />
      </ScrollAreaPrimitive.Root>
    )
  },
)

function ScrollBar({
  className,
  orientation = 'vertical',
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Scrollbar>) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' && 'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' && 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className="bg-border relative flex-1 rounded-full"
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
