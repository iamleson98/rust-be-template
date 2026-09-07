'use client'

/**
 * TicketsPanel — the new "Vé đã bán" admin tab.
 *
 * Replaces the legacy mock-data "Recent bookings" table on the dashboard
 * overview. This panel is fully data-driven via TanStack Query hooks that
 * hit the Rust endpoints added in `backend-rust/src/routes/admin.rs`:
 *
 *   - `useAdminBookings(filter)`     — paginated list + inline stats
 *   - `useAdminBookingStats(filter)` — per-day + per-brand aggregates
 *   - `useAdminBookingExport({})`      — CSV export mutation
 *   - `useUpdateBookingStatus()`     — confirm / cancel / complete
 *   - `useAdminBookingDetail(id)`    — full detail (seats, trip, owner)
 *
 * Features:
 *   - KPI cards (total tickets, revenue, by-status breakdown)
 *   - Multi-axis filters: brand, status, route, date range, search
 *   - Sortable, paginated table with sticky header
 *   - Click row → detail dialog with seat list + status management
 *   - Export to CSV with current filter
 *   - Mobile-responsive (table → card list on small screens)
 */

import { useMemo, useState, useCallback, useEffect } from 'react'
import { createColumnHelper, type SortingState } from '@tanstack/react-table'
import {
  DataTable,
  DataTableColumnHeader,
  DataTableViewOptions,
  type DataTableFeatures,
} from '@/components/data-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TicketDetailSkeleton } from '@/components/layout/skeletons'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import {
  Ticket as TicketIcon,
  Search,
  Download,
  Filter,
  X,
  CalendarRange,
  DollarSign,
  CheckCircle2,
  Clock,
  Ban,
  TrendingUp,
  Bus,
  User,
  Phone,
  Mail,
  MapPin,
  RotateCcw,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  useAdminBookings,
  useAdminBookingDetail,
  useAdminBookingStats,
  useAdminBookingExport,
  useUpdateBookingStatus,
  useAdminBrands,
} from '@/lib/queries'
import type {
  AdminBookingFilter,
} from '@/lib/queries'
import type { AdminBookingOut } from '@/lib/api/types.gen'

import { BookingStatusBadge, KpiCard } from '@/components/admin/dashboard/badges'
import { downloadCSV } from '@/components/admin/dashboard/helpers'

// ── Constants ────────────────────────────────────────────────

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'Tất cả trạng thái', icon: <Filter className="h-3.5 w-3.5" /> },
  { value: 'confirmed', label: 'Đã xác nhận', icon: <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" /> },
  { value: 'pending', label: 'Chờ xử lý', icon: <Clock className="h-3.5 w-3.5 text-amber-600" /> },
  { value: 'completed', label: 'Hoàn thành', icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> },
  { value: 'cancelled', label: 'Đã huỷ', icon: <Ban className="h-3.5 w-3.5 text-rose-600" /> },
  { value: 'refunded', label: 'Hoàn tiền', icon: <RotateCcw className="h-3.5 w-3.5 text-slate-600" /> },
]

const RANGE_OPTIONS: { value: string; label: string }[] = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: '90d', label: '90 ngày' },
  { value: 'this_month', label: 'Tháng này' },
  { value: 'last_month', label: 'Tháng trước' },
  { value: 'custom', label: 'Tùy chỉnh' },
]

// ── Server-side sort mapping ─────────────────────────────────
// Only these columns are sortable — the API `sort` param drives the order,
// so column headers map to (and from) the same values as the old select.
const SORT_COLUMN_BY_API: Record<string, string> = {
  created: 'createdAt',
  total: 'total',
}
const SORT_API_BY_COLUMN: Record<string, { asc: string; desc: string }> = {
  createdAt: { asc: 'created_asc', desc: 'created_desc' },
  total: { asc: 'total_asc', desc: 'total_desc' },
}

const bookingColumnHelper = createColumnHelper<
  DataTableFeatures,
  AdminBookingOut
>()

