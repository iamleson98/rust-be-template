/**
 * Tests for the feedback feature — verifies that the booking reviewable
 * logic works correctly (determines when a user can leave feedback).
 */
import { describe, it, expect } from 'vitest'
import { isBookingReviewable } from '@/features/booking/history/booking-types'
import type { BookingItem } from '@/features/booking/history/booking-types'

describe('isBookingReviewable', () => {
  const baseBooking: BookingItem = {
    id: 'test-1',
    code: 'TEST001',
    status: 'completed',
    paymentMethod: 'cod',
    adultCount: 1,
    childCount: 0,
    contactName: 'Test User',
    contactPhone: '0901234567',
    subtotal: 100000,
    discount: 0,
    fees: 0,
    total: 100000,
    currency: 'VND',
    canCancel: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    seats: [],
    trip: {
      id: 'trip-1',
      departureAt: '2024-01-01T08:00:00Z',
      departureDate: '2024-01-01',
      status: 'scheduled',
      routeId: 'route-1',
      routeName: 'Test Route',
      fromName: 'A',
      toName: 'B',
      brandName: 'Test Brand',
    },
  }

  it('returns true for completed bookings', () => {
    expect(isBookingReviewable(baseBooking)).toBe(true)
  })

  it('returns false for cancelled bookings', () => {
    expect(isBookingReviewable({ ...baseBooking, status: 'cancelled' })).toBe(false)
  })

  it('returns false for refunded bookings', () => {
    expect(isBookingReviewable({ ...baseBooking, status: 'refunded' })).toBe(false)
  })

  it('returns true for confirmed bookings with past departure date', () => {
    expect(
      isBookingReviewable({
        ...baseBooking,
        status: 'confirmed',
        trip: { ...baseBooking.trip!, departureAt: '2020-01-01T08:00:00Z' },
      }),
    ).toBe(true)
  })

  it('returns false for confirmed bookings with future departure date', () => {
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    expect(
      isBookingReviewable({
        ...baseBooking,
        status: 'confirmed',
        trip: { ...baseBooking.trip!, departureAt: future.toISOString() },
      }),
    ).toBe(false)
  })

  it('returns false for bookings without trip info', () => {
    expect(isBookingReviewable({ ...baseBooking, trip: null })).toBe(false)
  })
})
