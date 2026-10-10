'use client'

import type { Dispatch, SetStateAction } from 'react'
import type { CellData, ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, DataTableViewOptions, type DataTableFeatures } from '@/components/data-table'
import { CountPill } from '@/components/console/panel'
import { Button } from '@/components/ui/button'
import { Ticket as TicketIcon, RefreshCw } from 'lucide-react'
import type { useAdminBookings, AdminBookingFilter } from './api'
import type { BookingOut } from '@/api'
import { TicketStatusBadge } from '@/features/booking/history/ticket-status-badge'
import { useT } from '@/lib/i18n'
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
  columns: ColumnDef<DataTableFeatures, BookingOut, CellData>[]
  bookingsQuery: ReturnType<typeof useAdminBookings>
  total: number
  offset: number
  setFilter: Dispatch<SetStateAction<AdminBookingFilter>>
  sorting: SortingState
  handleSortingChange: (next: SortingState) => void
  setSelectedBookingId: Dispatch<SetStateAction<string | null>>
}) {
  const t = useT()
  return (
    <>
      <DataTable
        columns={columns}
        data={bookingsQuery.data?.items ?? []}
        rowNoun={t('adminTickets.rowNoun')}
        manualPagination
        totalRowCount={total}
        pageIndex={Math.floor(offset / PAGE_SIZE)}
        onPageIndexChange={(next) => setFilter((f) => ({ ...f, offset: next * PAGE_SIZE }))}
        pageSize={PAGE_SIZE}
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        isLoading={bookingsQuery.isLoading}
        isError={bookingsQuery.isError}
        onRetry={() => bookingsQuery.refetch()}
        onRowClick={(b) => setSelectedBookingId(b.id)}
        rowAriaLabel={(b) => t('adminTickets.viewTicketDetail', { code: b.code })}
        rowClassName="card-hover-lift"
        emptyTitle={t('adminTickets.emptyTitle')}
        emptyDescription={t('adminTickets.emptyDescription')}
        emptyIcon={<TicketIcon className="h-5 w-5" aria-hidden />}
        toolbar={(table) => (
          <div className="flex items-center gap-2 border-b border-slate-100 py-2.5 pr-2.5 pl-4">
            <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="truncate">{t('adminTickets.soldTicketsTitle')}</span>
              <CountPill n={total} />
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-slate-500"
                onClick={() => bookingsQuery.refetch()}
                disabled={bookingsQuery.isFetching}
                aria-label={t('common.refresh')}
                title={t('common.refresh')}
              >
                <RefreshCw className={bookingsQuery.isFetching ? 'animate-spin' : ''} />
              </Button>
              <DataTableViewOptions table={table} className="hidden h-8 md:inline-flex" />
            </div>
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
                      <TicketStatusBadge booking={b} className="text-[10px]" />
                    </div>
                    <div className="text-xs font-medium mt-1 truncate">
                      {b.contactName ?? '—'} · {b.contactPhone ?? ''}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {b.trip?.fromName ?? '—'} → {b.trip?.toName ?? '—'} ·{' '}
                      {b.seats.map((s) => s.seatCode).join(', ')}
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