// ── Helpers ──────────────────────────────────────────────────

function formatVND(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('vi-VN').format(n) + '₫'
}

function formatDepartureDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    // trip.departureDate is YYYY-MM-DD
    const d = parseISO(s)
    if (!isValid(d)) return s
    return format(d, 'dd/MM/yyyy', { locale: vi })
  } catch {
    return s
  }
}

function timeAgo(s: string | null | undefined): string {
  if (!s) return ''
  try {
    const d = parseISO(s)
    if (!isValid(d)) return ''
    const diffMin = differenceInCalendarDays(new Date(), d) * 24 * 60
    if (diffMin < 1) return 'vừa xong'
    if (diffMin < 60) return `${Math.floor(diffMin)} phút trước`
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} giờ trước`
    if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / 60 / 24)} ngày trước`
    return format(d, 'dd/MM/yyyy', { locale: vi })
  } catch {
    return ''
  }
}

// ── Main panel ───────────────────────────────────────────────

export function TicketsPanel() {
  const [filter, setFilter] = useState<AdminBookingFilter>({
    range: '30d',
    status: 'all',
    sort: 'created_desc',
    limit: PAGE_SIZE,
    offset: 0,
  })
  const [searchInput, setSearchInput] = useState('')
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null)
  const [showStats, setShowStats] = useState(false)

  // Listen for the `admin:view-ticket` custom event — dispatched by the
  // chat panel when the employee clicks "Xem chi tiết" on an inline ticket
  // card. Opens the booking detail dialog automatically.
  useEffect(() => {
    const handler = (e: Event) => {
      const code = (e as CustomEvent<string>).detail
      if (typeof code === 'string' && code.trim()) {
        setSelectedBookingId(code.trim())
      }
    }
    window.addEventListener('admin:view-ticket', handler as EventListener)
    return () => window.removeEventListener('admin:view-ticket', handler as EventListener)
  }, [])

  const bookingsQuery = useAdminBookings(filter)
  const statsQuery = useAdminBookingStats(filter)
  const brandsQuery = useAdminBrands()
  const exportMutation = useAdminBookingExport({})

  // Debounce search: commit to filter 400ms after the last keystroke.
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = useCallback(
    (v: string) => {
      setSearchInput(v)
      if (searchTimer) clearTimeout(searchTimer)
      const t = setTimeout(() => {
        setFilter((f) => ({ ...f, search: v.trim() || undefined, offset: 0 }))
      }, 400)
      setSearchTimer(t)
    },
    [searchTimer],
  )

  const setBrandFilter = useCallback((brandId: string) => {
    setFilter((f) => ({
      ...f,
      brandId: brandId === 'all' ? undefined : brandId,
      offset: 0,
    }))
  }, [])

  const setStatusFilter = useCallback((status: string) => {
    setFilter((f) => ({ ...f, status, offset: 0 }))
  }, [])

  const setRangeFilter = useCallback((range: string) => {
    setFilter((f) => ({ ...f, range, offset: 0 }))
  }, [])

  // ── Server-side sorting state (driven by the column headers) ──
  const sorting = useMemo(() => {
    const [key, dir] = (filter.sort ?? 'created_desc').split('_')
    return [{ id: SORT_COLUMN_BY_API[key] ?? 'createdAt', desc: dir !== 'asc' }]
  }, [filter.sort])

  const handleSortingChange = useCallback((next: SortingState) => {
    const first = next[0]
    if (!first) {
      setFilter((f) => ({ ...f, sort: 'created_desc', offset: 0 }))
      return
    }
    const map = SORT_API_BY_COLUMN[first.id]
    if (!map) return
    setFilter((f) => ({ ...f, sort: first.desc ? map.desc : map.asc, offset: 0 }))
  }, [])

  // Table columns — only `createdAt`/`total` are sortable (server-backed);
  // cell closures use stable setters so the defs stay memoised.
  const columns = useMemo(
    () =>
      bookingColumnHelper.columns([
        bookingColumnHelper.accessor('code', {
          header: 'Mã vé',
          cell: ({ getValue }) => (
            <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400">
              {getValue()}
            </span>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { label: 'Mã vé' },
        }),
        bookingColumnHelper.accessor('contactName', {
          header: 'Hành khách',
          cell: ({ row }) => (
            <div>
              <div className="text-xs font-medium">{row.original.contactName ?? '—'}</div>
              <div className="text-[10px] text-muted-foreground">
                {row.original.contactPhone ?? ''}
              </div>
            </div>
          ),
          enableSorting: false,
          meta: { label: 'Hành khách', cellClassName: 'hidden md:table-cell' },
        }),
        bookingColumnHelper.display({
          id: 'route',
          header: 'Tuyến',
          cell: ({ row }) => (
            <div className="text-xs">
              {row.original.pickupName ?? '—'} → {row.original.dropoffName ?? '—'}
            </div>
          ),
          meta: { label: 'Tuyến', cellClassName: 'hidden xl:table-cell' },
        }),
        bookingColumnHelper.accessor('createdAt', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Ngày đặt" />
          ),
          cell: ({ getValue }) => (
            <span className="text-xs text-muted-foreground" title={getValue()}>
              {timeAgo(getValue())}
            </span>
          ),
          meta: { label: 'Ngày đặt' },
        }),
        bookingColumnHelper.accessor('total', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Tổng tiền" />
          ),
          cell: ({ getValue }) => (
            <div className="text-xs font-semibold tabular-nums">{formatVND(getValue())}</div>
          ),
          meta: { label: 'Tổng tiền', align: 'right' },
        }),
        bookingColumnHelper.accessor('status', {
          header: 'Trạng thái',
          cell: ({ getValue }) => <BookingStatusBadge status={getValue()} />,
          enableSorting: false,
          meta: { label: 'Trạng thái' },
        }),
      ]),
    [],
  )

  const setDateRange = useCallback((from: string, to: string) => {
    setFilter((f) => ({
      ...f,
      range: 'custom',
      dateFrom: from || undefined,
      dateTo: to || undefined,
      offset: 0,
    }))
  }, [])

  const resetFilters = useCallback(() => {
    setFilter({
      range: '30d',
      status: 'all',
      sort: 'created_desc',
      limit: PAGE_SIZE,
      offset: 0,
    })
    setSearchInput('')
  }, [])

  const handleExport = useCallback(async () => {
    try {
      const result = await exportMutation.refetch()
      const data = result.data
      if (!data) throw new Error('Export failed')
      downloadCSV(data.filename, data.csv)
      toast.success('Xuất CSV thành công', {
        description: `Đã xuất ${data.count} vé ra file ${data.filename}`,
      })
    } catch (e: any) {
      toast.error('Xuất CSV thất bại', {
        description: e?.message ?? 'Vui lòng thử lại',
      })
    }
  }, [exportMutation, filter])

  // KPI totals — come from the dedicated /stats endpoint
  // (`AdminBookingStatsResponse.totals`), not from the list response.
  const totals = statsQuery.data?.totals
  const total = bookingsQuery.data?.total ?? 0
  const offset = filter.offset ?? 0
  const activeFilterCount = useMemo(() => {
    let n = 0
    if (filter.brandId) n++
    if (filter.status && filter.status !== 'all') n++
    if (filter.search) n++
    if (filter.range && filter.range !== '30d') n++
    if (filter.sort && filter.sort !== 'created_desc') n++
    return n
  }, [filter])

  return (
    <div className="space-y-4 p-3">
      {/* ─── KPI cards row ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard
          icon={<TicketIcon className="h-5 w-5" />}
          label="Tổng vé"
          value={totals ? String(totals.total) : '—'}
          change=""
          up
          color="#2563eb"
          gradient="from-blue-500/10 to-blue-600/5"
          delay={0}
        />
        <KpiCard
          icon={<DollarSign className="h-5 w-5" />}
          label="Doanh thu"
          value={totals ? formatVND(totals.revenue) : '—'}
          change=""
          up
          color="#16a34a"
          gradient="from-emerald-500/10 to-emerald-600/5"
          delay={0.05}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="Đã xác nhận"
          value={totals ? String(totals.confirmed) : '—'}
          change=""
          up
          color="#0ea5e9"
          gradient="from-sky-500/10 to-sky-600/5"
          delay={0.1}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Hoàn thành"
          value={totals ? String(totals.completed) : '—'}
          change=""
          up
          color="#10b981"
          gradient="from-emerald-500/10 to-emerald-600/5"
          delay={0.15}
        />
        <KpiCard
          icon={<Ban className="h-5 w-5" />}
          label="Đã huỷ"
          value={totals ? String(totals.cancelled) : '—'}
          change=""
          color="#f43f5e"
          gradient="from-rose-500/10 to-rose-600/5"
          delay={0.2}
        />
      </div>

      {/* ─── Filter bar ─── */}
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3">
            {/* Row 1: search + range + sort */}
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <div className="relative flex-1 min-w-50">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchInput}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Tìm theo mã vé, tên khách, SĐT…"
                  className="pl-8 h-9"
                />
              </div>

              <Select value={filter.range} onValueChange={setRangeFilter}>
                <SelectTrigger className="h-9 w-full sm:w-35">
                  <CalendarRange className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => setShowStats((v) => !v)}
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Biểu đồ</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
                  onClick={handleExport}
                  disabled={exportMutation.isPending}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {exportMutation.isPending ? 'Đang xuất…' : 'Xuất CSV'}
                  </span>
                </Button>
              </div>
            </div>

            {/* Row 2: brand + status + custom date range + reset */}
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:flex-wrap">
              <Select
                value={filter.brandId ?? 'all'}
                onValueChange={setBrandFilter}
              >
                <SelectTrigger className="h-9 w-full sm:w-45">
                  <Bus className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue placeholder="Tất cả hãng xe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tất cả hãng xe</SelectItem>
                  {brandsQuery.data?.items?.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-2 w-2 rounded-full"
                          style={{ background: b.accentColor ?? '#64748b' }}
                        />
                        {b.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filter.status ?? 'all'} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 w-full sm:w-40">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="flex items-center gap-2">
                        {o.icon}
                        {o.label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filter.range === 'custom' && (
                <CustomDateRange
                  dateFrom={filter.dateFrom}
                  dateTo={filter.dateTo}
                  onChange={setDateRange}
                />
              )}

              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5 text-muted-foreground ml-auto"
                  onClick={resetFilters}
                >
                  <X className="h-3.5 w-3.5" />
                  Xoá bộ lọc ({activeFilterCount})
                </Button>
              )}
            </div>

            {/* Active filter chips */}
            {activeFilterCount > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                {filter.brandId && (
                  <FilterChip
                    label={`Hãng: ${brandsQuery.data?.items?.find((b) => b.id === filter.brandId)?.name ?? filter.brandId}`}
                    onClear={() => setBrandFilter('all')}
                  />
                )}
                {filter.status && filter.status !== 'all' && (
                  <FilterChip
                    label={`Trạng thái: ${STATUS_OPTIONS.find((o) => o.value === filter.status)?.label ?? filter.status}`}
                    onClear={() => setStatusFilter('all')}
                  />
                )}
                {filter.search && (
                  <FilterChip
                    label={`Tìm: "${filter.search}"`}
                    onClear={() => {
                      setSearchInput('')
                      setFilter((f) => ({ ...f, search: undefined, offset: 0 }))
                    }}
                  />
                )}
                {filter.range && filter.range !== '30d' && (
                  <FilterChip
                    label={`Khoảng: ${RANGE_OPTIONS.find((o) => o.value === filter.range)?.label ?? filter.range}`}
                    onClear={() => setRangeFilter('30d')}
                  />
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Optional stats drawer ─── */}
      {showStats && statsQuery.data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              Phân tích theo ngày
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Per-day mini chart */}
            <div>
              <div className="text-xs text-muted-foreground mb-2">Số vé theo ngày</div>
              <div className="h-32 flex items-end gap-0.5">
                {statsQuery.data.byDay.slice(-30).map((d) => {
                  const max = Math.max(...statsQuery.data!.byDay.map((x) => x.count), 1)
                  const h = (d.count / max) * 100
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}: ${d.count} vé, ${formatVND(d.revenue)}`}
                      className="flex-1 min-w-1.5 rounded-t bg-blue-400 hover:bg-blue-600 transition-colors"
                      style={{ height: `${Math.max(2, h)}%` }}
                    />
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Error banner ─── */}
      {bookingsQuery.isError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>Không tải được danh sách vé. Vui lòng thử lại.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => bookingsQuery.refetch()}
            className="h-7 text-xs border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Thử lại
          </Button>
        </div>
      )}

      {/* ─── Bookings table (desktop) / cards (mobile) ───
           The DataTable renders its own bordered surface; the header
           row above it carries the title + refresh action. */}
      <div className="flex items-center justify-between gap-2 pb-2">
        <h2 className="text-base font-semibold flex items-center gap-2">
          <TicketIcon className="h-4 w-4 text-blue-600" />
          Danh sách vé đã bán
          <Badge variant="secondary" className="text-[10px]">
            {total} vé
          </Badge>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => bookingsQuery.refetch()}
          disabled={bookingsQuery.isFetching}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${bookingsQuery.isFetching ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
      </div>
      <DataTable
            columns={columns}
            data={bookingsQuery.data?.items ?? []}
            rowNoun="vé"
            manualPagination
            totalRowCount={total}
            pageIndex={Math.floor(offset / PAGE_SIZE)}
            onPageIndexChange={(next) =>
              setFilter((f) => ({ ...f, offset: next * PAGE_SIZE }))
            }
            pageSize={PAGE_SIZE}
            manualSorting
            sorting={sorting}
            onSortingChange={handleSortingChange}
            isLoading={bookingsQuery.isLoading}
            isError={bookingsQuery.isError}
            onRetry={() => bookingsQuery.refetch()}
            onRowClick={(b) => setSelectedBookingId(b.id)}
            rowAriaLabel={(b) => `Xem chi tiết vé ${b.code}`}
            rowClassName="card-hover-lift"
            emptyTitle="Chưa có vé nào"
            emptyDescription="Thử thay đổi bộ lọc hoặc mở rộng khoảng thời gian."
            emptyIcon={<TicketIcon className="h-5 w-5" aria-hidden />}
            toolbar={(table) => (
              <div className="flex items-center justify-end border-b bg-muted/20 px-4 py-2">
                <DataTableViewOptions table={table} className="ml-auto h-8" />
              </div>
            )}
            mobileList={
              <div className="divide-y">
                {(bookingsQuery.data?.items ?? []).map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBookingId(b.id)}
                    className="w-full p-3 text-left hover:bg-slate-50 transition-colors dark:hover:bg-accent/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400">
                            {b.code}
                          </span>
                          <BookingStatusBadge status={b.status} />
                        </div>
                        <div className="text-xs font-medium mt-1 truncate">
                          {b.contactName ?? '—'} · {b.contactPhone ?? ''}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {b.pickupName ?? '—'} → {b.dropoffName ?? '—'}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-xs">{formatVND(b.total)}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            }
          />

      {/* ─── Detail dialog ─── */}
      <BookingDetailDialog
        bookingId={selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />
    </div>
  )
}

// ── FilterChip ───────────────────────────────────────────────

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700 border border-blue-200">
      {label}
      <button
        onClick={onClear}
        className="ml-0.5 rounded-full hover:bg-blue-100 p-0.5"
        aria-label="Xoá bộ lọc"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}

// ── CustomDateRange ──────────────────────────────────────────

function CustomDateRange({
  dateFrom,
  dateTo,
  onChange,
}: {
  dateFrom?: string
  dateTo?: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const from = dateFrom ? parseISO(dateFrom) : undefined
  const to = dateTo ? parseISO(dateTo) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <CalendarRange className="h-3.5 w-3.5" />
          <span className="text-xs">
            {dateFrom || dateTo
              ? `${dateFrom ?? '…'} → ${dateTo ?? '…'}`
              : 'Chọn ngày'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={{ from, to }}
          onSelect={(range) => {
            const f = range?.from ? format(range.from, 'yyyy-MM-dd') : ''
            const t = range?.to ? format(range.to, 'yyyy-MM-dd') : ''
            onChange(f, t)
            if (f && t) setOpen(false)
          }}
          numberOfMonths={2}
          locale={vi}
        />
      </PopoverContent>
    </Popover>
  )
}

// ── BookingDetailDialog ─────────────────────────────────────

function BookingDetailDialog({
  bookingId,
  onClose,
}: {
  bookingId: string | null
  onClose: () => void
}) {
  const { data, isLoading, isError, refetch } = useAdminBookingDetail(bookingId ?? undefined)
  const updateStatus = useUpdateBookingStatus()
  const [reason, setReason] = useState('')
  const [force, setForce] = useState(false)

  const booking = data?.item

  const handleStatusChange = useCallback(
    async (status: 'confirmed' | 'cancelled' | 'completed' | 'refunded') => {
      if (!booking) return
      try {
        await updateStatus.mutateAsync({
          path: { id: booking.id },
          body: {
            status,
            reason: reason.trim() || undefined,
            force,
          },
        })
        toast.success('Đã cập nhật trạng thái', {
          description: `Vé ${booking.code}: ${statusLabel(status)}`,
        })
        setReason('')
        setForce(false)
      } catch (e: any) {
        toast.error('Không thể cập nhật trạng thái', {
          description: e?.message ?? 'Vui lòng thử lại',
        })
      }
    },
    [booking, updateStatus, reason, force],
  )

  return (
    <Dialog open={!!bookingId} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-blue-600" />
            {booking ? `Vé ${booking.code}` : 'Chi tiết vé'}
            {booking && <BookingStatusBadge status={booking.status} />}
          </DialogTitle>
          <DialogDescription>
            Thông tin chi tiết vé, hành khách, chuyến đi và quản lý trạng thái.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <TicketDetailSkeleton />
        ) : isError ? (
          <div className="p-4 text-center">
            <AlertCircle className="h-8 w-8 text-rose-400 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Không tải được chi tiết vé.</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetch()}
            >
              Thử lại
            </Button>
          </div>
        ) : booking ? (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-4">
              {/* Status management block */}
              <Card className="bg-slate-50/50 border-dashed">
                <CardContent className="p-3 space-y-2.5">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Quản lý trạng thái
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant={booking.status === 'confirmed' ? 'default' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('confirmed')}
                      disabled={updateStatus.isPending || booking.status === 'confirmed'}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Xác nhận
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'completed' ? 'default' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('completed')}
                      disabled={updateStatus.isPending || booking.status === 'completed'}
                    >
                      <TrendingUp className="h-3.5 w-3.5" />
                      Hoàn thành
                    </Button>
                    <Button
                      size="sm"
                      variant={booking.status === 'cancelled' ? 'destructive' : 'outline'}
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('cancelled')}
                      disabled={updateStatus.isPending || booking.status === 'cancelled'}
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Huỷ vé
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5"
                      onClick={() => handleStatusChange('refunded')}
                      disabled={
                        updateStatus.isPending ||
                        booking.status === 'refunded'
                      }
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Hoàn tiền
                    </Button>
                  </div>
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Ghi chú / lý do (tuỳ chọn)…"
                    className="text-xs min-h-10 resize-none"
                  />
                  <div className="flex items-center gap-2 text-[11px]">
                    <Switch checked={force} onCheckedChange={setForce} id="force" />
                    <Label htmlFor="force" className="cursor-pointer text-muted-foreground">
                      Bật chế độ ghi đè (admin override) — cho phép chuyển trạng thái bất kỳ
                    </Label>
                  </div>
                </CardContent>
              </Card>

              {/* Contact info */}
              <Section title="Thông tin hành khách" icon={<User className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label="Họ tên" value={booking.contactName} />
                  <InfoField label="SĐT" value={booking.contactPhone} icon={<Phone className="h-3 w-3" />} />
                  <InfoField label="Email" value={booking.contactEmail} icon={<Mail className="h-3 w-3" />} />
                  <InfoField
                    label="Phương thức thanh toán"
                    value={booking.paymentMethod ?? '—'}
                  />
                </div>
                {booking.contactName && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground bg-blue-50/50 rounded-md px-2 py-1.5">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[9px] bg-blue-100 text-blue-700">
                        {booking.contactName?.[0] ?? 'U'}
                      </AvatarFallback>
                    </Avatar>
                    Tài khoản: <span className="font-medium text-blue-700">{booking.contactName}</span>
                    {booking.contactPhone && <span>· {booking.contactPhone}</span>}
                  </div>
                )}
              </Section>

              <Section title="Thông tin chuyến đi" icon={<Bus className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField
                    label="Tuyến"
                    value={`${booking.pickupName ?? '—'} → ${booking.dropoffName ?? '—'}`}
                  />
                  <InfoField
                    label="Hãng xe"
                    value={booking.contactName ?? '—'}
                  />
                  <InfoField
                    label="Ngày đi"
                    value={formatDepartureDate(booking.createdAt)}
                  />
                  <InfoField
                    label="Loại xe"
                    value={booking.paymentMethod ?? '—'}
                  />
                </div>
              </Section>

              {/* Seats + passengers */}
              <Section title="Ghế & hành khách" icon={<TicketIcon className="h-4 w-4" />}>
                <div className="space-y-1.5">
                  {booking.seats.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-xs rounded-md bg-slate-50 px-2.5 py-1.5"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {s.seatId ?? '—'}
                        </Badge>
                        <span className="font-medium">{s.passengerName ?? '—'}</span>
                        {s.passengerType && (
                          <Badge variant="secondary" className="text-[9px]">
                            {s.passengerType === 'adult' ? 'Người lớn' : s.passengerType === 'child' ? 'Trẻ em' : s.passengerType}
                          </Badge>
                        )}
                      </div>
                      <span className="font-semibold">{formatVND(s.price)}</span>
                    </div>
                  ))}
                </div>
              </Section>

              {/* Pickup / dropoff + total */}
              <Section title="Điểm đón / trả & tổng tiền" icon={<MapPin className="h-4 w-4" />}>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <InfoField label="Điểm đón" value={booking.pickupName} />
                  <InfoField label="Điểm trả" value={booking.dropoffName} />
                </div>
                <div className="mt-2 flex items-center justify-between rounded-md bg-linear-to-r from-blue-50 to-emerald-50 px-3 py-2 text-sm">
                  <span className="font-medium">Tổng tiền</span>
                  <span className="font-bold text-blue-700">{formatVND(booking.total)}</span>
                </div>
                {(booking.discount || 0) > 0 && (
                  <div className="mt-1 flex items-center justify-between text-[11px] text-emerald-700">
                    <span>Đã giảm</span>
                    <span>-{formatVND(booking.discount)}</span>
                  </div>
                )}
              </Section>
            </div>
          </ScrollArea>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5">
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function InfoField({
  label,
  value,
  icon,
}: {
  label: string
  value: string | null | undefined
  icon?: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="font-medium truncate flex items-center gap-1">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        {value || '—'}
      </div>
    </div>
  )
}

function statusLabel(s: string): string {
  const m: Record<string, string> = {
    pending: 'Chờ xử lý',
    confirmed: 'Đã xác nhận',
    paid: 'Đã xác nhận',
    completed: 'Hoàn thành',
    cancelled: 'Đã huỷ',
    refunded: 'Hoàn tiền',
  }
  return m[s] ?? s
}
