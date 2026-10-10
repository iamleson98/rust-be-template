'use client'

/**
 * StatsOverview — the summary-report body of the AdminDashboard.
 *
 * All numbers and charts are driven by REAL backend data only — no
 * mock arrays, no hardcoded revenue series, no client-side forecasts.
 *
 * Data sources (TanStack Query hooks from `@/lib/queries`):
 *   - `useQuery(statsOptions())`                       → `/api/stats` (public)
 *       { brands, routes, trips } — KPI cards row
 *   - `useAdminBookingStats(filter)`     → `/api/admin/bookings/stats`
 *       { totals: { total, confirmed, pending, cancelled, completed, revenue },
 *         byDay: [{ date, count, revenue, confirmed, pending, cancelled, completed }] }
 *       → KPI cards (revenue, total bookings) + revenue bar chart
 *         + booking-status donut
 *   - `useAdminBookings({ limit: 5 })`   → `/api/admin/bookings`
 *       → "Recent bookings" table (5 most-recent rows by created_at desc)
 *
 * The "date range" picker (7d / 30d / 90d) maps to the admin bookings
 * stats filter `range` parameter, so the totals + byDay series match the
 * selected period.
 */

import { useQuery } from '@tanstack/react-query'
import { statsOptions } from '@/api'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DollarSign, Bus, Ticket, Route as RouteIcon, Activity } from 'lucide-react'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import {
  rangeDays,
  useAdminBookingStats,
  useAdminBookings,
  type AdminBookingFilter,
} from '@/features/admin/tickets/api'
import type { BookingOut, AdminBookingDayBucket, AdminBookingTotals } from '@/api'
import type { DateRange } from './types'
import {
  formatVNDShort,
  percentChange,
  periodDays,
  previousPeriod,
  dayBars,
  type Period,
} from './helpers'
import { StatGrid, StatTile } from '@/components/console/stat-tile'
import type { DonutSegment } from './segmentation-donut'
import { RevenueBarChartCard } from './revenue-bar-chart-card'
import { BookingStatusDonutCard } from './booking-status-donut-card'
import { RecentBookingsCard } from './recent-bookings-card'
import { CampaignsSummaryCard } from './campaigns-summary-card'

/** Stable empty default — keeps useMemo deps referentially stable when data is not loaded yet. */
const EMPTY_ITEMS: never[] = []

const BOOKING_STATUS_COLORS: Record<string, string> = {
  confirmed: '#2563eb',
  pending: '#f59e0b',
  cancelled: '#f43f5e',
  completed: '#16a34a',
}

// Map booking-status slug → i18n key (labels resolved via t() at render)
const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: 'adminDash.statusConfirmed',
  pending: 'adminDash.statusPending',
  cancelled: 'adminDash.statusCancelled',
  completed: 'adminDash.statusCompleted',
}

