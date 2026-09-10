'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'
import { cn } from '@/lib/utils'

/* ─── Shimmer Skeleton primitive ───
 * Moved to `@/components/ui/shimmer` (shared with the DataTable's
 * loading surface). Re-exported here for convenience.
 */
export { Shimmer }

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

/* ─── Account Content Skeleton ───
 * The account pages' shape: page heading + a card grid (2 columns on
 * desktop) — each card has a header row + lines. Used inside the
 * persistent AccountShell.
 */
export const AccountContentSkeleton = memo(function AccountContentSkeleton() {
  return (
    <div className="p-3 md:p-6 space-y-4" aria-hidden>
      <div className="space-y-1.5">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Shimmer className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-5/6" />
            <Shimmer className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
})

/* ─── Popular Routes Skeleton — 8 card grid ─── */
export const PopularRoutesSkeleton = memo(function PopularRoutesSkeleton({ count = 8 }: { count?: number }) {
  return (
    <section className="container mx-auto px-4 py-12 md:py-16">
      <div className="flex items-end justify-between mb-6">
        <div className="space-y-2">
          <Shimmer className="h-7 w-56" />
          <Shimmer className="h-4 w-40" />
        </div>
        <Shimmer className="h-9 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className="overflow-hidden border-border/60">
            <Shimmer className="h-1.5 w-full rounded-none" />
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Shimmer className="h-5 w-20 rounded-full" />
                <Shimmer className="h-3.5 w-10" />
              </div>
              <div className="flex items-center gap-2">
                <Shimmer className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Shimmer className="h-4 w-20" />
                  <Shimmer className="h-2.5 w-12" />
                </div>
                <Shimmer className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5 text-right">
                  <Shimmer className="h-4 w-16 ml-auto" />
                  <Shimmer className="h-2.5 w-10 ml-auto" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <Shimmer className="h-3 w-12" />
                <Shimmer className="h-3 w-10" />
                <Shimmer className="h-3 w-20" />
              </div>
              <div className="flex items-center justify-between">
                <Shimmer className="h-4 w-28" />
                <Shimmer className="h-3 w-16" />
              </div>
              <Shimmer className="h-1.5 w-full rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
})

/* ─── Brand Showcase Skeleton — horizontal scroll ─── */
export const BrandShowcaseSkeleton = memo(function BrandShowcaseSkeleton({ count = 5 }: { count?: number }) {
  return (
    <section className="container mx-auto px-4 py-12 md:py-16">
      <div className="flex items-end justify-between mb-8">
        <div className="space-y-2">
          <Shimmer className="h-7 w-64" />
          <Shimmer className="h-4 w-48" />
        </div>
        <Shimmer className="h-8 w-24" />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card
            key={i}
            className="snap-start shrink-0 w-65 sm:w-70 overflow-hidden border-border/60"
          >
            <Shimmer className="h-1.5 w-full rounded-none" />
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Shimmer className="h-11 w-11 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Shimmer className="h-4 w-24" />
                  <Shimmer className="h-3 w-20" />
                </div>
              </div>
              <Shimmer className="h-5 w-20 rounded-full" />
              <Shimmer className="h-9 w-full rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
})

/* ─── Campaigns Skeleton — campaign cards ─── */
export const CampaignsSkeleton = memo(function CampaignsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="bg-linear-to-br from-amber-50 via-orange-50 to-rose-50 border-y border-amber-100/80">
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-end justify-between mb-6">
          <div className="space-y-2">
            <Shimmer className="h-7 w-52" />
            <Shimmer className="h-4 w-64" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            {Array.from({ length: count }).map((_, i) => (
              <Shimmer key={i} className="h-1.5 w-4 rounded-full" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: count }).map((_, i) => (
            <Card key={i} className="relative overflow-hidden border-0 h-full">
              <Shimmer className="absolute left-0 top-0 bottom-0 w-1.5 rounded-none" />
              <div className="p-5 pl-6 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <Shimmer className="h-5 w-28 rounded-full" />
                    <Shimmer className="h-5 w-40" />
                    <Shimmer className="h-3 w-24" />
                  </div>
                  <Shimmer className="h-6 w-20 rounded" />
                </div>
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-3/4" />
                <div className="flex items-center justify-between pt-1">
                  <Shimmer className="h-8 w-24 rounded-md" />
                  <Shimmer className="h-8 w-20 rounded-lg" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
})

/* ─── Testimonials Skeleton — testimonial cards ─── */
export const TestimonialsSkeleton = memo(function TestimonialsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="relative container mx-auto px-4 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <Shimmer className="h-6 w-44 rounded-full mx-auto mb-3" />
        <Shimmer className="h-9 w-72 mx-auto mb-3" />
        <Shimmer className="h-4 w-48 mx-auto" />
      </div>

      <div className="mb-10 max-w-2xl mx-auto">
        <Card className="border-blue-100 bg-linear-to-br from-blue-50/80 to-blue-50/50">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="flex flex-col items-center shrink-0 space-y-2">
                <Shimmer className="h-12 w-16" />
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Shimmer key={i} className="h-4 w-4 rounded" />
                  ))}
                </div>
                <Shimmer className="h-3 w-14" />
              </div>
              <div className="flex-1 w-full space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Shimmer className="h-3 w-4" />
                    <Shimmer className="h-4 w-4 rounded" />
                    <Shimmer className="h-2.5 flex-1 rounded-full" />
                    <Shimmer className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-5 overflow-x-auto pb-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="snap-start shrink-0 w-75 sm:w-85">
            <Card className="border-slate-100">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Shimmer className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Shimmer className="h-4 w-24" />
                    <Shimmer className="h-3 w-20" />
                  </div>
                  <Shimmer className="h-3 w-12" />
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Shimmer key={j} className="h-4 w-4 rounded" />
                  ))}
                </div>
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-5/6" />
                <Shimmer className="h-3 w-2/3" />
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </section>
  )
})

