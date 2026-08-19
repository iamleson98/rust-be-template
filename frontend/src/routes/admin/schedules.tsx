/** Admin route — `/admin/schedules` — schedule management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminSchedulesPage() {
  return <AdminShell><AdminBrandManagement /></AdminShell>
}
