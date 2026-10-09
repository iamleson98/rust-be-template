import { describe, expect, it } from 'vitest'
import type { BookingOut } from '@/api'
import {
  isBookingCancelled,
  isBookingPast,
  isBookingUpcoming,
  ticketStage,
} from '@/features/booking/history/booking-types'

const DAY = 24 * 3600_000

const ticket = (status: string, paymentMethod: string | null, departsInMs: number): BookingOut => ({
  id: 'b',
  code: 'SB-ABCDEF',
  status,
  paymentMethod,
  adultCount: 1,
  childCount: 0,
  subtotal: 350_000,
  discount: 0,
  fees: 0,
  total: 350_000,
  currency: 'VND',
  canCancel: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  seats: [],
  trip: {
    id: 't',
    departureDate: '2026-10-10',
    departureAt: new Date(Date.now() + departsInMs).toISOString(),
    status: 'scheduled',
    routeId: 'r',
    routeName: 'A - B',
  },
})

describe('ticket stages', () => {
  it('tells a placed cash ticket from one being paid online', () => {
    expect(ticketStage(ticket('pending', 'cod', DAY))).toBe('awaiting')
    expect(ticketStage(ticket('pending', 'vnpay', DAY))).toBe('paying')
    expect(ticketStage(ticket('confirmed', 'cod', DAY))).toBe('confirmed')
    expect(ticketStage(ticket('cancelled', 'cod', DAY))).toBe('cancelled')
  })

  it('files tickets under upcoming, past and cancelled', () => {
    const awaiting = ticket('pending', 'cod', DAY)
    const ridden = ticket('confirmed', 'cod', -DAY)
    const dropped = ticket('cancelled', 'cod', DAY)
    expect([isBookingUpcoming(awaiting), isBookingPast(awaiting)]).toEqual([true, false])
    expect([isBookingUpcoming(ridden), isBookingPast(ridden)]).toEqual([false, true])
    expect([isBookingUpcoming(dropped), isBookingCancelled(dropped)]).toEqual([false, true])
  })
})