/* ─── Admin Dashboard Skeleton — KPI + chart skeletons ─── */
export const AdminDashboardSkeleton = memo(function AdminDashboardSkeleton() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-2">
            <Shimmer className="h-3 w-32" />
            <Shimmer className="h-8 w-56" />
          </div>
          <Shimmer className="h-10 w-44 rounded-lg" />
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="overflow-hidden">
              <Shimmer className="h-1 w-full rounded-none" />
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <Shimmer className="h-3 w-20" />
                    <Shimmer className="h-7 w-24" />
                  </div>
                  <Shimmer className="h-11 w-11 rounded-xl" />
                </div>
                <div className="flex items-center gap-1.5 mt-2.5">
                  <Shimmer className="h-3.5 w-3.5 rounded" />
                  <Shimmer className="h-3 w-28" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
          {/* Revenue bar chart */}
          <Card className="lg:col-span-3 overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shimmer className="h-4 w-4 rounded" />
                <Shimmer className="h-5 w-56" />
              </div>
              <div className="flex items-end gap-3 h-48 mt-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <Shimmer className="h-3 w-8" />
                    <Shimmer
                      className="w-full rounded-t-md"
                      style={{ height: `${40 + ((i * 17) % 80)}px` }}
                    />
                    <Shimmer className="h-3 w-6" />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <Shimmer className="h-3 w-16" />
                <Shimmer className="h-4 w-32" />
              </div>
            </div>
          </Card>

          {/* Donut chart */}
          <Card className="lg:col-span-2 overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shimmer className="h-4 w-4 rounded" />
                <Shimmer className="h-5 w-44" />
              </div>
              <div className="flex items-center justify-center my-6">
                <Shimmer className="h-36 w-36 rounded-full" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Shimmer className="h-2.5 w-2.5 rounded-full" />
                    <Shimmer className="h-3 w-16" />
                    <Shimmer className="h-3 w-6 ml-auto" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* Recent bookings table */}
        <Card className="overflow-hidden mb-4">
          <Shimmer className="h-1 w-full rounded-none" />
          <div className="p-6 pb-3">
            <div className="flex items-center gap-2">
              <Shimmer className="h-4 w-4 rounded" />
              <Shimmer className="h-5 w-36" />
            </div>
          </div>
          <div className="p-6 pt-0 space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-4 w-32 hidden md:block" />
                <Shimmer className="h-4 w-28 hidden md:block" />
                <Shimmer className="h-4 w-20" />
                <Shimmer className="h-5 w-16 rounded-full" />
                <Shimmer className="h-3 w-16 hidden sm:block" />
              </div>
            ))}
          </div>
        </Card>

        {/* Bottom row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Card className="lg:col-span-3 overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shimmer className="h-4 w-4 rounded" />
                <Shimmer className="h-5 w-52" />
              </div>
              <div className="space-y-3.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shimmer className="h-6 w-6 rounded-md" />
                        <Shimmer className="h-4 w-32" />
                      </div>
                      <Shimmer className="h-4 w-12" />
                    </div>
                    <Shimmer className="h-2.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </Card>
          <Card className="lg:col-span-2 overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <div className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Shimmer className="h-4 w-4 rounded" />
                <Shimmer className="h-5 w-40" />
              </div>
              <div className="space-y-2.5">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Shimmer className="h-7 w-7 rounded-full" />
                    <div className="flex-1 space-y-1.5">
                      <Shimmer className="h-3 w-full" />
                      <Shimmer className="h-2.5 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
})

/* ─── Trip Detail Skeleton — seat map + info ─── */
export const TripDetailSkeleton = memo(function TripDetailSkeleton() {
  return (
    <div className="max-w-5xl w-[95vw] max-h-[92vh]">
      {/* Header */}
      <div className="px-5 py-4 border-b bg-linear-to-r from-slate-50 to-white space-y-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-9 w-9 rounded-lg" />
          <div className="space-y-1.5">
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-3 w-48" />
          </div>
        </div>
        <Shimmer className="h-5 w-64" />
        <div className="flex items-center gap-2">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-2">
          <Shimmer className="h-5 w-20 rounded-full" />
          <Shimmer className="h-5 w-16 rounded-full" />
          <Shimmer className="h-5 w-20 rounded-full" />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-slate-50 px-3 py-2 flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Shimmer key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="p-4 space-y-3 border-r">
          <div className="flex items-center justify-between">
            <Shimmer className="h-5 w-32" />
            <Shimmer className="h-4 w-28" />
          </div>
          {/* Seat grid */}
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 15 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </div>
        <div className="bg-slate-50 p-4 space-y-4">
          <div className="space-y-2">
            <Shimmer className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          <div className="space-y-2">
            <Shimmer className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          <Shimmer className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
})

/* ─── My Bookings Skeleton — booking cards ─── */
export const MyBookingsSkeleton = memo(function MyBookingsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-5">
      {/* Stats cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <CardContent className="p-4 md:p-5 flex items-center gap-3.5">
              <Shimmer className="h-11 w-11 rounded-xl" />
              <div className="space-y-1.5 flex-1">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-6 w-24" />
                <Shimmer className="h-3 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Booking cards skeleton */}
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Shimmer className="h-1.5 w-full rounded-none" />
          <CardContent className="p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shimmer className="h-6 w-28 rounded" />
                <Shimmer className="h-5 w-24 rounded-full" />
              </div>
              <Shimmer className="h-10 w-10 rounded-lg" />
            </div>
            <div className="flex items-center gap-3">
              <Shimmer className="h-8 w-8 rounded-lg" />
              <div className="space-y-1.5">
                <Shimmer className="h-4 w-40" />
                <Shimmer className="h-3 w-56" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Shimmer className="h-14 w-14 rounded-lg" />
              <div className="space-y-1.5">
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-3 w-28" />
              </div>
              <div className="ml-auto space-y-1.5 text-right">
                <Shimmer className="h-7 w-28 ml-auto" />
                <Shimmer className="h-3 w-20 ml-auto" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
})

/* ───────────────────────────────────────────────────────────────────────
 P8-C: New skeletons — SearchResults, TripCardDetailed, BookingDialog,
 MapView — with premium shimmer + realistic content shapes.
 ─────────────────────────────────────────────────────────────────────── */

/* ─── Search Results Skeleton — full page with filter sidebar ─── */
export const SearchResultsSkeleton = memo(function SearchResultsSkeleton() {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="container mx-auto px-4 py-6">
        {/* Top: search widget bar */}
        <div className="rounded-2xl bg-white p-4 mb-4 ring-1 ring-black/5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 items-end">
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="hidden md:block h-10 w-10 rounded-full" />
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="h-10 w-24 rounded-lg" />
          </div>
          <div className="mt-4 flex justify-between items-center">
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Shimmer key={i} className="h-7 w-24 rounded-full" />
              ))}
            </div>
            <Shimmer className="h-10 w-36 rounded-lg" />
          </div>
        </div>

        {/* Header line */}
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-2">
            <Shimmer className="h-7 w-56" />
            <Shimmer className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-9 w-20 rounded-lg" />
            <Shimmer className="h-9 w-28 rounded-lg" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Filter sidebar */}
          <aside className="hidden lg:block">
            <Card className="overflow-hidden sticky top-20">
              <Shimmer className="h-1 w-full rounded-none" />
              <div className="p-4 space-y-5">
                {/* Price */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  <Shimmer className="h-2 w-full rounded-full" />
                  <div className="flex justify-between">
                    <Shimmer className="h-3 w-12" />
                    <Shimmer className="h-3 w-12" />
                  </div>
                </div>
                {/* Time ranges */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-24" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                {/* Rating */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded-full" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                {/* Amenities */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                <Shimmer className="h-9 w-full rounded-lg" />
              </div>
            </Card>
          </aside>

          {/* Trip cards */}
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <TripCardDetailedSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})

/* ─── Detailed Trip Card Skeleton — all sections ─── */
export const TripCardDetailedSkeleton = memo(function TripCardDetailedSkeleton() {
  return (
    <Card className="overflow-hidden border-border/60">
      <Shimmer className="absolute left-0 top-0 bottom-0 w-1 rounded-none" />
      <div className="flex flex-col md:flex-row">
        {/* Brand block */}
        <div className="md:w-44 shrink-0 bg-linear-to-b from-slate-50 to-slate-100/50 p-3 md:p-4 md:border-r flex flex-row md:flex-col items-center md:items-start gap-3 relative">
          <div className="absolute inset-0 bg-linear-to-br from-white/50 to-transparent pointer-events-none" />
          <Shimmer className="h-12 w-12 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-4 w-24" />
            <div className="flex items-center gap-1">
              <Shimmer className="h-3 w-3 rounded" />
              <Shimmer className="h-3 w-12" />
            </div>
            <Shimmer className="h-5 w-20 rounded-full" />
          </div>
        </div>

        {/* Time + amenities */}
        <div className="flex-1 p-3 md:p-4 min-w-0">
          <div className="flex items-center gap-3">
            <div className="space-y-1.5">
              <Shimmer className="h-7 w-14" />
              <Shimmer className="h-3 w-16" />
            </div>
            <div className="flex-1 min-w-[60px]">
              <Shimmer className="h-1 w-full rounded-full" />
              <div className="mt-1 flex justify-center">
                <Shimmer className="h-3 w-20 rounded-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Shimmer className="h-7 w-14" />
              <Shimmer className="h-3 w-16" />
            </div>
          </div>
          {/* Amenities row */}
          <div className="mt-3 flex items-center gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Shimmer key={i} className="h-6 w-16 rounded-md" />
            ))}
            <Shimmer className="ml-auto h-3 w-24" />
          </div>
          {/* Availability bar */}
          <div className="mt-3">
            <Shimmer className="h-1.5 w-full rounded-full" />
          </div>
        </div>

        {/* Price + CTA */}
        <div className="shrink-0 p-3 md:p-4 border-t md:border-t-0 md:border-l bg-linear-to-br from-blue-50/80 to-blue-50/80 md:w-52 space-y-2 md:text-right">
          <Shimmer className="h-3 w-8 ml-auto" />
          <Shimmer className="h-3 w-16 ml-auto" />
          <Shimmer className="h-8 w-28 ml-auto" />
          <Shimmer className="h-9 w-full rounded-lg mt-2" />
          <Shimmer className="h-3 w-20 ml-auto" />
        </div>
      </div>
    </Card>
  )
})

