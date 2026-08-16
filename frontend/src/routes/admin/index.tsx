/** Admin route — `/admin` (employee-guarded via router beforeLoad) */
import { AdminDashboard } from '@/components/bus/admin-dashboard'

export function AdminPage() {
  return <AdminDashboard />
}
