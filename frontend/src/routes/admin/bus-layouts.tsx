/** Admin route — `/admin/bus-layouts` — bus layout management page. */
import { createColumnHelper } from '@tanstack/react-table'
import { Bus, LayoutGrid } from 'lucide-react'

import { AdminShell } from '@/components/layout/admin-shell'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { Card, CardContent } from '@/components/ui/card'
import { useAdminBusLayouts } from '@/lib/queries'

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
    cell: ({ getValue }) => getValue() ?? '—',
    sortFn: 'text',
    meta: { label: 'Tên sơ đồ' },
  }),
  columnHelper.accessor('vehicleType', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Loại xe" />,
    cell: ({ getValue }) => getValue() ?? '—',
    sortFn: 'text',
    meta: { label: 'Loại xe' },
  }),
  columnHelper.accessor('seatCount', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Số ghế" />,
    cell: ({ getValue }) => <span className="tabular-nums">{getValue() ?? '—'}</span>,
    sortFn: 'basic',
    meta: { label: 'Số ghế', align: 'right' },
  }),
])

export function AdminBusLayoutsPage() {
  const { data, isLoading } = useAdminBusLayouts()

  const rows: BusLayoutRow[] = (data?.items ?? []).map(
    (layout: { id: string; name?: string | null; vehicleType?: string | null; seatCount?: number | null }) => ({
      id: layout.id,
      name: layout.name ?? null,
      vehicleType: layout.vehicleType ?? null,
      seatCount: layout.seatCount ?? null,
    }),
  )

  return (
    <AdminShell>
      <div className="p-3 md:p-6 space-y-4">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-600" />
            Sơ đồ ghế
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Các sơ đồ ghế của hãng xe dùng để chọn chỗ khi đặt vé.
          </p>
        </div>

        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <DataTable
              columns={columns}
              data={rows}
              isLoading={isLoading}
              rowNoun="sơ đồ"
              hidePagination
              emptyTitle="Chưa có sơ đồ ghế nào"
              emptyDescription="Sơ đồ ghế sẽ xuất hiện khi hãng xe được khởi tạo."
              emptyIcon={<Bus className="h-5 w-5" aria-hidden />}
            />
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  )
}
