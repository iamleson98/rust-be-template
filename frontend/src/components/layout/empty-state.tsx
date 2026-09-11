'use client'

import { memo } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/* ─── Generic EmptyState ─── */

type EmptyStateProps = {
  illustration: ReactNode
  title: string
  description?: string
  children?: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

export const EmptyState = memo(function EmptyState({
  illustration,
  title,
  description,
  children,
  className,
  size = 'md',
}: EmptyStateProps) {
  const sizeCls = {
    sm: { box: 'h-16 w-16', title: 'text-base', desc: 'text-xs' },
    md: { box: 'h-24 w-24', title: 'text-lg', desc: 'text-sm' },
    lg: { box: 'h-32 w-32', title: 'text-xl', desc: 'text-sm' },
  }[size]

  return (
    <div



      className={cn('flex flex-col items-center justify-center text-center px-6 py-10', className)}
    >
      {/* Floating illustration */}
      <div



        className="relative"
      >
        <div


          className={cn(
            'relative rounded-3xl bg-linear-to-br from-blue-50 to-blue-50 inline-flex items-center justify-center ring-4 ring-blue-100/40 ',
            sizeCls.box
          )}
        >
          {illustration}
        </div>
      </div>

      <h3



        className={cn('font-bold mt-5 text-foreground', sizeCls.title)}
      >
        {title}
      </h3>

      {description && (
        <p



          className={cn('text-muted-foreground mt-1.5 max-w-md leading-relaxed', sizeCls.desc)}
        >
          {description}
        </p>
      )}

      {children && (
        <div



          className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3"
        >
          {children}
        </div>
      )}
    </div>
  )
})
