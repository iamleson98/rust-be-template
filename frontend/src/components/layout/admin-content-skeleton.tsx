'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Admin Content Skeleton ───
 * Mirrors the admin pages' common structure: page title + subtitle,
 * a toolbar row (search input + filter selects + action button), and
 * a bordered data-table surface — header row + 6 body rows + a
 * pagination footer. Used as the Suspense fallback INSIDE the
 * persistent AdminShell so page-to-page navigation swaps content
 * without any white flash.
 */
export const AdminContentSkeleton = memo(function AdminContentSkeleton() {
  return (
    <div className="p-3 md:p-6 space-y-4" aria-hidden>
      {/* Page header */}
      <div className="space-y-1.5">
        <Shimmer className="h-6 w-56" />
        <Shimmer className="h-3.5 w-80 max-w-full" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Shimmer className="h-9 w-64 rounded-lg" />
        <Shimmer className="h-9 w-36 rounded-lg" />
        <Shimmer className="h-9 w-36 rounded-lg" />
        <div className="flex-1" />
        <Shimmer className="h-9 w-28 rounded-lg" />
      </div>

      {/* Table surface */}
      <div className="rounded-lg border bg-card overflow-hidden" data-slot="admin-content-skeleton">
        {/* Header row */}
        <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
          <Shimmer className="h-4 w-32" />
          <Shimmer className="h-4 w-24" />
          <Shimmer className="h-4 w-20" />
          <Shimmer className="h-4 w-24" />
          <div className="flex-1" />
          <Shimmer className="h-4 w-16" />
        </div>
        {/* Body rows */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3.5">
            <Shimmer className="h-5 w-40" style={{ opacity: 1 - i * 0.12 }} />
            <Shimmer className="h-5 w-24" style={{ opacity: 1 - i * 0.12 }} />
            <Shimmer className="h-5 w-16" style={{ opacity: 1 - i * 0.12 }} />
            <Shimmer className="h-5 w-28" style={{ opacity: 1 - i * 0.12 }} />
            <div className="flex-1" />
            <Shimmer className="h-7 w-7 rounded-md" style={{ opacity: 1 - i * 0.12 }} />
          </div>
        ))}
        {/* Pagination footer */}
        <div className="flex items-center justify-between px-4 py-3">
          <Shimmer className="h-4 w-36" />
          <div className="flex items-center gap-2">
            <Shimmer className="h-8 w-8 rounded-md" />
            <Shimmer className="h-8 w-8 rounded-md" />
            <Shimmer className="h-8 w-8 rounded-md" />
          </div>
        </div>
      </div>
    </div>
  )
})
