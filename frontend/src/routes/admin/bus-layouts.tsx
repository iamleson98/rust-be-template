/** Admin route — `/admin/bus-layouts` — bus layout management page. */
import { useAdminBusLayouts } from '@/lib/queries'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Bus } from 'lucide-react'

export function AdminBusLayoutsPage() {
  const { data, isLoading } = useAdminBusLayouts()

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Sơ đồ ghế</h1>
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
    </div>
  )
}
