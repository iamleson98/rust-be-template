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
import { memo, useState } from 'react'
import { Download } from 'lucide-react'
import { statsOptions } from '@/api'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { Segmented } from '@/components/console/segmented'
import { Button } from '@/components/ui/button'
import { AdminDashboardSkeleton } from '@/features/admin/dashboard/dashboard-skeleton'
import { useBookingsCsvExport } from '@/features/admin/tickets/api'
import { useT } from '@/lib/i18n'
import { AwaitingTicketsCard } from './awaiting-tickets-card'
import { StatsOverview } from './stats-overview'
import type { DateRange } from './types'

export const AdminDashboard = memo(function AdminDashboard() {
  const t = useT()
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const statsQuery = useQuery(statsOptions())
  const csvExport = useBookingsCsvExport({ range: dateRange })

  if (statsQuery.isLoading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <ConsolePage>
      <PageHeader
        title={t('adminDash.overviewTitle')}
        actions={
          <>
            <Segmented
              label={t('adminDash.dateRangeLabel')}
              value={dateRange}
              onChange={setDateRange}
              options={[
                { value: '7d', label: t('adminDash.range7d') },
                { value: '30d', label: t('adminDash.range30d') },
                { value: '90d', label: t('adminDash.range90d') },
              ]}
            />
            <Button variant="outline" size="sm" className="h-9" onClick={csvExport.exportCsv}>
              <Download className="size-4" />
              {t('adminDash.exportCsv')}
            </Button>
          </>
        }
      />

      <AwaitingTicketsCard />

      <StatsOverview dateRange={dateRange} />
    </ConsolePage>
  )
})
