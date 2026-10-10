import type { ReactNode } from 'react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'

/** A row of pill tabs that scrolls sideways instead of wrapping on narrow screens. */
export function PillTabs({ children }: { children: ReactNode }) {
  return (
    <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0 scrollbar-none [&::-webkit-scrollbar]:hidden">
      {children}
    </TabsList>
  )
}

/** One pill tab: an optional icon, the label and an optional count. */
export function PillTab({
  value,
  icon,
  label,
  count,
}: {
  value: string
  icon?: ReactNode
  label: string
  count?: number
}) {
  return (
    <TabsTrigger
      value={value}
      className="h-9 flex-none rounded-full border-0 px-3.5 text-muted-foreground hover:bg-muted data-[active]:bg-primary/10 data-[active]:font-semibold data-[active]:text-primary dark:data-[active]:bg-primary/15"
    >
      {icon}
      {label}
      {count != null && count > 0 && (
        <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-background px-1.5 text-[11px] font-semibold tabular-nums">
          {count}
        </span>
      )}
    </TabsTrigger>
  )
}
