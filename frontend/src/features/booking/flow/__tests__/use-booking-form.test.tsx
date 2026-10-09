import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionUser, TripDetail, TripSeat } from '@/api'
import { useGuest } from '@/stores/guest'
import { useSession } from '@/stores/session'
import { useBookingForm } from '../use-booking-form'

const seat = (id: string, finalPrice: number, childPrice?: number): TripSeat => ({
  id,
  code: id,
  seatLabel: id,
  row: 1,
  col: 1,
  deck: 1,
  status: 'available',
  seatClass: 'vip',
  finalPrice,
  childPrice,
})

const trip = (childFare: TripDetail['pricing']['childFare']) =>
  ({
    seatMap: {
      decks: [
        {
          deck: 1,
          rows: [{ row: 1, seats: [seat('A1', 400_000, 300_000), seat('A2', 400_000, 300_000)] }],
        },
      ],
    },
    pricing: { basePriceAdult: 400_000, basePriceChild: 0, fares: [], childFare },
  }) as unknown as TripDetail

const render = (detail: TripDetail) =>
  renderHook(() => useBookingForm({ trip: detail, seatIds: ['A1', 'A2'], adults: 1, children: 1 }))

describe('useBookingForm', () => {
  it('seats the searched adult, then the child, at their own prices', () => {
    const { result } = render(trip({ maxAge: 10, discountPercent: 25 }))
    expect(result.current.tickets.map((t) => [t.seat.id, t.type, t.price])).toEqual([
      ['A1', 'adult', 400_000],
      ['A2', 'child', 300_000],
    ])
    expect(result.current.subtotal).toBe(700_000)
  })

  it('follows the age the customer enters', () => {
    const { result } = render(trip({ maxAge: 10, discountPercent: 25 }))
    act(() => result.current.form.setValue('passengers.1.age', 12))
    expect(result.current.tickets[1].type).toBe('adult')
    expect(result.current.subtotal).toBe(800_000)
  })

  it('charges children the adult fare when the brand sells no child tickets', () => {
    const { result } = render(trip(null))
    expect(result.current.tickets.every((t) => t.type === 'adult')).toBe(true)
    expect(result.current.subtotal).toBe(800_000)
  })

  describe('the contact', () => {
    const user = (role: string): SessionUser => ({
      id: 'u1',
      name: 'Khách Thử',
      email: 'khach@example.com',
      phone: '+84912345678',
      role,
      type: role,
    })
    const contact = (r: ReturnType<typeof render>['result']) =>
      r.current.form.getValues(['contactName', 'contactPhone', 'contactEmail'])

    afterEach(() => {
      useSession.setState({ user: null })
      useGuest.setState({ guestName: null, guestPhone: null })
    })

    it('starts as the signed-in customer, phone in the local form', () => {
      useSession.setState({ user: user('user') })
      const { result } = render(trip(null))
      expect(contact(result)).toEqual(['Khách Thử', '0912345678', 'khach@example.com'])
    })

    it('falls back to the last contact used on this device', () => {
      useGuest.setState({ guestName: 'Lần Trước', guestPhone: '+84987654321' })
      const { result } = render(trip(null))
      expect(contact(result)).toEqual(['Lần Trước', '0987654321', ''])
    })

    it('stays empty for staff, who book for callers', () => {
      useSession.setState({ user: user('employee') })
      const { result } = render(trip(null))
      expect(contact(result)).toEqual(['', '', ''])
    })
  })
})