/* ─── Booking Dialog Skeleton — multi-step dialog placeholder ─── */
export const BookingDialogSkeleton = memo(function BookingDialogSkeleton() {
  return (
    <div className="max-w-3xl w-[95vw] max-h-[92vh] flex flex-col">
      {/* Header with stepper */}
      <div className="px-5 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50 space-y-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-5 w-5 rounded" />
          <Shimmer className="h-5 w-44" />
        </div>
        <Shimmer className="h-3 w-56" />
        {/* Stepper row */}
        <div className="flex items-center gap-2 mt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <Shimmer className="h-7 w-7 rounded-full" />
              <Shimmer className="h-3 w-16" />
              {i < 2 && <Shimmer className="h-px flex-1 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Trip summary bar */}
      <div className="px-5 py-2.5 bg-slate-50 border-b flex items-center gap-3">
        <Shimmer className="h-4 w-4 rounded" />
        <Shimmer className="h-3 w-32" />
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-20" />
        <div className="ml-auto flex gap-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <Shimmer key={i} className="h-5 w-12 rounded" />
          ))}
        </div>
      </div>

      {/* Body — passenger form */}
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Shimmer className="h-4 w-48" />
            <Shimmer className="h-3 w-36" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-8 w-32 rounded-md" />
            <Shimmer className="h-8 w-32 rounded-md" />
          </div>
        </div>

        {/* Passenger rows */}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Shimmer className="h-5 w-28 rounded-full" />
              <Shimmer className="h-3 w-12" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Shimmer className="h-10 w-full rounded-md" />
              <Shimmer className="h-10 w-full rounded-md" />
              <Shimmer className="h-10 w-full rounded-md" />
            </div>
            <Shimmer className="h-10 w-full rounded-md" />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t p-4 flex justify-between items-center">
        <div className="space-y-1.5">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-6 w-32" />
        </div>
        <Shimmer className="h-10 w-40 rounded-lg" />
      </div>
    </div>
  )
})

