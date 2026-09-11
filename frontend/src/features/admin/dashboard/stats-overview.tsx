'use client'

/**
 * StatsOverview — the "above the tabs" section of the AdminDashboard.
 *
 * All numbers and charts are driven by REAL backend data only — no mock
 * arrays, no hardcoded revenue series, no fake VIP customers.
 *
 * Data sources (TanStack Query hooks from `@/lib/queries`):
 *   - `useStats()`                       → `/api/stats` (public)
 *       { brands, routes, trips } — KPI cards row
 *   - `useAdminBookingStats(filter)`     → `/api/admin/bookings/stats`
 *       { totals: { total, confirmed, pending, cancelled, completed, revenue },
 *         byDay: [{ date, count, revenue, confirmed, pending, cancelled, completed }] }
 *       → KPI cards (revenue, total bookings) + revenue bar chart + forecast
 *         + booking-status donut + booking-volume sparkline
 *   - `useAdminBookings({ limit: 5 })`   → `/api/admin/bookings`
 *       → "Recent bookings" table (5 most-recent rows by created_at desc)
 *
 * The "date range" picker (7d / 30d / 90d) maps to the admin bookings
 * stats filter `range` parameter, so the totals + byDay series match the
 * selected period.
 */

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DollarSign,
  Bus,
  Ticket,
  Route as RouteIcon,
  Activity,
} from 'lucide-react'
import { formatNum } from '@/lib/types'
import {
  useStats,
  useAdminBookingStats,
  useAdminBookings,
  type AdminBookingFilter,
} from '@/lib/queries'
import type { AdminBookingOut, AdminBookingDayBucket, AdminBookingTotals } from '@/lib/api/types.gen'
import type { DateRange } from './types'
import { simpleLinearForecast, formatVNDShort } from './helpers'
import { KpiCard } from './kpi-card'
import type { DonutSegment } from './segmentation-donut'
import { RevenueForecastCard } from './revenue-forecast-card'
import { BookingVolumeCard } from './booking-volume-card'
import { RevenueBarChartCard } from './revenue-bar-chart-card'
import { BookingStatusDonutCard } from './booking-status-donut-card'
import { BookingSegmentationCard } from './booking-segmentation-card'
import { RecentBookingsCard } from './recent-bookings-card'

// Map dashboard UI date-range preset → admin bookings filter `range` value
function rangeToApi(range: DateRange): string {
  if (range === '7d') return '7d'
  if (range === '30d') return '30d'
  return '90d'
}

const BOOKING_STATUS_COLORS: Record<string, string> = {
  confirmed: '#2563eb',
  pending: '#f59e0b',
  cancelled: '#f43f5e',
  completed: '#16a34a',
}

const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: 'Đã xác nhận',
  pending: 'Chờ xử lý',
  cancelled: 'Đã huỷ',
  completed: 'Hoàn thành',
}

