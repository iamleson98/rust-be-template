/** Admin route — `/admin/brands` — brand management page. */
import { AdminBrandManagement } from '@/components/admin/brands'

export function AdminBrandsPage() {
  return (
    <div className="page-transition">
      <AdminBrandManagement />
    </div>
  )
}
