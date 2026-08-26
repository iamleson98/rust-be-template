/**
 * Tests for the feedback feature — verifies that the booking reviewable
 * logic works correctly (determines when a user can leave feedback).
 */
import { describe, it, expect } from 'vitest'
import { isBookingReviewable } from '@/components/bookings/booking-types'
import type { BookingItem } from '@/components/bookings/booking-types'

describe('isBookingReviewable', () => {
  const baseBooking: BookingItem = {
    id: 'test-1',
    code: 'TEST001',
    status: 'completed',
    contactName: 'Test User',
    contactPhone: '0901234567',
    contactEmail: null,
    pickupPointName: null,
    droppingPointName: null,
    paymentMethod: 'cod',
    subtotal: 100000,
    discount: 0,
    fees: 0,
    total: 100000,
    currency: 'VND',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    paidAt: null,
    cancelledAt: null,
    expiresAt: null,
    seats: [],
    trip: {
      departureAt: '2024-01-01T08:00:00Z',
      departureDate: '2024-01-01',
      status: 'departed',
      routeName: 'Test Route',
      fromName: 'A',
      toName: 'B',
      brandName: 'Test Brand',
      brandAccent: '#000',
      brandLogo: null,
      busLayoutName: 'Test Bus',
      vehicleType: 'bus',
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
