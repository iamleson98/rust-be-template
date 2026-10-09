import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** A console page's frame: one width and rhythm for every page in both consoles. */
export function ConsolePage({
  width = 'wide',
  className,
  children,
}: {
  /** `narrow` for single-column pages such as forms. */
  width?: 'wide' | 'narrow'
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        // Bottom room on phones: floating buttons (call, support) sit there.
        'mx-auto w-full space-y-5 px-4 pt-5 pb-24 md:px-6 md:py-6',
        width === 'wide' ? 'max-w-7xl' : 'max-w-2xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** The page title, an optional line under it, and the page's own actions. */
export function PageHeader({
  title,
  description,
  actions,
  before,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Above the title, e.g. a back link. */
  before?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {before}
        <h1 className="text-xl font-semibold tracking-tight text-balance sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
