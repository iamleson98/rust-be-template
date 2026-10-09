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
 *   - `useMutation(adminBookingsUpdateStatusMutation())`     — confirm / cancel / complete
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

import { useQuery } from '@tanstack/react-query'
import { adminBrandsListOptions } from '@/api'
import { useMemo, useState, useCallback, useEffect } from 'react'
import { createColumnHelper, type SortingState } from '@tanstack/react-table'
import { DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'
import {
  rangeDays,
  useAdminBookings,
  useAdminBookingStats,
  useBookingsCsvExport,
  type AdminBookingFilter,
} from './api'
import type { BookingOut } from '@/api'

import { TicketStatusBadge } from '@/features/booking/history/ticket-status-badge'
import { PAGE_SIZE, formatVND, timeAgo } from './tickets-helpers'
import { TicketsDailyChart } from './tickets-daily-chart'
import { TicketsKpiCards } from './tickets-kpi-cards'
import { TicketsFilterBar } from './tickets-filter-bar'
import { TicketsBookingsTable } from './tickets-bookings-table'
import { BookingDetailDialog } from './booking-detail-dialog'
import { useT } from '@/lib/i18n'

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

const bookingColumnHelper = createColumnHelper<DataTableFeatures, BookingOut>()

// ── Main panel ───────────────────────────────────────────────

export function TicketsPanel() {
  const t = useT()
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
  const brandsQuery = useQuery(adminBrandsListOptions())
  const csvExport = useBookingsCsvExport(filter)

  // Debounce search: commit to filter 400ms after the last keystroke.
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = useCallback(
    (v: string) => {
      setSearchInput(v)
      if (searchTimer) clearTimeout(searchTimer)
      const timer = setTimeout(() => {
        setFilter((f) => ({ ...f, search: v.trim() || undefined, offset: 0 }))
      }, 400)
      setSearchTimer(timer)
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
          header: t('booking.code'),
          cell: ({ getValue }) => (
            <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-400">
              {getValue()}
            </span>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { label: t('booking.code') },
        }),
        bookingColumnHelper.accessor('contactName', {
          header: t('booking.passengers'),
          cell: ({ row }) => (
            <div>
              <div className="text-xs font-medium">{row.original.contactName ?? '—'}</div>
              <div className="text-[10px] text-muted-foreground">
                {row.original.contactPhone ?? ''}
              </div>
            </div>
          ),
          enableSorting: false,
          meta: { label: t('booking.passengers'), cellClassName: 'hidden md:table-cell' },
        }),
        bookingColumnHelper.display({
          id: 'route',
          header: t('adminTickets.route'),
          cell: ({ row }) => (
            <div className="text-xs">
              <div>
                {row.original.trip?.fromName ?? '—'} → {row.original.trip?.toName ?? '—'}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {row.original.seats.map((s) => s.seatCode).join(', ')}
              </div>
            </div>
          ),
          meta: { label: t('adminTickets.route'), cellClassName: 'hidden xl:table-cell' },
        }),
        bookingColumnHelper.accessor('createdAt', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('adminTickets.bookedAt')} />
          ),
          cell: ({ getValue }) => (
            <span className="text-xs text-muted-foreground" title={getValue()}>
              {timeAgo(getValue())}
            </span>
          ),
          meta: { label: t('adminTickets.bookedAt') },
        }),
        bookingColumnHelper.accessor('total', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title={t('booking.totalAmount')} />
          ),
          cell: ({ getValue }) => (
            <div className="text-xs font-semibold tabular-nums">{formatVND(getValue())}</div>
          ),
          meta: { label: t('booking.totalAmount'), align: 'right' },
        }),
        bookingColumnHelper.accessor('status', {
          header: t('common.status'),
          cell: ({ row }) => <TicketStatusBadge booking={row.original} className="text-[10px]" />,
          enableSorting: false,
          meta: { label: t('common.status') },
        }),
      ]),
    [t],
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
    <ConsolePage>
      <PageHeader
        title={t('adminTickets.pageTitle')}
        description={t('adminTickets.pageSubtitle')}
      />

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
        showStats={showStats}
        setShowStats={setShowStats}
        handleExport={csvExport.exportCsv}
        exporting={csvExport.isPending}
        brandsQuery={brandsQuery}
        setBrandFilter={setBrandFilter}
        setStatusFilter={setStatusFilter}
        activeFilterCount={activeFilterCount}
        resetFilters={resetFilters}
        setDateRange={setDateRange}
      />

      {showStats && statsQuery.data && (
        <TicketsDailyChart byDay={statsQuery.data.byDay} {...rangeDays(filter)} />
      )}

      {bookingsQuery.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t('adminTickets.listLoadFailed')}</span>
            <Button variant="outline" size="sm" onClick={() => bookingsQuery.refetch()}>
              <RefreshCw />
              {t('payment.retry')}
            </Button>
          </AlertDescription>
        </Alert>
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
    </ConsolePage>
  )
}
