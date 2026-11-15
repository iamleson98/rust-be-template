import { describe, expect, it } from 'vitest'
import { isPaymentSettled } from '@/lib/payment'

describe('isPaymentSettled', () => {
  it('stops polling for every final status', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'refunded']) {
      expect(isPaymentSettled(status)).toBe(true)
    }
  })

  it('keeps polling while the gateway has not said', () => {
    expect(isPaymentSettled('pending')).toBe(false)
    expect(isPaymentSettled('')).toBe(false)
  })
})
