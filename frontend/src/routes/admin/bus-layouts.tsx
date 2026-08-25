/** Admin route — `/admin/bus-layouts` — bus layout management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { useAdminBusLayouts } from '@/lib/queries'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function AdminBusLayoutsPage() {
  const { data, isLoading } = useAdminBusLayouts()

  return (
    <AdminShell>
      <div className="p-3">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tên</TableHead>
                  <TableHead>Loại xe</TableHead>
                  <TableHead>Số ghế</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items?.map((layout: any) => (
                  <TableRow key={layout.id}>
                    <TableCell>{layout.name ?? '—'}</TableCell>
                    <TableCell>{layout.vehicleType ?? '—'}</TableCell>
                    <TableCell>{layout.seatCount ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </AdminShell>
  )
}
