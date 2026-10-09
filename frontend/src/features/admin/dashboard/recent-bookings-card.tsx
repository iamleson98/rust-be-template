'use client'

/**
 * Recent bookings card — "Vé đặt gần đây" (Row 2 of the stats
 * overview): the 5 most-recent bookings table (real
 * /api/admin/bookings?limit=5) with the CSV export button.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { createColumnHelper } from '@tanstack/react-table'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Panel } from '@/components/console/panel'
import { MapPin, Ticket } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { formatVND } from '@/lib/format'
import type { BookingOut } from '@/api'
import { TicketStatusBadge } from '@/features/booking/history/ticket-status-badge'

// ── "Recent bookings" table columns (shared DataTable) ────────
// Built per render (see `getRecentBookingsColumns`) so column labels
// follow the active language.

const recentColumnHelper = createColumnHelper<DataTableFeatures, BookingOut>()

const getRecentBookingsColumns = (t: ReturnType<typeof useT>) =>
  recentColumnHelper.columns([
    recentColumnHelper.accessor('code', {
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('booking.code')} />,
      cell: ({ getValue }) => (
        <code className="font-mono font-bold text-blue-700 text-xs dark:text-blue-400">
          {getValue()}
        </code>
      ),
      sortFn: 'text',
      meta: { label: t('booking.code') },
    }),
    recentColumnHelper.accessor('contactName', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('booking.passengers')} />
      ),
      cell: ({ getValue }) => <span className="font-medium">{getValue() ?? '—'}</span>,
      sortFn: 'text',
      meta: { label: t('booking.passengers') },
    }),
    recentColumnHelper.display({
      id: 'route',
      header: t('adminDash.route'),
      cell: ({ row }) => {
        const trip = row.original.trip
        const routeLabel = trip ? `${trip.fromName ?? '—'} → ${trip.toName ?? '—'}` : ''
        return routeLabel ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0 text-blue-500" aria-hidden />
            {routeLabel}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )
      },
      meta: { label: t('adminDash.route'), cellClassName: 'hidden md:table-cell' },
    }),
    recentColumnHelper.accessor('total', {
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('adminDash.price')} />
      ),
      cell: ({ getValue }) => (
        <span className="font-semibold tabular-nums">{formatVND(getValue())}</span>
      ),
      sortFn: 'basic',
      meta: { label: t('adminDash.price'), align: 'right' },
    }),
    recentColumnHelper.accessor('status', {
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('common.status')} />,
      cell: ({ row }) => <TicketStatusBadge booking={row.original} className="text-[10px]" />,
      sortFn: 'text',
      meta: { label: t('common.status'), align: 'center' },
    }),
    recentColumnHelper.accessor('createdAt', {
      header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminDash.time')} />,
      cell: ({ getValue }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {getValue()
            ? new Date(getValue()).toLocaleString('vi-VN', {
                dateStyle: 'short',
                timeStyle: 'short',
              })
            : '—'}
        </span>
      ),
      sortFn: 'datetime',
      meta: {
        label: t('adminDash.time'),
        align: 'right',
        cellClassName: 'hidden sm:table-cell',
      },
    }),
  ])

export function RecentBookingsCard({ recentBookings }: { recentBookings: BookingOut[] }) {
  const t = useT()
  return (
    <Panel
      className="h-full overflow-hidden"
      bodyClassName="p-0 pt-2"
      icon={<Ticket />}
      title={t('adminDash.recentBookingsTitle')}
    >
      {/* The panel provides the surface — render the table unbordered. */}
      <DataTable
        bordered={false}
        columns={getRecentBookingsColumns(t)}
        data={recentBookings.slice(0, 5)}
        rowNoun={t('adminDash.ticketNoun')}
        hidePagination
        defaultSorting={[{ id: 'createdAt', desc: true }]}
        emptyTitle={t('adminDash.noBookingsTitle')}
        emptyDescription={t('adminDash.noBookingsDesc')}
        emptyIcon={<Ticket className="h-5 w-5" aria-hidden />}
      />
    </Panel>
  )
}
