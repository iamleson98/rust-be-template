/** Narrowed from the backend's free-form strings so call sites get autocomplete. */
export type PaymentProvider = 'vnpay' | 'momo' | 'zalopay' | 'vietqr' | 'cod'

export type PaymentStatus = 'pending' | 'completed' | 'failed' | 'cancelled' | 'refunded'

const SETTLED: string[] = ['completed', 'failed', 'cancelled', 'refunded']

/** A settled payment never changes again, so polling can stop. */
export const isPaymentSettled = (status: string) => SETTLED.includes(status)
