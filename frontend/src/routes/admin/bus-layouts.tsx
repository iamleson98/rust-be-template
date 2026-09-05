'use client'

/**
 * Admin route — `/admin/bus-layouts` — seat-layout catalog page.
 *
 * Server-side paginated table (the backend returns `total` so the
 * footer's range label + page buttons work for arbitrarily large
 * catalogs). The DataTable renders its own bordered surface.
 */

import { useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Bus, LayoutGrid } from 'lucide-react'

import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'

import { useAdminBusLayouts } from '@/lib/queries'
import type { AdminBusLayoutOut } from '@/lib/api/types.gen'

/** Server-side page size for the bus-layouts table. */
const PAGE_SIZE = 20

interface BusLayoutRow {
  id: string
  name: string | null
  vehicleType: string | null
  seatCount: number | null
}

const columnHelper = createColumnHelper<DataTableFeatures, BusLayoutRow>()
const columns = columnHelper.columns([
  columnHelper.accessor('name', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Tên sơ đồ" />,
    cell: ({ getValue }) => (
      <span className="font-medium">{getValue() ?? '—'}</span>
    ),
    sortFn: 'text',
    meta: { label: 'Tên sơ đồ' },
  }),
  columnHelper.accessor('vehicleType', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Loại xe" />,
    sortFn: 'text',
    meta: { label: 'Loại xe' },
  }),
  columnHelper.accessor('seatCount', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Số ghế" />,
    cell: ({ getValue }) => (
      <span className="tabular-nums font-semibold">{getValue() ?? '—'}</span>
    ),
    sortFn: 'basic',
    meta: { label: 'Số ghế', align: 'right' },
  }),
])

export function AdminBusLayoutsPage() {
  const [page, setPage] = useState(0)

  const { data, isLoading } = useAdminBusLayouts({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const rows: BusLayoutRow[] = (data?.items ?? []).map(
    (layout: AdminBusLayoutOut) => ({
      id: layout.id,
      name: layout.name ?? null,
      vehicleType: layout.vehicleType ?? null,
      seatCount: layout.totalSeats ?? null,
    }),
  )
  const total = data?.total ?? 0

  return (
      <div className="page-transition p-3 md:p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-600" />
            Sơ đồ ghế
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Các sơ đồ ghế của hãng xe dùng để chọn chỗ khi đặt vé.
          </p>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          rowNoun="sơ đồ"
          manualPagination
          totalRowCount={total}
          pageIndex={page}
          onPageIndexChange={setPage}
          pageSize={PAGE_SIZE}
          isLoading={isLoading}
          emptyTitle="Chưa có sơ đồ ghế nào"
          emptyDescription="Sơ đồ ghế sẽ xuất hiện khi hãng xe được khởi tạo."
          emptyIcon={<Bus className="h-5 w-5" aria-hidden />}
        />
      </div>
  )
}
