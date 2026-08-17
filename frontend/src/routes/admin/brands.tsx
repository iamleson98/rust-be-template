/** Admin route — `/admin/brands` (employee-guarded via router beforeLoad)
 *
 * Brand management page. Renders the master-detail `AdminBrandManagement`
 * view which covers brands + routes + schedules + pickup points CRUD.
 *
 * The same component is also embedded in the dashboard's "Hãng xe & Tuyến"
 * tab — using it as a standalone page keeps the deep-linkable URL
 * semantics without duplicating the underlying forms.
 */
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminBrandsPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <AdminBrandManagement />
      </div>
    </div>
  )
}
