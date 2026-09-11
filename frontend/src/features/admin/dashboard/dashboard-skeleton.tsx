'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

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