/* ─── Map View Skeleton — for route map / live tracking ─── */
export const MapViewSkeleton = memo(function MapViewSkeleton() {
  return (
    <div className="relative w-full h-[400px] rounded-xl overflow-hidden border bg-slate-100">
      {/* Map background — gradient resembling a map */}
      <div className="absolute inset-0 bg-linear-to-br from-blue-50 via-blue-50 to-amber-50" />
      {/* Fake roads grid */}
      <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="oklch(0.4 0.05 250)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Center route placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3/4 h-32 space-y-2">
          <Shimmer className="h-2 w-full rounded-full" />
          <div className="flex justify-between items-center mt-4">
            <div className="flex flex-col items-center gap-2">
              <Shimmer className="h-10 w-10 rounded-full" />
              <Shimmer className="h-3 w-20" />
            </div>
            <Shimmer className="h-1 flex-1 mx-3 rounded-full" />
            <div className="flex flex-col items-center gap-2">
              <Shimmer className="h-10 w-10 rounded-full" />
              <Shimmer className="h-3 w-20" />
            </div>
          </div>
        </div>
      </div>

      {/* Top overlay bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 bg-white/80 backdrop-blur rounded-lg p-2">
        <Shimmer className="h-4 w-4 rounded" />
        <Shimmer className="h-4 w-32" />
        <Shimmer className="ml-auto h-4 w-20" />
      </div>

      {/* Bottom sheet placeholder */}
      <div className="absolute bottom-3 left-3 right-3 bg-white/80 backdrop-blur rounded-lg p-3 flex items-center gap-3">
        <Shimmer className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-3 w-24" />
        </div>
        <Shimmer className="h-8 w-20 rounded-md" />
      </div>
    </div>
  )
})
/* ─── Admin System Metrics Skeleton ───
 * Mirrors the /admin/system "Server Metrics" section's loaded layout:
 * the 3-card CPU / Memory / This Process row, the full-width Disks
 * card (two volume rows) and the Host footer's 4-column field grid.
 * Shown while the first metrics snapshot loads — a structure-matched
 * skeleton, never a data table.
 */
