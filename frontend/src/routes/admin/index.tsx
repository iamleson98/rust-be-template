/** Admin route — `/admin` (employee-guarded via router beforeLoad) */
import { AdminDashboard } from '@/components/admin/dashboard'

export function AdminPage() {
  return <AdminDashboard />
}
