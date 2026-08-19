/** Admin route — `/admin` (employee-guarded via router beforeLoad)
 *
 * Uses AdminShell (sidebar layout) instead of the old top-tabs layout.
 * The dashboard overview renders as the default content in the sidebar's
 * Outlet. Sub-routes like /admin/tickets, /admin/brands, etc. render
 * in the same outlet via TanStack Router's nested routing.
 */
import { AdminShell } from '@/components/layout/admin-shell'
import { AdminDashboard } from '@/components/admin/dashboard'

export function AdminPage() {
  return (
    <AdminShell>
      <AdminDashboard />
    </AdminShell>
  )
}