export const SystemMetricsSkeleton = memo(function SystemMetricsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden data-testid="system-metrics-skeleton">
      {/* CPU / Memory / This Process card row */}
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card py-6">
            <div className="space-y-3 px-6">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-3 w-36" />
              <Shimmer className="h-8 w-28" />
              <Shimmer className="h-2 w-full rounded-full" />
              <Shimmer className="h-2 w-2/3 rounded-full" style={{ opacity: 1 - i * 0.12 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Disks card */}
      <div className="space-y-3 rounded-xl border bg-card px-6 py-6">
        <Shimmer className="h-4 w-20" />
        {[0, 1].map((i) => (
          <div key={i} className="space-y-1.5">
            <Shimmer className="h-4 w-56" style={{ opacity: 1 - i * 0.15 }} />
            <Shimmer className="h-2 w-full rounded-full" style={{ opacity: 1 - i * 0.15 }} />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.15 }} />
          </div>
        ))}
      </div>

      {/* Host footer card */}
      <div className="rounded-xl border bg-card px-6 py-6">
        <Shimmer className="mb-3 h-4 w-16" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Shimmer className="h-3 w-16" />
              <Shimmer className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})

/* ─── Admin System Status Skeleton ───
 * Mirrors the /admin/system "System Status" card row (Uptime /
 * WebSocket / Database). Shown while the first status snapshot loads.
 */
