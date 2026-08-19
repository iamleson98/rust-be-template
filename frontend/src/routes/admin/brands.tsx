/** Admin route — `/admin/brands` — brand management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminBrandsPage() {
  return <AdminShell><AdminBrandManagement /></AdminShell>
}
