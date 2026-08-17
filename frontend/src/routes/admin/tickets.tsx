/** Admin route — `/admin/tickets` — bookings/tickets management page. */
import { TicketsPanel } from '@/components/admin/tickets/tickets-panel'

export function AdminTicketsPage() {
  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <TicketsPanel />
      </div>
    </div>
  )
}
