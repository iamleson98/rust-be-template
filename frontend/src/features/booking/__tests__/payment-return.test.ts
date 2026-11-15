import { describe, expect, it } from 'vitest'
import { paymentReturnTarget } from '../payment-return'

const lookup = {
  bookingOf: async (id: string) => {
    if (id !== 'pay-1') throw new Error('payment not found')
    return 'booking-1'
  },
  codeOf: async (id: string) => (id === 'booking-1' ? 'AB12' : ''),
}

describe('payment gateway return', () => {
  it('opens the ticket the payment is for', async () => {
    expect(await paymentReturnTarget('pay-1', lookup)).toEqual({
      to: '/account/trips/$code',
      params: { code: 'AB12' },
      replace: true,
    })
  })

  it('falls back to the ticket list when the payment cannot be read', async () => {
    expect(await paymentReturnTarget('pay-2', lookup)).toEqual({
      to: '/account/trips',
      replace: true,
    })
  })

  it('falls back to the ticket list when the booking has no readable code', async () => {
    const failing = { ...lookup, codeOf: async () => Promise.reject(new Error('forbidden')) }
    expect(await paymentReturnTarget('pay-1', failing)).toEqual({
      to: '/account/trips',
      replace: true,
    })
  })
})
