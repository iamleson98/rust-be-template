/** Admin payments route — `/admin/payments` */
import { AdminPaymentsPanel } from '@/components/admin/payments/payments-panel'

export function AdminPaymentsPage() {
  return (
    <div className="page-transition">
      <AdminPaymentsPanel />
    </div>
  )
}
