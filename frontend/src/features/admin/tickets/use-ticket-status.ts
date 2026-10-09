import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminBookingsUpdateStatusMutation } from '@/api'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

/** What staff can do to an open ticket. */
export type TicketAction = 'confirmed' | 'completed' | 'cancelled'

const DONE: Record<TicketAction, string> = {
  confirmed: 'adminTickets.confirmedToast',
  completed: 'adminTickets.completedToast',
  cancelled: 'adminTickets.cancelledToast',
}

/** Move a ticket on (confirm after the call, complete, cancel) and say how it went. */
export function useTicketStatus() {
  const t = useT()
  const mutation = useMutation(adminBookingsUpdateStatusMutation())
  const set = async (
    ticket: { id: string; code: string },
    status: TicketAction,
    reason?: string,
  ) => {
    try {
      await mutation.mutateAsync({
        path: { id: ticket.id },
        body: { status, reason: reason?.trim() || undefined },
      })
      toast.success(t(DONE[status], { code: ticket.code }))
      return true
    } catch (e) {
      toast.error(t('adminTickets.statusUpdateFailed'), {
        description: getErrorMessage(e, t('adminTickets.pleaseRetry')),
      })
      return false
    }
  }
  return { set, pending: mutation.isPending }
}
