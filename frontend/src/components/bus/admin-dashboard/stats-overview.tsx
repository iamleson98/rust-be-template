'use client'

/**
 * StatsOverview — the "above the tabs" section of the AdminDashboard.
 *
 * Contains:
 *   - KPI cards row (revenue, tickets, customers, trips)
 *   - 7-day revenue forecast (line+area) + 24h booking trends sparkline
 *   - Revenue bar chart (7d/30d/90d) + booking-status donut
 *   - Customer segmentation donut + Top 5 VIP customers table
 *   - Recent bookings table (with CSV export shortcut)
 *   - Top routes bar list + live activity feed (auto-scroll)
 *
 * Migrated from receiving `stats` as a prop to fetching it directly via
 * the `useStats(dateRange)` TanStack Query hook. The hook is deduped
 * with the parent `<AdminDashboard />` (same queryKey `['stats', range]`),
 * so the skeleton gate in the parent stays in sync with the data here.
 * Mock data (revenue series, top routes, VIP customers, etc.) is still
 * used for the chart visualizations — only the KPI numbers come from
 * the live `/api/stats` response.
 */

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DollarSign,
  Users,
  Bus,
  Ticket,
  Route,
  Zap,
  Activity,
  MapPin,
  Download,
  LineChart as LineChartIcon,
  BarChart3,
  PieChart,
  Clock,
  Crown,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import { formatVND, formatNum } from '@/lib/types'
import { useStats } from '@/lib/queries'
import type { Stats, DateRange } from './types'
import {
  REVENUE_7_DAYS,
  REVENUE_30_DAYS,
  REVENUE_90_DAYS,
  DAY_LABELS,
  BOOKING_STATUS,
  RECENT_BOOKINGS,
  TOP_ROUTES,
  ACTIVITY_FEED,
  CUSTOMER_SEGMENTS,
  VIP_CUSTOMERS,
  BOOKINGS_PER_HOUR,
} from './mock-data'
import { simpleLinearForecast } from './helpers'
import { ForecastChart, BookingTrendsSparkline } from './charts'
import { KpiCard, BookingStatusBadge, ActivityIcon, SegmentationDonut } from './badges'

