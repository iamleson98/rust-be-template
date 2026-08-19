/** Admin route — `/admin/tickets` — bookings/tickets management page. */
import { AdminShell } from '@/components/layout/admin-shell'
import { TicketsPanel } from '@/components/admin/tickets/tickets-panel'

export function AdminTicketsPage() {
  return <AdminShell><TicketsPanel /></AdminShell>
}
