import { useQuery } from '@tanstack/react-query'
import { getPaymentOptions, listBookingPaymentsOptions } from '@/api'
import { isPaymentSettled } from '@/lib/payment'

/** A payment, polled every 3s while the gateway has not settled it. */
export function usePayment(id: string | undefined, enabled = true) {
  return useQuery({
    ...getPaymentOptions({ path: { id: id ?? '' } }),
    enabled: !!id && enabled,
    refetchInterval: ({ state }) =>
      state.data && !isPaymentSettled(state.data.status) ? 3000 : false,
  })
}

/** A booking's payments, refreshed every 5s while the user waits on a gateway. */
export function useBookingPayments(bookingId: string | undefined, enabled = true) {
  return useQuery({
    ...listBookingPaymentsOptions({ path: { bookingId: bookingId ?? '' } }),
    enabled: !!bookingId && enabled,
    refetchInterval: 5000,
  })
}