export function StatsOverview({
  dateRange,
  onExportCSV,
}: {
  dateRange: DateRange
  onExportCSV: () => void
}) {
  const [hoveredBar, setHoveredBar] = useState<number | null>(null)
  // `useStats` returns `unknown` (no explicit type param) — cast to `Stats`
  // since the backend `/api/stats` response matches the local `Stats` shape.
  const { data: rawStats, isError, refetch } = useStats(dateRange)
  const stats = rawStats as Stats | undefined

  // Compute the revenue series based on selected date range
  const revenueSeries = useMemo(() => {
    if (dateRange === '7d') return REVENUE_7_DAYS
    if (dateRange === '30d') return REVENUE_30_DAYS
    return REVENUE_90_DAYS
  }, [dateRange])

  // Aggregate into ~7-10 buckets so the bar chart remains readable for 30d/90d.
  const aggregatedRevenue = useMemo<{ label: string; value: number }[]>(() => {
    const n = revenueSeries.length
    if (dateRange === '7d') {
      return revenueSeries.map((v, i) => ({ label: DAY_LABELS[i] ?? `D${i + 1}`, value: v }))
    }
    // For 30d/90d, bucket into 10 segments and label by day index
    const buckets = 10
    const size = Math.ceil(n / buckets)
    const out: { label: string; value: number }[] = []
    for (let b = 0; b < buckets; b++) {
      const slice = revenueSeries.slice(b * size, (b + 1) * size)
      if (slice.length === 0) break
      const avg = slice.reduce((a, b) => a + b, 0) / slice.length
      out.push({ label: `${b * size + 1}`, value: Number(avg.toFixed(1)) })
    }
    return out
  }, [revenueSeries, dateRange])

  // Forecast based on last 7 actual values from the current series (more meaningful sample)
  const forecast = useMemo(() => {
    const sample = revenueSeries.slice(-7)
    const fc = simpleLinearForecast(sample, 7)
    // Use day-of-week labels for 7d; otherwise numeric labels for the last 7 entries
    const labels =
      dateRange === '7d'
        ? DAY_LABELS
        : Array.from({ length: 7 }, (_, i) => `D${revenueSeries.length - 7 + i + 1}`)
    return { ...fc, actualSeries: sample, actualLabels: labels }
  }, [revenueSeries, dateRange])

  const maxRevenue = Math.max(...REVENUE_7_DAYS)
  const maxRoute = Math.max(...TOP_ROUTES.map((r) => r.count))
  const totalRangeRevenue = useMemo(
    () => revenueSeries.reduce((a, b) => a + b, 0),
    [revenueSeries],
  )

  // Total customers & segment percentages
  const totalCustomers = CUSTOMER_SEGMENTS.reduce((s, c) => s + c.count, 0)
  const peakHourIdx = BOOKINGS_PER_HOUR.indexOf(Math.max(...BOOKINGS_PER_HOUR))

  return (
    <>
      {/* Error banner with retry — only rendered if /api/stats failed AND
          we have no cached data. KPI cards fall back to '—' on null stats. */}
      {isError && !stats && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            <span>Không tải được số liệu thống kê. Vui lòng thử lại.</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-100">
            Thử lại
          </Button>
        </div>
      )}

      {/* ─── Enhanced KPI Cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={<DollarSign className="h-5 w-5" />} label="Doanh thu" value={stats ? formatVND(stats.revenue) : '—'} change="+12.5%" up color="#16a34a" gradient="from-blue-500/10 to-blue-600/5" delay={0} />
        <KpiCard icon={<Ticket className="h-5 w-5" />} label="Vé đã bán" value={stats ? formatNum(stats.bookings) : '—'} change="+8.2%" up color="#2563eb" gradient="from-blue-500/10 to-blue-600/5" delay={0.05} />
        <KpiCard icon={<Users className="h-5 w-5" />} label="Khách hàng" value={stats ? formatNum(stats.happyCustomers) : '—'} change="+3.1%" up color="#7c3aed" gradient="from-violet-500/10 to-violet-600/5" delay={0.1} />
        <KpiCard icon={<Bus className="h-5 w-5" />} label="Chuyến chạy" value={stats ? formatNum(stats.trips) : '—'} change="-1.4%" color="#e11d48" gradient="from-rose-500/10 to-rose-600/5" delay={0.15} />
      </div>

      {/* ─── Row 0: Revenue Forecast + Booking Trends ─── */}
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
              <ForecastChart
                actual={forecast.actualSeries}
                forecast={forecast.forecast}
                lower={forecast.lower}
                upper={forecast.upper}
                actualLabels={forecast.actualLabels}
              />
              <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
                <div>
                  <div className="text-muted-foreground">Dự báo tuần tới</div>
                  <div className="text-base font-bold text-blue-700 mt-0.5">
                    {forecast.forecast.reduce((a, b) => a + b, 0).toFixed(1)} triệu VND
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Xu hướng</div>
                  <div className={`flex items-center gap-1 font-bold mt-0.5 ${forecast.forecast[forecast.forecast.length - 1] >= forecast.actualSeries[forecast.actualSeries.length - 1] ? 'text-blue-600' : 'text-rose-600'}`}>
                    {forecast.forecast[forecast.forecast.length - 1] >= forecast.actualSeries[forecast.actualSeries.length - 1] ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                    {Math.abs(((forecast.forecast[forecast.forecast.length - 1] - forecast.actualSeries[forecast.actualSeries.length - 1]) / Math.max(1, forecast.actualSeries[forecast.actualSeries.length - 1])) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Booking Trends mini chart */}
        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-amber-600" />
                Lượt đặt vé 24h qua
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <BookingTrendsSparkline values={BOOKINGS_PER_HOUR} peakIdx={peakHourIdx} />
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg bg-amber-50 p-2">
                  <div className="text-base font-bold text-amber-700">{BOOKINGS_PER_HOUR.reduce((a, b) => a + b, 0)}</div>
                  <div className="text-[10px] text-muted-foreground">Tổng 24h</div>
                </div>
                <div className="rounded-lg bg-rose-50 p-2">
                  <div className="text-base font-bold text-rose-700">{BOOKINGS_PER_HOUR[peakHourIdx]}</div>
                  <div className="text-[10px] text-muted-foreground">Cao điểm</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-base font-bold">{Math.round(BOOKINGS_PER_HOUR.reduce((a, b) => a + b, 0) / 24)}</div>
                  <div className="text-[10px] text-muted-foreground">TB/giờ</div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-center gap-1 text-xs text-amber-700">
                <Clock className="h-3.5 w-3.5" />
                Giờ cao điểm: <span className="font-bold">{peakHourIdx}h - {peakHourIdx + 1}h</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Analytics Row 1: Revenue Chart + Donut Chart ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        {/* Revenue Bar Chart */}
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
              <div className="flex items-end gap-1 sm:gap-2 h-48 mt-2">
                {aggregatedRevenue.map((b, i) => {
                  const heightPct = (b.value / Math.max(...aggregatedRevenue.map((x) => x.value))) * 100
                  const isHover = hoveredBar === i
                  return (
                    <div
                      key={i}
                      className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                      onMouseEnter={() => setHoveredBar(i)}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      <div className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground truncate">{b.value}M</div>
                      <div className="w-full relative" style={{ height: '120px' }}>
                        <div
                          className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-linear-to-t cursor-pointer group transition-all ${isHover ? 'from-blue-500 to-blue-300 scale-[1.03]' : 'from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300'}`}
                        >
                          <div className={`absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded transition-opacity ${isHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            {b.value} triệu VND
                          </div>
                        </div>
                      </div>
                      <div className="text-[9px] sm:text-[11px] font-medium text-muted-foreground truncate w-full text-center">{b.label}</div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">Tổng kỳ</div>
                <div className="text-sm font-bold text-blue-700">
                  {totalRangeRevenue.toFixed(1)} triệu VND
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Booking Status Donut */}
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
              <div className="flex items-center justify-center my-4">
                {/* CSS-only donut chart */}
                <div className="relative h-36 w-36">
                  <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                    {(() => {
                      let cumulative = 0
                      return BOOKING_STATUS.map((s, i) => {
                        const dashArray = `${s.pct} ${100 - s.pct}`
                        const offset = -cumulative
                        cumulative += s.pct
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
                    <div className="text-2xl font-extrabold">1,247</div>
                    <div className="text-[10px] text-muted-foreground">Tổng vé</div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {BOOKING_STATUS.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className="text-muted-foreground truncate">{s.label}</span>
                    <span className="font-bold ml-auto">{s.pct}%</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Row 2: Customer Segmentation + Top VIP ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-violet-500 via-amber-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-600" />
                Phân loại khách hàng
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <SegmentationDonut segments={CUSTOMER_SEGMENTS} total={totalCustomers} />
              <div className="grid grid-cols-2 gap-2 mt-4">
                {CUSTOMER_SEGMENTS.map((s) => {
                  const Icon = s.icon
                  const pct = ((s.count / totalCustomers) * 100).toFixed(1)
                  return (
                    <div key={s.key} className="rounded-lg border p-2.5 transition-shadow">
                      <div className="flex items-center gap-2 mb-1">
                        <div
                          className="h-7 w-7 rounded-md flex items-center justify-center shrink-0"
                          style={{ background: `${s.color}18`, color: s.color }}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold truncate">{s.label}</div>
                          <div className="text-[10px] text-muted-foreground">{s.desc}</div>
                        </div>
                      </div>
                      <div className="flex items-end justify-between">
                        <div className="text-base font-bold">{formatNum(s.count)}</div>
                        <div className="text-[11px] font-medium" style={{ color: s.color }}>{pct}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-yellow-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Crown className="h-4 w-4 text-amber-500" />
                Top 5 khách hàng VIP
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left font-semibold p-3">#</th>
                      <th className="text-left font-semibold p-3">Khách hàng</th>
                      <th className="text-left font-semibold p-3 hidden sm:table-cell">Điện thoại</th>
                      <th className="text-right font-semibold p-3">Số vé</th>
                      <th className="text-right font-semibold p-3 hidden md:table-cell">Tổng chi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {VIP_CUSTOMERS.map((c, i) => (
                      <tr
                        key={i}
                        className="hover:bg-amber-50/40 transition-colors"
                      >
                        <td className="p-3">
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${i === 0 ? 'bg-amber-500' : i === 1 ? 'bg-slate-400' : i === 2 ? 'bg-amber-700' : 'bg-slate-300 text-slate-700'}`}>
                            {i + 1}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="bg-amber-100 text-amber-700 text-xs font-bold">
                                {c.name.split(' ').slice(-1)[0][0]}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium">{c.name}</div>
                              <div className="text-[10px] text-muted-foreground sm:hidden">{c.phone}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3 hidden sm:table-cell font-mono text-xs text-muted-foreground">{c.phone}</td>
                        <td className="p-3 text-right font-semibold">{c.bookings}</td>
                        <td className="p-3 text-right hidden md:table-cell font-bold text-blue-700">{formatVND(c.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Analytics Row 3: Recent Bookings Table ─── */}
      <div className="mb-4">
        <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden">
          <div className="h-1 bg-linear-to-r from-blue-500 to-blue-500" />
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Ticket className="h-4 w-4 text-blue-600" />
                Vé đặt gần đây
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={onExportCSV} className="gap-1.5 text-blue-700 hover:bg-blue-50 hover:text-blue-800">
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
                  {RECENT_BOOKINGS.slice(0, 5).map((b) => (
                    <tr
                      key={b.code}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="p-3">
                        <code className="font-mono font-bold text-blue-700 text-xs">{b.code}</code>
                      </td>
                      <td className="p-3 font-medium">{b.name}</td>
                      <td className="p-3 text-muted-foreground hidden md:table-cell">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-blue-500 shrink-0" />
                          {b.route}
                        </div>
                      </td>
                      <td className="p-3 text-right font-semibold">{formatVND(b.price)}</td>
                      <td className="p-3 text-center">
                        <BookingStatusBadge status={b.status} />
                      </td>
                      <td className="p-3 text-right text-muted-foreground text-xs hidden sm:table-cell">{b.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ─── Analytics Row 4: Top Routes + Activity Feed ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
        {/* Top Routes */}
        <div className="lg:col-span-3">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-violet-500 to-purple-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Route className="h-4 w-4 text-violet-600" />
                Tuyến đường đặt nhiều nhất
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-3.5 mt-1">
                {TOP_ROUTES.map((r, i) => {
                  const pct = (r.count / maxRoute) * 100
                  return (
                    <div key={i} className="group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className={`h-6 w-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white ${i === 0 ? 'bg-violet-600' : i === 1 ? 'bg-violet-400' : 'bg-slate-300 text-slate-600'}`}>
                            {i + 1}
                          </div>
                          <span className="text-sm font-medium group-hover:text-blue-700 transition-colors">{r.route}</span>
                        </div>
                        <span className="text-sm font-bold text-muted-foreground">{r.count} vé</span>
                      </div>
                      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${i === 0 ? 'bg-linear-to-r from-violet-600 to-violet-400' : i === 1 ? 'bg-linear-to-r from-violet-400 to-violet-300' : 'bg-linear-to-r from-slate-400 to-slate-300'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Live Activity Feed */}
        <div className="lg:col-span-2">
          <Card className="shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-yellow-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-600" />
                Hoạt động trực tuyến
                <span className="ml-auto flex h-2 w-2">
                  <span className="absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="relative h-70 overflow-hidden">
                <div className="absolute inset-x-0 top-0 h-8 bg-linear-to-b from-white to-transparent z-10 pointer-events-none" />
                <div className="absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-white to-transparent z-10 pointer-events-none" />
                <div className="animate-scroll-up">
                  {[...ACTIVITY_FEED, ...ACTIVITY_FEED].map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5 py-2.5 px-1 border-b border-slate-100">
                      <div
                        className="h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                        style={{ background: `${a.color}18`, color: a.color }}
                      >
                        <ActivityIcon type={a.icon} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs leading-relaxed">{a.text}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">{Math.floor(Math.random() * 30 + 1)} phút trước</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}