export const SystemStatusSkeleton = memo(function SystemStatusSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden data-testid="system-status-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card py-6">
          <div className="space-y-3 px-6">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="h-7 w-36" />
            <Shimmer className="h-2 w-full rounded-full" />
            <Shimmer className="h-3.5 w-full" style={{ opacity: 1 - i * 0.12 }} />
            <Shimmer className="h-3.5 w-2/3" style={{ opacity: 1 - i * 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ═══════════════════════════════════════════════════════════════════
 * Admin panel loading skeletons — every admin page's data-loading
 * state renders one of these STRUCTURE-MATCHED placeholders (shapes
 * mirror the loaded layout of the panel it replaces), never a data
 * table with skeleton fillers and never plain zero-value cards.
 * None of them use shadows — admin surfaces stay flat (border only).
 * ═══════════════════════════════════════════════════════════════════ */

/* ─── Admin Stats Cards Skeleton — KPI / stat card row ───
 * Mirrors the stats rows on the reviews / payments / chat panels:
 * a responsive card grid where each card = icon + label, big value,
 * optional sub-line. Used while the stats query loads so no zero
 * values flash.
 */
export const AdminStatsCardsSkeleton = memo(function AdminStatsCardsSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div
      className={count <= 3 ? 'grid gap-4 md:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}
      aria-hidden
      data-testid="admin-stats-skeleton"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card py-6">
          <div className="space-y-3 px-6">
            <div className="flex items-center gap-2">
              <Shimmer className="h-3.5 w-3.5 rounded" />
              <Shimmer className="h-3.5 w-24" />
            </div>
            <Shimmer className="h-8 w-24" />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Cron Job Cards Skeleton — job card grid ───
 * Mirrors a cron JobCard: title + code chip row, schedule subline,
 * action buttons + switch, and the two "next run / last run" boxes.
 */
export const CronJobCardsSkeleton = memo(function CronJobCardsSkeleton({
  count = 3,
}: {
  count?: number
}) {
  return (
    <div className="grid gap-3" aria-hidden data-testid="cron-jobs-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          {/* Title row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-4 w-20 rounded" />
              </div>
              <Shimmer className="h-3 w-48" />
            </div>
            <div className="flex items-center gap-2">
              <Shimmer className="h-8 w-24 rounded-md" />
              <Shimmer className="h-8 w-24 rounded-md" />
              <Shimmer className="h-5 w-9 rounded-full" />
            </div>
          </div>
          {/* Next / last run boxes */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[0, 1].map((j) => (
              <div key={j} className="rounded-lg border p-3 space-y-1.5">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-4 w-36" style={{ opacity: 1 - i * 0.15 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Run History Skeleton — history card rows ───
 * Mirrors the "Lịch sử chạy" card: header title + 5 compact rows
 * (status dot + job code + duration + timestamp), not a data table.
 */
export const RunHistorySkeleton = memo(function RunHistorySkeleton({
  rows = 5,
}: {
  rows?: number
}) {
  return (
    <div className="p-4 space-y-2.5" aria-hidden data-testid="run-history-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Shimmer className="h-2.5 w-2.5 rounded-full" />
          <Shimmer className="h-4 w-28" />
          <Shimmer className="h-4 w-20 hidden sm:block" />
          <div className="flex-1" />
          <Shimmer className="h-4 w-16" />
          <Shimmer className="h-4 w-24" style={{ opacity: 1 - i * 0.12 }} />
        </div>
      ))}
    </div>
  )
})

/* ─── Admin Schedule Cards Skeleton ───
 * Mirrors the schedules page card: a two-column body (left = time +
 * stops + amenities chips; right = price block + status + actions)
 * on a bordered card surface.
 */
export const AdminScheduleCardsSkeleton = memo(function AdminScheduleCardsSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="grid gap-3" aria-hidden data-testid="admin-schedules-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
            {/* Left: trip info */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Shimmer className="h-8 w-16 rounded-lg" />
                <Shimmer className="h-4 w-40" />
              </div>
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-56" />
                <Shimmer className="h-3 w-44" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Shimmer key={j} className="h-5 w-16 rounded-md" />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            {/* Right: price + actions */}
            <div className="p-4 border-t lg:border-t-0 lg:border-l space-y-2.5">
              <div className="flex items-center justify-between">
                <Shimmer className="h-7 w-24" />
                <Shimmer className="h-5 w-16 rounded-full" />
              </div>
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-32" />
                <Shimmer className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Shimmer className="h-8 w-24 rounded-md" />
                <Shimmer className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Ticket Detail Skeleton — admin booking dialog ───
 * Mirrors the ticket detail dialog body: the dashed status-management
 * card (title + action button row), then passenger info rows, then
 * the trip summary block.
 */
export const TicketDetailSkeleton = memo(function TicketDetailSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-hidden data-testid="ticket-detail-skeleton">
      {/* Status management card */}
      <div className="rounded-xl border border-dashed bg-slate-50/50 p-3 space-y-2.5">
        <Shimmer className="h-3 w-28" />
        <div className="flex flex-wrap gap-1.5">
          <Shimmer className="h-8 w-24 rounded-md" />
          <Shimmer className="h-8 w-24 rounded-md" />
          <Shimmer className="h-8 w-24 rounded-md" />
        </div>
      </div>
      {/* Passenger info */}
      <div className="rounded-xl border p-4 space-y-3">
        <Shimmer className="h-4 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Shimmer className="h-3.5 w-24" />
            <Shimmer className="h-3.5 w-40" style={{ opacity: 1 - i * 0.15 }} />
          </div>
        ))}
      </div>
      {/* Trip summary */}
      <div className="rounded-xl border p-4 space-y-3">
        <Shimmer className="h-4 w-24" />
        <div className="flex items-center gap-3">
          <Shimmer className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-4 w-44" />
            <Shimmer className="h-3 w-32" />
          </div>
          <Shimmer className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center justify-between">
          <Shimmer className="h-3 w-28" />
          <Shimmer className="h-3 w-20" />
        </div>
      </div>
    </div>
  )
})

/* ─── Brand List Skeleton — brand management rows ───
 * Mirrors the brand list rows: colored logo square + name/badges +
 * rating/route-count meta line + the two edit/delete icon buttons.
 */
export const BrandListSkeleton = memo(function BrandListSkeleton({
  count = 5,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="brand-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 p-3">
          <Shimmer className="h-9 w-9 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-3.5 w-10 rounded" />
            </div>
            <Shimmer className="h-3 w-36" style={{ opacity: 1 - i * 0.12 }} />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Shimmer className="h-6 w-6 rounded" />
            <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Route List Skeleton — route management rows ───
 * Mirrors the route list rows: route name + city meta line + the
 * schedule count chip + edit/delete icon buttons.
 */
export const RouteListSkeleton = memo(function RouteListSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="route-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 p-3">
          <Shimmer className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-4 w-32" />
              <Shimmer className="h-4 w-14 rounded-full" />
            </div>
            <Shimmer className="h-3 w-44" style={{ opacity: 1 - i * 0.15 }} />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Shimmer className="h-6 w-6 rounded" />
            <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Schedule Mini Skeleton — compact schedule rows ───
 * Mirrors the compact schedule rows in the brands detail panel:
 * departure time + bus chip + days line + price line + icon buttons.
 */
export const ScheduleMiniSkeleton = memo(function ScheduleMiniSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="space-y-2" aria-hidden data-testid="schedule-mini-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Shimmer className="h-5 w-14" />
                <Shimmer className="h-4 w-20 rounded" />
              </div>
              <Shimmer className="h-3 w-32" />
              <Shimmer className="h-3 w-40" style={{ opacity: 1 - i * 0.15 }} />
              <div className="flex items-center gap-3">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Shimmer className="h-6 w-6 rounded" />
              <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Pickup Points Skeleton — compact pickup rows ───
 * Mirrors the pickup point rows: name line + time/meta line + icon
 * buttons.
 */
export const PickupPointsSkeleton = memo(function PickupPointsSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="space-y-1.5" aria-hidden data-testid="pickup-points-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5 flex items-start gap-2">
          <Shimmer className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-3.5 w-36" />
            <Shimmer className="h-3 w-24" style={{ opacity: 1 - i * 0.15 }} />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Shimmer className="h-6 w-6 rounded" />
            <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Chat Channel List Skeleton ───
 * Mirrors the chat queue rows: avatar + display name/subtitle lines +
 * unread badge + timestamp.
 */
export const ChatChannelListSkeleton = memo(function ChatChannelListSkeleton({
  count = 6,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="chat-channels-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Shimmer className="h-10 w-10 rounded-full shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-3 w-44" style={{ opacity: 1 - i * 0.12 }} />
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Shimmer className="h-3 w-10" />
            <Shimmer className="h-4 w-5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Trip Results Skeleton — chat ticket picker search results ───
 * Mirrors the trip search result rows: brand + route line + meta
 * line + right-aligned price block.
 */
export const TripResultsSkeleton = memo(function TripResultsSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div className="space-y-2" aria-hidden data-testid="trip-results-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-2 w-2 rounded-full" />
              <Shimmer className="h-3.5 w-24" />
            </div>
            <Shimmer className="h-4 w-40" />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.15 }} />
          </div>
          <div className="text-right space-y-1 shrink-0">
            <Shimmer className="h-4 w-16 ml-auto" />
            <Shimmer className="h-2.5 w-10 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  )
})

/* ─── Seat Map Skeleton — ticket picker seat grid ───
 * Mirrors the seat selection step: a grid of seat squares + the
 * boarding/dropping selects + the price footer.
 */
export const SeatMapSkeleton = memo(function SeatMapSkeleton() {
  return (
    <div className="space-y-4" aria-hidden data-testid="seat-map-skeleton">
      {/* Seat grid */}
      <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <Shimmer
            key={i}
            className="h-10 w-full rounded-md"
            style={{ opacity: 1 - (i % 8) * 0.1 }}
          />
        ))}
      </div>
      {/* Boarding / dropping selects */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Shimmer className="h-9 w-full rounded-md" />
        <Shimmer className="h-9 w-full rounded-md" />
      </div>
      {/* Price footer */}
      <div className="flex items-center justify-between">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-6 w-20" />
      </div>
    </div>
  )
})