export function StatsOverview({
  dateRange,
  onExportCSV,
}: {
  dateRange: DateRange
  onExportCSV: () => void
}) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)

  // Public stats (brands, routes, trips)
  const { data: rawStats, isError: statsErr, refetch: refetchStats } = useStats()

  // Admin booking stats — drives revenue + booking-volume charts + donut
  const filter: AdminBookingFilter = useMemo(
    () => ({ range: rangeToApi(dateRange), status: 'all', sort: 'created_desc', limit: 5, offset: 0 }),
    [dateRange],
  )
  const { data: bookingStats } = useAdminBookingStats(filter)
  const totals: AdminBookingTotals | undefined = bookingStats?.totals
  const byDay: AdminBookingDayBucket[] = bookingStats?.byDay ?? []

  // Recent bookings table (5 latest)
  const { data: recentBookingsResp } = useAdminBookings(filter)
  const recentBookings: AdminBookingOut[] = recentBookingsResp?.items ?? []

  // Revenue series (in VND) — derived from real byDay buckets
  const revenueSeries = useMemo(() => byDay.map((b) => b.revenue ?? 0), [byDay])
  const bookingVolumeSeries = useMemo(() => byDay.map((b) => b.count ?? 0), [byDay])

  // Bar chart data — bucket into ~10 max so 30d/90d remain readable
  const aggregatedRevenue = useMemo<{ label: string; value: number; date?: string }[]>(() => {
    if (byDay.length === 0) return []
    if (dateRange === '7d') {
      // Show every day with weekday labels
      return byDay.map((b) => {
        const d = new Date(b.date)
        const label = isNaN(d.getTime()) ? b.date : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'][((d.getDay() + 6) % 7)]
        return { label, value: b.revenue ?? 0, date: b.date }
      })
    }
    // 30d/90d → aggregate into 10 buckets averaged
    const buckets = 10
    const size = Math.max(1, Math.ceil(byDay.length / buckets))
    const out: { label: string; value: number; date?: string }[] = []
    for (let i = 0; i < byDay.length; i += size) {
      const slice = byDay.slice(i, i + size)
      const avgRevenue = slice.reduce((a, b) => a + (b.revenue ?? 0), 0) / slice.length
      out.push({
        label: `${i + 1}`,
        value: Number(avgRevenue.toFixed(0)),
        date: slice[0]?.date,
      })
    }
    return out
  }, [byDay, dateRange])

  // Forecast from the last 7 actual revenue values (real data)
  const forecast = useMemo(() => {
    const sample = revenueSeries.slice(-7)
    if (sample.length === 0) {
      return { forecast: [], lower: [], upper: [], actualSeries: [], actualLabels: [] }
    }
    const fc = simpleLinearForecast(sample, 7)
    const labels = sample.map((_, i) => `D${revenueSeries.length - sample.length + i + 1}`)
    return { ...fc, actualSeries: sample, actualLabels: labels }
  }, [revenueSeries])

  const totalRangeRevenue = useMemo(
    () => revenueSeries.reduce((a, b) => a + b, 0),
    [revenueSeries],
  )
  const maxBarValue = aggregatedRevenue.length
    ? Math.max(...aggregatedRevenue.map((b) => b.value))
    : 1
  const peakIdx = bookingVolumeSeries.length
    ? bookingVolumeSeries.indexOf(Math.max(...bookingVolumeSeries))
    : -1

  // Booking-status donut segments — from real `totals`
  const statusSegments: DonutSegment[] = useMemo(() => {
    if (!totals) return []
    return (['confirmed', 'pending', 'cancelled', 'completed'] as const)
      .map((k) => ({
        label: BOOKING_STATUS_LABELS[k] ?? k,
        count: (totals as Record<string, number>)[k] ?? 0,
        color: BOOKING_STATUS_COLORS[k] ?? '#94a3b8',
      }))
      .filter((s) => s.count > 0)
  }, [totals])
  const statusSegmentTotal = statusSegments.reduce((a, b) => a + b.count, 0)

  // Live "current vs prev" trend — we don't have a `previous period` field
  // from the backend, so we compare the last bucket vs the previous one
  // (real byDay series, no mock).
  const lastVsPrev = useMemo(() => {
    if (revenueSeries.length < 2) return null
    const last = revenueSeries[revenueSeries.length - 1] ?? 0
    const prev = revenueSeries[revenueSeries.length - 2] ?? 0
    const delta = prev === 0 ? null : ((last - prev) / prev) * 100
    return { last, prev, delta }
  }, [revenueSeries])

  return (
    <>
      {/* Error banner with retry — only if /api/stats failed AND we have no cached data */}
      {statsErr && !rawStats && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span>Không tải được số liệu thống kê. Vui lòng thử lại.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchStats()}
            className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            Thử lại
          </Button>
        </div>
      )}

      {/* ─── KPI Cards (real backend numbers) ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Doanh thu"
          value={totals ? formatVNDShort(totals.revenue) : '—'}
          change={lastVsPrev?.delta == null ? '—' : `${Math.abs(lastVsPrev.delta).toFixed(1)}%`}
          up={(lastVsPrev?.delta ?? 0) >= 0}
          color="#16a34a"
          gradient="from-emerald-500/10 to-emerald-600/5"
          delay={0}
        />
        <KpiCard
          icon={<Ticket className="h-5 w-5" />}
          label="Vé đã bán"
          value={totals ? formatNum(totals.total) : '—'}
          change={totals ? `${formatNum(totals.confirmed)} đã xác nhận` : '—'}
          up
          color="#2563eb"
          gradient="from-blue-500/10 to-blue-600/5"
          delay={0.05}
        />
        <KpiCard
          icon={<Bus className="h-5 w-5" />}
          label="Chuyến chạy"
          value={rawStats ? formatNum(rawStats.trips) : '—'}
          change="Hiện hoạt động"
          up
          color="#7c3aed"
          gradient="from-violet-500/10 to-violet-600/5"
          delay={0.1}
        />
        <KpiCard
          icon={<RouteIcon className="h-5 w-5" />}
          label="Tuyến / Hãng"
          value={rawStats ? `${formatNum(rawStats.routes)} / ${formatNum(rawStats.brands)}` : '—'}
          change="Đang theo dõi"
          up
          color="#0ea5e9"
          gradient="from-sky-500/10 to-sky-600/5"
          delay={0.15}
        />
      </div>

      {/* ─── Row 0: Revenue Forecast + Booking Volume (real byDay data) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <div className="lg:col-span-3">
          <RevenueForecastCard forecast={forecast} />
        </div>
        <div className="lg:col-span-2">
          <BookingVolumeCard
            bookingVolumeSeries={bookingVolumeSeries}
            peakIdx={peakIdx}
            dateRange={dateRange}
          />
        </div>
      </div>

      {/* ─── Row 1: Revenue Bar Chart + Booking-status Donut (real byDay + totals) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
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

      {/* ─── Booking-status SegmentationDonut (real totals) + Recent Bookings ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <div className="lg:col-span-2">
          <BookingSegmentationCard
            statusSegments={statusSegments}
            statusSegmentTotal={statusSegmentTotal}
          />
        </div>
        <div className="lg:col-span-3">
          <RecentBookingsCard
            recentBookings={recentBookings}
            onExportCSV={onExportCSV}
          />
        </div>
      </div>
    </>
  )
}
