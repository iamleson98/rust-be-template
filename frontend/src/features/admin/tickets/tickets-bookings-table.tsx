'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { CellData, ColumnDef, SortingState } from '@tanstack/react-table'
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFeatures,
} from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Ticket as TicketIcon, RefreshCw } from 'lucide-react'
import { useAdminBookings, type AdminBookingFilter } from '@/lib/queries'
import type { AdminBookingOut } from '@/lib/api/types.gen'
import { BookingStatusBadge } from '@/features/admin/dashboard/badges'
import { PAGE_SIZE, formatVND } from './tickets-helpers'

export function TicketsBookingsTable({
  columns,
  bookingsQuery,
  total,
  offset,
  setFilter,
  sorting,
  handleSortingChange,
  setSelectedBookingId,
}: {
  columns: ColumnDef<DataTableFeatures, AdminBookingOut, CellData>[]
  bookingsQuery: ReturnType<typeof useAdminBookings>
  total: number
  offset: number
  setFilter: Dispatch<SetStateAction<AdminBookingFilter>>
  sorting: SortingState
  handleSortingChange: (next: SortingState) => void
  setSelectedBookingId: Dispatch<SetStateAction<string | null>>
}) {
  return (
    <>
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
    </>
  )
}
