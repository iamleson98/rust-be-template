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
import { DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminBookings,
  useAdminBookingStats,
  useAdminBookingExport,
  useAdminBrands,
} from '@/lib/queries'
import type {
  AdminBookingFilter,
} from '@/lib/queries'
import type { AdminBookingOut } from '@/lib/api/types.gen'

import { BookingStatusBadge } from '@/features/admin/dashboard/badges'
import { downloadCSV } from '@/features/admin/dashboard/helpers'
import { PAGE_SIZE, formatVND, timeAgo } from './tickets-helpers'
import { TicketsKpiCards } from './tickets-kpi-cards'
import { TicketsFilterBar } from './tickets-filter-bar'
import { TicketsBookingsTable } from './tickets-bookings-table'
import { BookingDetailDialog } from './booking-detail-dialog'

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
      <TicketsKpiCards totals={totals} />

      {/* ─── Filter bar ─── */}
      <TicketsFilterBar
        filter={filter}
        setFilter={setFilter}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        onSearchChange={onSearchChange}
        setRangeFilter={setRangeFilter}
        setShowStats={setShowStats}
        handleExport={handleExport}
        exportMutation={exportMutation}
        brandsQuery={brandsQuery}
        setBrandFilter={setBrandFilter}
        setStatusFilter={setStatusFilter}
        activeFilterCount={activeFilterCount}
        resetFilters={resetFilters}
        setDateRange={setDateRange}
      />

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
      <TicketsBookingsTable
        columns={columns}
        bookingsQuery={bookingsQuery}
        total={total}
        offset={offset}
        setFilter={setFilter}
        sorting={sorting}
        handleSortingChange={handleSortingChange}
        setSelectedBookingId={setSelectedBookingId}
      />

      {/* ─── Detail dialog ─── */}
      <BookingDetailDialog
        bookingId={selectedBookingId}
        onClose={() => setSelectedBookingId(null)}
      />
    </div>
  )
}
