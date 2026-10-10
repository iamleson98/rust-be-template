import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A section of a console page: the site's card (white on the canvas, a
 * hairline ring, a whisper of shadow) with an optional title row and an
 * action on the right.
 */
export function Panel({
  title,
  icon,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-2xl bg-card text-card-foreground shadow-soft ring-1 ring-slate-200/80 dark:ring-white/10',
        className,
      )}
    >
      {(title || action) && (
        <div className="flex min-h-12 items-center gap-2 px-4 pt-3">
          {icon && (
            <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
          )}
          {title && <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>}
          {action && <div className="ml-auto flex shrink-0 items-center gap-2">{action}</div>}
        </div>
      )}
      <div className={cn('p-4', (title || action) && 'pt-2', bodyClassName)}>{children}</div>
    </section>
  )
}

/** A small count next to a panel title. */
export function CountPill({ n, tone = 'neutral' }: { n: number; tone?: 'neutral' | 'amber' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
        tone === 'amber'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'
          : 'bg-muted text-muted-foreground',
      )}
    >
      {n}
    </span>
  )
}

/** Nothing here yet: an icon, one line, and an optional way forward. */
export function EmptyState({
  icon,
  text,
  action,
  className,
}: {
  icon: ReactNode
  text: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-8 text-center', className)}>
      <div className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </div>
      <p className="max-w-xs text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  )
}
