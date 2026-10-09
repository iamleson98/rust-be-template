'use client'

/**
 * AdminDashboard — the `/admin` overview: a real-data summary report.
 *
 * Design rule (product decision 2026-09): the dashboard is a SUMMARY
 * REPORT only. Every number on this page comes from a live backend
 * endpoint — no client-side predictions, no mock series, and no
 * duplicated management panels (each management surface lives on its
 * own dedicated route):
 *
 *   - `useQuery(statsOptions())`                     → `/api/stats`            (brands, routes, trips)
 *   - `useAdminBookingStats(filter)`   → `/api/admin/bookings/stats` (totals + byDay)
 *   - `useAdminBookings({ limit: 5 })` → `/api/admin/bookings`   (5 most-recent bookings)
 *   - `useQuery(campaignsOptions())`                 → `/api/campaigns`        (live campaigns)
 *
 * What was intentionally REMOVED in the 2026-09 redesign:
 *   - the "revenue forecast" card (a client-side linear regression —
 *     a prediction, not backend data),
 *   - the booking-volume sparkline + segmentation donut (duplicates of
 *     the revenue bar chart and the booking-status donut),
 *   - the four inline tabs (Tickets / Brands CRUD / Chat / Campaigns)
 *     — replaced by the quick-links strip below; those panels are the
 *     dedicated `/admin/tickets`, `/admin/brands`, `/admin/chat` pages.
 */

import { useQuery } from '@tanstack/react-query'
import { statsOptions } from '@/api'
import { memo, useState } from 'react'
import { useBookingsCsvExport } from '@/features/admin/tickets/api'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { CalendarRange, Download } from 'lucide-react'
import { AdminDashboardSkeleton } from '@/features/admin/dashboard/dashboard-skeleton'
import type { DateRange } from './types'
import { StatsOverview } from './stats-overview'
import { AwaitingTicketsCard } from './awaiting-tickets-card'
import { ButtonGroup } from '@/components/ui/button-group'

export const AdminDashboard = memo(function AdminDashboard() {
  const t = useT()
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const statsQuery = useQuery(statsOptions())
  const csvExport = useBookingsCsvExport()

  if (statsQuery.isLoading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* ─── Header: title + date range + actions ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{t('adminDash.overviewTitle')}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Date range selector */}
          <ButtonGroup>
            <Button variant="outline" size="icon" aria-label={t('adminDash.dateRangeLabel')}>
              <CalendarRange />
            </Button>
            {[
              { key: '7d' as DateRange, label: t('adminDash.range7d') },
              { key: '30d' as DateRange, label: t('adminDash.range30d') },
              { key: '90d' as DateRange, label: t('adminDash.range90d') },
            ].map((opt) => (
              <Button key={opt.key} variant="outline" onClick={() => setDateRange(opt.key)}>
                {opt.label}
              </Button>
            ))}
          </ButtonGroup>
          <Button variant="outline" onClick={csvExport.exportCsv}>
            <Download className="h-4 w-4" />
            {t('adminDash.exportCsv')}
          </Button>
        </div>
      </div>

      <AwaitingTicketsCard />

      <StatsOverview dateRange={dateRange} onExportCSV={csvExport.exportCsv} />
    </div>
  )
})
