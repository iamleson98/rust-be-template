import { useQuery } from '@tanstack/react-query'
import { listProvidersOptions } from '@/api'

/** Narrowed from the backend's free-form strings so call sites get autocomplete. */
export type PaymentProvider = 'vnpay' | 'momo' | 'zalopay' | 'vietqr' | 'cod'

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded'

const SETTLED: string[] = ['completed', 'failed', 'cancelled', 'refunded']

/** A settled payment never changes again, so polling can stop. */
export const isPaymentSettled = (status: string) => SETTLED.includes(status)

/** The providers the server takes payments with; `undefined` until it has said. */
export function useEnabledProviders(): PaymentProvider[] | undefined {
  const { data } = useQuery({ ...listProvidersOptions(), staleTime: 5 * 60_000 })
  return data?.providers as PaymentProvider[] | undefined
}