export function StatsOverview({ dateRange }: { dateRange: DateRange }) {
  const t = useT()
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)

  // Public stats (brands, routes, trips)
  const { data: rawStats, isError: statsErr, refetch: refetchStats } = useQuery(statsOptions())

  // This period and the one before it (same length), for the revenue trend.
  const period = useMemo(() => rangeDays({ range: dateRange }) as Period, [dateRange])
  const filter: AdminBookingFilter = useMemo(
    () => ({ range: dateRange, status: 'all', sort: 'created_desc', limit: 5, offset: 0 }),
    [dateRange],
  )
  const previous = useMemo(
    () => ({ range: 'custom', status: 'all', ...previousPeriod(period) }),
    [period],
  )
  const { data: bookingStats } = useAdminBookingStats(filter)
  const { data: previousStats } = useAdminBookingStats(previous)
  const totals: AdminBookingTotals | undefined = bookingStats?.totals
  const byDay: AdminBookingDayBucket[] = bookingStats?.byDay ?? EMPTY_ITEMS
  const revenueDelta =
    totals && previousStats ? percentChange(totals.revenue, previousStats.totals.revenue) : null

  // Recent bookings table (5 latest)
  const { data: recentBookingsResp } = useAdminBookings(filter)
  const recentBookings: BookingOut[] = recentBookingsResp?.items ?? []

  // Revenue per day over the WHOLE period (quiet days are 0), at most 10 bars.
  const aggregatedRevenue = useMemo(() => {
    const revenueByDay = new Map(byDay.map((b) => [b.date, b.revenue ?? 0]))
    const weekdays = [
      t('adminDash.weekday.sun'),
      t('adminDash.weekday.mon'),
      t('adminDash.weekday.tue'),
      t('adminDash.weekday.wed'),
      t('adminDash.weekday.thu'),
      t('adminDash.weekday.fri'),
      t('adminDash.weekday.sat'),
    ]
    const label =
      dateRange === '7d'
        ? (day: string) => weekdays[new Date(`${day}T00:00:00`).getDay()]
        : (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
    return dayBars(periodDays(period), revenueByDay, 10, label)
  }, [byDay, dateRange, period, t])

  const totalRangeRevenue = totals?.revenue ?? 0
  const maxBarValue = aggregatedRevenue.length
    ? Math.max(...aggregatedRevenue.map((b) => b.value))
    : 1

  // Booking-status donut segments — from real `totals`
  const statusSegments: DonutSegment[] = useMemo(() => {
    if (!totals) return []
    return (['confirmed', 'pending', 'cancelled', 'completed'] as const)
      .map((k) => ({
        label: BOOKING_STATUS_LABELS[k] ? t(BOOKING_STATUS_LABELS[k]) : k,
        count: (totals as Record<string, number>)[k] ?? 0,
        color: BOOKING_STATUS_COLORS[k] ?? '#94a3b8',
      }))
      .filter((s) => s.count > 0)
  }, [totals, t])
  const statusSegmentTotal = statusSegments.reduce((a, b) => a + b.count, 0)

  return (
    <>
      {/* Error banner with retry — only if /api/stats failed AND we have no cached data */}
      {statsErr && !rawStats && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span>{t('adminDash.statsLoadError')}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchStats()}
            className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            {t('payment.retry')}
          </Button>
        </div>
      )}

      {/* ─── KPI tiles (real backend numbers) ─── */}
      <StatGrid>
        <StatTile
          icon={<DollarSign />}
          tone="green"
          label={t('adminDash.revenue')}
          value={totals ? formatVNDShort(totals.revenue) : '—'}
          trend={{ delta: revenueDelta, label: t('adminDash.vsPreviousPeriod') }}
        />
        <StatTile
          icon={<Ticket />}
          tone="blue"
          label={t('admin.ticketsSold')}
          value={totals ? formatNum(totals.total) : '—'}
          hint={totals && t('adminDash.confirmedCount', { count: formatNum(totals.confirmed) })}
        />
        <StatTile
          icon={<Bus />}
          tone="violet"
          label={t('adminDash.tripsRunning')}
          value={rawStats ? formatNum(rawStats.trips) : '—'}
          hint={t('adminDash.currentlyActive')}
        />
        <StatTile
          icon={<RouteIcon />}
          tone="sky"
          label={t('adminDash.routesPerBrand')}
          value={rawStats ? `${formatNum(rawStats.routes)} / ${formatNum(rawStats.brands)}` : '—'}
          hint={t('adminDash.tracking')}
        />
      </StatGrid>

      {/* ─── Row 1: Revenue Bar Chart + Booking-status Donut (real byDay + totals) ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RevenueBarChartCard
            aggregatedRevenue={aggregatedRevenue}
            maxBarValue={maxBarValue}
            hoveredBar={hoveredBar}
            setHoveredBar={setHoveredBar}
            totalRangeRevenue={totalRangeRevenue}
            dateRange={dateRange}
          />
        </div>
        <div className="lg:col-span-2">
          <BookingStatusDonutCard
            statusSegments={statusSegments}
            statusSegmentTotal={statusSegmentTotal}
          />
        </div>
      </div>

      {/* ─── Row 2: Recent Bookings + live Campaigns (both real) ─── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <RecentBookingsCard recentBookings={recentBookings} />
        </div>
        <div className="lg:col-span-2">
          <CampaignsSummaryCard />
        </div>
      </div>
    </>
  )
}
