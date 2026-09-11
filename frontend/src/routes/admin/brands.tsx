/** Admin route — `/admin/brands` — brand management page. */
import { AdminBrandManagement } from '@/features/admin/brands'

export function AdminBrandsPage() {
  return (
    <div className="page-transition">
      <AdminBrandManagement />
    </div>
  )
}
