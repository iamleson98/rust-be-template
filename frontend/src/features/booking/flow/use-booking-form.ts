import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { TripDetail } from '@/api'
import { useT } from '@/lib/i18n'
import { useGuest } from '@/stores/guest'
import { isStaffUser, useSession } from '@/stores/session'
import { localPhone } from '@/lib/text'
import { passengerType, ticketPrice, type PassengerType } from '../fares'
import {
  bookingSchema,
  type BookingValues,
  type PassengerFormValue,
  type SelectedSeat,
} from './booking-form'

const EMPTY: BookingValues = { passengers: [], contactName: '', contactPhone: '', contactEmail: '' }

/**
 * Who to put as the contact before anything is typed: the signed-in
 * customer's own details, else the last contact used on this device. Staff
 * book for callers, so nothing is filled in for them.
 */
function contactDefaults(): Partial<BookingValues> {
  const user = useSession.getState().user
  if (isStaffUser(user)) return {}
  const { guestName, guestPhone } = useGuest.getState()
  const phone = user?.phone || guestPhone
  return {
    contactName: user?.name || guestName || '',
    contactPhone: phone ? localPhone(phone) : '',
    contactEmail: user?.email ?? '',
  }
}

const ADULT_AGE = 30
const CHILD_AGE = 5

const passenger = (age: number, seatId: string): PassengerFormValue => ({
  name: '',
  age,
  gender: 'male',
  seatId,
})

type Options = {
  trip: TripDetail | undefined
  /** Seats picked in the trip dialog. */
  seatIds: string[]
  /** The searched party, used to guess who sits where. */
  adults: number
  children: number
}

/** One seat of the booking: who sits in it and what they pay. */
export type Ticket = {
  seat: SelectedSeat
  /** Index in the passenger list; -1 while nobody has the seat. */
  passengerIndex: number
  passenger: PassengerFormValue | undefined
  type: PassengerType
  price: number
}

/** The picked seats (in seat-map order) with their prices. */
function pickedSeats(trip: TripDetail | undefined, seatIds: string[]): SelectedSeat[] {
  const all = trip?.seatMap.decks.flatMap((deck) => deck.rows.flatMap((row) => row.seats)) ?? []
  return all
    .filter((seat) => seatIds.includes(seat.id))
    .map((seat) => ({
      id: seat.id,
      code: seat.code,
      price: seat.finalPrice,
      childPrice: seat.childPrice,
      class: seat.seatClass ?? 'standard',
    }))
}

/**
 * The checkout form: one passenger per picked seat (the searched adults first, then
 * the children), the contact details, and what each ticket costs.
 */
export function useBookingForm({ trip, seatIds, adults, children }: Options) {
  const t = useT()
  const guestName = useGuest((s) => s.guestName)
  const form = useForm<BookingValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: EMPTY,
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })
  const { fields, update, replace } = useFieldArray({ control: form.control, name: 'passengers' })

  const seats = useMemo(() => pickedSeats(trip, seatIds), [trip, seatIds])
  const childFare = trip?.pricing.childFare ?? null

  // Start over when the picked seats or party size change, not when the trip is refetched
  // with the same seats: that would wipe what the customer has typed.
  const seatKey = seats.map((seat) => seat.id).join(',')
  useEffect(() => {
    if (!seatKey) return
    const ids = seatKey.split(',')
    const age = (i: number) => (i >= adults && i < adults + children ? CHILD_AGE : ADULT_AGE)
    form.reset({
      ...EMPTY,
      // Read once per reset: a session refresh must not wipe what was typed.
      ...contactDefaults(),
      passengers: ids.map((id, i) => passenger(age(i), id)),
    })
  }, [form, seatKey, adults, children])

  // `useWatch` follows edits of nested fields; `form.watch('passengers')` does not.
  const passengers = useWatch({ control: form.control, name: 'passengers' }) ?? []
  const assigned = passengers.map((p) => p.seatId).filter(Boolean)
  const unassigned = passengers.length - assigned.length
  const duplicateSeats = new Set(assigned).size !== assigned.length

  const tickets: Ticket[] = seats.map((seat) => {
    const passengerIndex = passengers.findIndex((p) => p.seatId === seat.id)
    const sitter = passengers[passengerIndex]
    const type = sitter ? passengerType(sitter.age, childFare) : 'adult'
    return { seat, passengerIndex, passenger: sitter, type, price: ticketPrice(seat, type) }
  })

  return {
    form,
    fields,
    passengers,
    seats,
    tickets,
    childFare,
    typeOf: (p: PassengerFormValue) => passengerType(p.age, childFare),
    /** What the tickets cost before discounts. */
    subtotal: tickets.reduce((sum, ticket) => sum + ticket.price, 0),
    unassigned,
    duplicateSeats,
    canContinue:
      passengers.length === seats.length &&
      seats.length > 0 &&
      unassigned === 0 &&
      !duplicateSeats &&
      passengers.every((p) => p.name.trim()),
    /** Hands the still-free seats to the passengers who have none. */
    autoAssignSeats: () => {
      const current = form.getValues('passengers')
      const free = seats.filter((seat) => !current.some((p) => p.seatId === seat.id))
      replace(
        current.map((p) => (p.seatId || !free.length ? p : { ...p, seatId: free.shift()!.id })),
      )
      toast.success(t('booking.autoAssignSuccess'))
    },
    /** Puts the contact (or last used) name on the first passenger who has none. */
    copyContactName: () => {
      const name = form.getValues('contactName') || guestName
      if (!name) {
        toast.error(t('booking.missingContact'), {
          description: t('bookingFlow.missingContactNameDesc'),
        })
        return
      }
      const current = form.getValues('passengers')
      const index = Math.max(
        0,
        current.findIndex((p) => !p.name.trim()),
      )
      if (current[index]) update(index, { ...current[index], name })
      toast.success(t('bookingFlow.copiedContactName'))
    },
    reset: () => form.reset(EMPTY),
  }
}

export type BookingForm = ReturnType<typeof useBookingForm>
