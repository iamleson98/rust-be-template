/** Admin route — `/admin` — the dashboard overview.
 *
 * The persistent AdminShell comes from the router's admin layout route;
 * this file renders ONLY the dashboard panel into the shell's outlet.
 */
import { AdminDashboard } from '@/features/admin/dashboard'

export function AdminPage() {
  return (
    <div className="page-transition">
      <AdminDashboard />
    </div>
  )
}
