/** Admin route — `/admin/tickets` — bookings/tickets management page. */
import { TicketsPanel } from '@/features/admin/tickets/tickets-panel'

export function AdminTicketsPage() {
  return (
    <div className="page-transition">
      <TicketsPanel />
    </div>
  )
}
