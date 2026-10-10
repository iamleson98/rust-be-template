import type { ReactNode } from 'react'
import { Shimmer } from '@/components/ui/shimmer'
import { cn } from '@/lib/utils'

/** A landing-page band: one page width, one rhythm. */
export function HomeSection({
  title,
  subtitle,
  action,
  className,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  /** A link or button on the heading's right ("see all"). */
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cn('page-x py-8 md:py-11', className)}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 md:mb-6">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-xl font-bold tracking-tight text-balance text-slate-900 md:text-2xl">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/**
 * Cards that scroll sideways on phones (thumb-friendly, no page-long stack)
 * and sit in a grid from `sm` up; add the `lg:` column count at the call site.
 */
export const RAIL =
  '-mx-4 grid auto-cols-[80%] grid-flow-col gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] snap-x snap-mandatory sm:mx-0 sm:auto-cols-auto sm:grid-flow-row sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:snap-start'

/** Placeholder for a band of cards while its data loads. */
export function RailSkeleton({
  count = 4,
  cols = 'lg:grid-cols-4',
}: {
  count?: number
  cols?: string
}) {
  return (
    <section className="page-x py-8 md:py-11" aria-hidden>
      <div className="mb-6 space-y-2">
        <Shimmer className="h-7 w-56" />
        <Shimmer className="h-4 w-40" />
      </div>
      <div className={cn(RAIL, cols)}>
        {Array.from({ length: count }).map((_, i) => (
          <Shimmer key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    </section>
  )
}
