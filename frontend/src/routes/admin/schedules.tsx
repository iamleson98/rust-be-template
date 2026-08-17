/** Admin route — `/admin/schedules` — schedule management page. */
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminSchedulesPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <AdminBrandManagement />
      </div>
    </div>
  )
}
