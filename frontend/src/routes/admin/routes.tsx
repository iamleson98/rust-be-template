/** Admin route — `/admin/routes` — route management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminRoutesPage() {
  return <AdminShell><AdminBrandManagement /></AdminShell>
}
