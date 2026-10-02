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
 *   - `useStats()`                     → `/api/stats`            (brands, routes, trips)
 *   - `useAdminBookingStats(filter)`   → `/api/admin/bookings/stats` (totals + byDay)
 *   - `useAdminBookings({ limit: 5 })` → `/api/admin/bookings`   (5 most-recent bookings)
 *   - `useCampaigns()`                 → `/api/campaigns`        (live campaigns)
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

import { memo, useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useStats, useAdminBookingExport } from '@/lib/queries'
import { useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import {
  LayoutDashboard,
  Eye,
  CalendarRange,
  Download,
  Building2,
  MessageSquare,
  MessageSquareWarning,
  Ticket,
  CreditCard,
  Activity,
  Users,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { AdminDashboardSkeleton } from '@/features/admin/dashboard/dashboard-skeleton'
import type { DateRange } from './types'
import { downloadCSV } from './helpers'
import { StatsOverview } from './stats-overview'
import { getErrorMessage } from '@/lib/error-message'

/** Quick-links to the dedicated management pages (mirrors the admin
 *  sidebar; Users is admin-only, matching the sidebar + backend perms). */
function QuickLinks() {
  const navigate = useNavigate()
  const t = useT()
  const links = [
    { title: t('admin.ticketsSold'), icon: Ticket, url: '/admin/tickets' as const },
    { title: t('admin.chatOnline'), icon: MessageSquare, url: '/admin/chat' as const },
    { title: t('admin.feedback'), icon: MessageSquareWarning, url: '/admin/feedback' as const },
    { title: t('admin.brands'), icon: Building2, url: '/admin/brands' as const },
    { title: t('admin.payments'), icon: CreditCard, url: '/admin/payments' as const },
    { title: t('admin.systemMonitoring'), icon: Activity, url: '/admin/system' as const },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {links.map((l) => {
        const Icon = l.icon
        return (
          <button
            key={l.url}
            type="button"
            onClick={() => navigate({ to: l.url })}
            className="group flex items-center gap-2 rounded-lg border bg-white p-2.5 text-left text-xs font-medium transition-all hover:border-blue-300 hover:bg-blue-50 dark:bg-card"
          >
            <Icon className="size-4 shrink-0 text-blue-600" aria-hidden />
            <span className="flex-1 truncate">{l.title}</span>
            <ChevronRight
              className="size-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
        )
      })}
    </div>
  )
}

export const AdminDashboard = memo(function AdminDashboard() {
  const navigate = useNavigate()
  const t = useT()
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const statsQuery = useStats()
  const exportQuery = useAdminBookingExport({})

  const handleExportCSV = useCallback(async () => {
    try {
      const result = await exportQuery.refetch()
      const data = result.data
      if (!data) throw new Error('Export failed')
      downloadCSV(data.filename, data.csv)
      toast.success(t('adminDash.exportCsvSuccess'), {
        description: t('adminDash.exportCsvSuccessDesc', {
          count: data.count,
          file: data.filename,
        }),
      })
    } catch (e) {
      toast.error(t('adminDash.exportCsvFailed'), {
        description: getErrorMessage(e, t('adminDash.pleaseRetry')),
      })
    }
  }, [exportQuery, t])

  if (statsQuery.isLoading) {
    return <AdminDashboardSkeleton />
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="space-y-3 p-3">
        {/* ─── Header: title + date range + actions ─── */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <LayoutDashboard className="h-3.5 w-3.5" />
              {t('admin.dashboard')}
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">
              {t('adminDash.overviewTitle')}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Date range selector */}
            <div
              className="inline-flex items-center rounded-lg border bg-white p-0.5"
              role="group"
              aria-label={t('adminDash.dateRangeLabel')}
            >
              <CalendarRange className="h-3.5 w-3.5 text-muted-foreground mx-2" />
              {[
                { key: '7d' as DateRange, label: t('adminDash.range7d') },
                { key: '30d' as DateRange, label: t('adminDash.range30d') },
                { key: '90d' as DateRange, label: t('adminDash.range90d') },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setDateRange(opt.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                    dateRange === opt.key
                      ? 'bg-blue-600 text-white '
                      : 'text-muted-foreground hover:text-blue-700 hover:bg-blue-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={handleExportCSV}
              className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
            >
              <Download className="h-4 w-4" />
              {t('adminDash.exportCsv')}
            </Button>
            <Button variant="outline" onClick={() => navigate({ to: '/' })} className="gap-2">
              <Eye className="h-4 w-4" />
              {t('adminDash.backToCustomerSite')}
            </Button>
          </div>
        </div>

        {/* ─── Summary report (all real backend data) ─── */}
        <StatsOverview dateRange={dateRange} onExportCSV={handleExportCSV} />

        {/* ─── Quick links → dedicated management pages ─── */}
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            {t('adminDash.quickLinksTitle')}
          </div>
          <QuickLinks />
        </div>
      </div>
    </div>
  )
})
