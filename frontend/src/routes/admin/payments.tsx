/**
 * Admin payments route — `/admin/payments` (employee-guarded via router beforeLoad).
 */
import { AdminPaymentsPanel } from '@/components/admin/payments/payments-panel'

export function AdminPaymentsPage() {
  return <AdminPaymentsPanel />
}
