import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * Layout primitives for the UI gallery. Each demo section is a
 * <Section> with a stable data-testid ("sec-<id>") so Playwright
 * specs can scope assertions to a single component family.
 */
export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section
      id={`sec-${id}`}
      data-testid={`sec-${id}`}
      className={cn(
        'bg-card text-card-foreground rounded-xl border p-6 shadow-sm',
        className,
      )}
    >
      <div className="mb-5">
        <h2 className="text-lg leading-none font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground mt-2 text-sm">{description}</p>
        ) : null}
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  )
}

/** A labelled group of demo elements inside a section. */
export function Row({
  label,
  children,
  className,
}: {
  label?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('space-y-2', className)}>
      {label ? (
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {label}
        </span>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

/** Mirror span — reflects interactive state so Playwright can assert it. */
export function Mirror({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <span
      data-testid={testId}
      className="bg-secondary text-secondary-foreground inline-flex items-center rounded-md px-2 py-1 font-mono text-xs"
    >
      {children}
    </span>
  )
}
