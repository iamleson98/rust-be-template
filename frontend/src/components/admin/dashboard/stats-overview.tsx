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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  DollarSign,
  Bus,
  Ticket,
  Route as RouteIcon,
  Activity,
  MapPin,
  Download,
  LineChart as LineChartIcon,
  BarChart3,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import { formatVND, formatNum } from '@/lib/types'
import {
  useStats,
  useAdminBookingStats,
  useAdminBookings,
  type AdminBookingFilter,
} from '@/lib/queries'
import type { AdminBookingOut, AdminBookingDayBucket, AdminBookingTotals } from '@/lib/api/types.gen'
import type { DateRange } from './types'
import { simpleLinearForecast } from './helpers'
import { ForecastChart, BookingTrendsSparkline } from './charts'
import { KpiCard, BookingStatusBadge, SegmentationDonut, type DonutSegment } from './badges'

// Map dashboard UI date-range preset → admin bookings filter `range` value
function rangeToApi(range: DateRange): string {
  if (range === '7d') return '7d'
  if (range === '30d') return '30d'
  return '90d'
}

function formatVNDShort(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ₫`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} triệu₫`
  return new Intl.NumberFormat('vi-VN').format(n) + '₫'
}

function formatVNDMillions(n: number | null | undefined): string {
  if (n == null) return '0'
  return (n / 1_000_000).toFixed(1)
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
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-blue-500 via-blue-500 to-blue-500" />
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <LineChartIcon className="h-4 w-4 text-blue-600" />
                  Dự báo doanh thu 7 ngày tới
                </CardTitle>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-4 rounded-full bg-blue-600" />
                    Thực tế
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-0 w-4 border-t-2 border-dashed border-blue-400" />
                    Dự báo
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {forecast.actualSeries.length > 0 ? (
                <ForecastChart
                  actual={forecast.actualSeries.map((v) => v / 1_000_000)}
                  forecast={forecast.forecast.map((v) => v / 1_000_000)}
                  lower={forecast.lower.map((v) => v / 1_000_000)}
                  upper={forecast.upper.map((v) => v / 1_000_000)}
                  actualLabels={forecast.actualLabels}
                />
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu doanh thu trong kỳ đã chọn
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
                <div>
                  <div className="text-muted-foreground">Dự báo tuần tới</div>
                  <div className="text-base font-bold text-blue-700 mt-0.5">
                    {formatVNDShort(forecast.forecast.reduce((a, b) => a + b * 1_000_000, 0))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Xu hướng</div>
                  <div
                    className={`flex items-center gap-1 font-bold mt-0.5 ${
                      (forecast.forecast[forecast.forecast.length - 1] ?? 0) >=
                      (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0)
                        ? 'text-blue-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {(forecast.forecast[forecast.forecast.length - 1] ?? 0) >=
                    (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0) ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    {forecast.actualSeries.length > 0
                      ? Math.abs(
                          ((forecast.forecast[forecast.forecast.length - 1] ?? 0) -
                            (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0)) /
                            Math.max(1, forecast.actualSeries[forecast.actualSeries.length - 1] ?? 1) *
                            100,
                        ).toFixed(1)
                      : '0.0'}
                    %
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Booking-volume sparkline (real byDay count) */}
        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-amber-600" />
                Lượt đặt vé theo ngày
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {bookingVolumeSeries.length > 0 ? (
                <BookingTrendsSparkline values={bookingVolumeSeries} peakIdx={peakIdx >= 0 ? peakIdx : 0} />
              ) : (
                <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu lượt đặt vé
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg bg-amber-50 p-2">
                  <div className="text-base font-bold text-amber-700">
                    {bookingVolumeSeries.reduce((a, b) => a + b, 0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Tổng {dateRange === '7d' ? '7 ngày' : dateRange === '30d' ? '30 ngày' : '90 ngày'}</div>
                </div>
                <div className="rounded-lg bg-rose-50 p-2">
                  <div className="text-base font-bold text-rose-700">
                    {peakIdx >= 0 ? bookingVolumeSeries[peakIdx] : 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">Cao điểm</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-base font-bold">
                    {bookingVolumeSeries.length > 0
                      ? Math.round(bookingVolumeSeries.reduce((a, b) => a + b, 0) / bookingVolumeSeries.length)
                      : 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">TB/ngày</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Row 1: Revenue Bar Chart + Booking-status Donut (real byDay + totals) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <div className="lg:col-span-3">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden">
            <div className="h-1 bg-linear-to-r from-blue-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                Doanh thu {dateRange === '7d' ? '7 ngày' : dateRange === '30d' ? '30 ngày' : '90 ngày'} gần nhất
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {aggregatedRevenue.length > 0 ? (
                <div className="flex items-end gap-1 sm:gap-2 h-48 mt-2">
                  {aggregatedRevenue.map((b, i) => {
                    const heightPct = (b.value / maxBarValue) * 100
                    const isHover = hoveredBar === i
                    return (
                      <div
                        key={i}
                        className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                        onMouseEnter={() => setHoveredBar(i)}
                        onMouseLeave={() => setHoveredBar(null)}
                      >
                        <div className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground truncate">
                          {formatVNDMillions(b.value)}M
                        </div>
                        <div className="w-full relative" style={{ height: '120px' }}>
                          <div
                            className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-linear-to-t cursor-pointer group transition-all ${
                              isHover
                                ? 'from-blue-500 to-blue-300 scale-[1.03]'
                                : 'from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300'
                            }`}
                            style={{ height: `${heightPct}%` }}
                          >
                            <div
                              className={`absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded transition-opacity ${
                                isHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                              }`}
                            >
                              {formatVNDShort(b.value)}
                            </div>
                          </div>
                        </div>
                        <div className="text-[9px] sm:text-[11px] font-medium text-muted-foreground truncate w-full text-center">
                          {b.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu doanh thu trong kỳ đã chọn
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">Tổng kỳ</div>
                <div className="text-sm font-bold text-blue-700">{formatVNDShort(totalRangeRevenue)}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="h-4 w-4 text-amber-600" />
                Phân bổ trạng thái vé
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {statusSegments.length > 0 ? (
                <>
                  <div className="flex items-center justify-center my-4">
                    <div className="relative h-36 w-36">
                      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                        {(() => {
                          let cumulative = 0
                          return statusSegments.map((s, i) => {
                            const pct = statusSegmentTotal > 0 ? (s.count / statusSegmentTotal) * 100 : 0
                            const dashArray = `${pct} ${100 - pct}`
                            const offset = -cumulative
                            cumulative += pct
                            return (
                              <circle
                                key={i}
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke={s.color}
                                strokeWidth="4"
                                strokeDasharray={dashArray}
                                strokeDashoffset={offset}
                                className="transition-all duration-500 hover:stroke-width-[5]"
                                style={{ strokeLinecap: 'butt' }}
                              />
                            )
                          })
                        })()}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-2xl font-extrabold">{formatNum(statusSegmentTotal)}</div>
                        <div className="text-[10px] text-muted-foreground">Tổng vé</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {statusSegments.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                        <span className="text-muted-foreground truncate">{s.label}</span>
                        <span className="font-bold ml-auto">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu trạng thái vé
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Booking-status SegmentationDonut (real totals) + Recent Bookings ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-violet-500 via-amber-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="h-4 w-4 text-violet-600" />
                Phân loại vé theo trạng thái
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {statusSegments.length > 0 ? (
                <>
                  <SegmentationDonut segments={statusSegments} total={statusSegmentTotal} />
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {statusSegments.map((s) => {
                      const pct = statusSegmentTotal > 0 ? ((s.count / statusSegmentTotal) * 100).toFixed(1) : '0.0'
                      return (
                        <div key={s.label} className="rounded-lg border p-2.5 transition-shadow">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold truncate">{s.label}</div>
                            <div className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                          </div>
                          <div className="flex items-end justify-between mt-1">
                            <div className="text-base font-bold">{formatNum(s.count)}</div>
                            <div className="text-[11px] font-medium" style={{ color: s.color }}>{pct}%</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu phân loại vé
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Bookings table (real /api/admin/bookings?limit=5) */}
        <div className="lg:col-span-3">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-blue-500 to-blue-500" />
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Ticket className="h-4 w-4 text-blue-600" />
                  Vé đặt gần đây
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onExportCSV}
                  className="gap-1.5 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  Xuất CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left font-semibold p-3">Mã vé</th>
                      <th className="text-left font-semibold p-3">Hành khách</th>
                      <th className="text-left font-semibold p-3 hidden md:table-cell">Tuyến</th>
                      <th className="text-right font-semibold p-3">Giá</th>
                      <th className="text-center font-semibold p-3">Trạng thái</th>
                      <th className="text-right font-semibold p-3 hidden sm:table-cell">Thời gian</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentBookings.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-xs text-muted-foreground">
                          Chưa có vé đặt nào
                        </td>
                      </tr>
                    ) : (
                      recentBookings.slice(0, 5).map((b) => {
                        const routeLabel = [b.pickupName, b.dropoffName].filter(Boolean).join(' → ')
                        return (
                          <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-3">
                              <code className="font-mono font-bold text-blue-700 text-xs">{b.code}</code>
                            </td>
                            <td className="p-3 font-medium">{b.contactName ?? '—'}</td>
                            <td className="p-3 text-muted-foreground hidden md:table-cell">
                              {routeLabel ? (
                                <div className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-blue-500 shrink-0" />
                                  {routeLabel}
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="p-3 text-right font-semibold">{formatVND(b.total)}</td>
                            <td className="p-3 text-center">
                              <BookingStatusBadge status={b.status} />
                            </td>
                            <td className="p-3 text-right text-muted-foreground text-xs hidden sm:table-cell">
                              {b.createdAt ? new Date(b.createdAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
