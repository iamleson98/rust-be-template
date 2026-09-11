'use client'

/**
 * Recent bookings card — "Vé đặt gần đây" (Row 2 of the stats
 * overview): the 5 most-recent bookings table (real
 * /api/admin/bookings?limit=5) with the CSV export button.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { createColumnHelper } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MapPin, Ticket, Download } from 'lucide-react'
import { formatVND } from '@/lib/types'
import type { AdminBookingOut } from '@/lib/api/types.gen'
import { BookingStatusBadge } from './booking-status-badge'

// ── "Recent bookings" table columns (shared DataTable) ────────

const recentColumnHelper = createColumnHelper<DataTableFeatures, AdminBookingOut>()

const recentBookingsColumns = recentColumnHelper.columns([
  recentColumnHelper.accessor('code', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Mã vé" />,
    cell: ({ getValue }) => (
      <code className="font-mono font-bold text-blue-700 text-xs dark:text-blue-400">
        {getValue()}
      </code>
    ),
    sortFn: 'text',
    meta: { label: 'Mã vé' },
  }),
  recentColumnHelper.accessor('contactName', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Hành khách" />,
    cell: ({ getValue }) => <span className="font-medium">{getValue() ?? '—'}</span>,
    sortFn: 'text',
    meta: { label: 'Hành khách' },
  }),
  recentColumnHelper.display({
    id: 'route',
    header: 'Tuyến',
    cell: ({ row }) => {
      const routeLabel = [row.original.pickupName, row.original.dropoffName]
        .filter(Boolean)
        .join(' → ')
      return routeLabel ? (
        <span className="flex items-center gap-1 text-muted-foreground">
          <MapPin className="h-3 w-3 shrink-0 text-blue-500" aria-hidden />
          {routeLabel}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    meta: { label: 'Tuyến', cellClassName: 'hidden md:table-cell' },
  }),
  recentColumnHelper.accessor('total', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Giá" />,
    cell: ({ getValue }) => (
      <span className="font-semibold tabular-nums">{formatVND(getValue())}</span>
    ),
    sortFn: 'basic',
    meta: { label: 'Giá', align: 'right' },
  }),
  recentColumnHelper.accessor('status', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Trạng thái" />,
    cell: ({ getValue }) => <BookingStatusBadge status={getValue()} />,
    sortFn: 'text',
    meta: { label: 'Trạng thái', align: 'center' },
  }),
  recentColumnHelper.accessor('createdAt', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Thời gian" />,
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
      label: 'Thời gian',
      align: 'right',
      cellClassName: 'hidden sm:table-cell',
    },
  }),
])

export function RecentBookingsCard({
  recentBookings,
  onExportCSV,
}: {
  recentBookings: AdminBookingOut[]
  onExportCSV: () => void
}) {
  return (
          <Card className="overflow-hidden h-full">
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
              {/* The Card provides the surface — render the table unbordered. */}
              <DataTable
                bordered={false}
                columns={recentBookingsColumns}
                data={recentBookings.slice(0, 5)}
                rowNoun="vé"
                hidePagination
                defaultSorting={[{ id: 'createdAt', desc: true }]}
                emptyTitle="Chưa có vé đặt nào"
                emptyDescription="Vé sẽ xuất hiện ở đây khi có khách đặt."
                emptyIcon={<Ticket className="h-5 w-5" aria-hidden />}
              />
            </CardContent>
          </Card>
  )
}
