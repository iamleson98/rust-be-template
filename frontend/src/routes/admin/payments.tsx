/** Admin payments route — `/admin/payments` */
import { AdminShell } from '@/components/layout/admin-shell'
import { AdminPaymentsPanel } from '@/components/admin/payments/payments-panel'

export function AdminPaymentsPage() {
  return <AdminShell><AdminPaymentsPanel /></AdminShell>
}
