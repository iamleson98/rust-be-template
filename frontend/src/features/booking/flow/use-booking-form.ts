import { useEffect, useMemo } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import type { TripDetail } from '@/api'
import { useT } from '@/lib/i18n'
import { useGuest } from '@/stores/guest'
import {
  bookingSchema,
  type BookingValues,
  type PassengerFormValue,
  type SelectedSeat,
} from './booking-form'

const EMPTY: BookingValues = { passengers: [], contactName: '', contactPhone: '', contactEmail: '' }

const ADULT_AGE = 30
const CHILD_AGE = 5

const passenger = (age: number, seatId = ''): PassengerFormValue => ({
  name: '',
  age,
  gender: 'male',
  seatId,
})

type Options = {
  trip: TripDetail | undefined
  /** Seats picked in the trip dialog. */
  seatIds: string[]
  adults: number
  children: number
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
      class: seat.seatClass ?? 'standard',
    }))
}

/**
 * The checkout form: one passenger per picked seat to start with (adults, then
 * children, seats handed out in order), the contact details, and the helpers the
 * passenger step needs.
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
  const { fields, append, remove, update, replace } = useFieldArray({
    control: form.control,
    name: 'passengers',
  })

  const seats = useMemo(() => pickedSeats(trip, seatIds), [trip, seatIds])

  // Start over when the picked seats or party size change, not when the trip is refetched
  // with the same seats: that would wipe what the customer has typed.
  const seatKey = seats.map((seat) => seat.id).join(',')
  useEffect(() => {
    if (!seatKey) return
    const ids = seatKey.split(',')
    const ages = [
      ...Array<number>(adults).fill(ADULT_AGE),
      ...Array<number>(children).fill(CHILD_AGE),
    ]
    form.reset({ ...EMPTY, passengers: ages.map((age, i) => passenger(age, ids[i])) })
  }, [form, seatKey, adults, children])

  // `useWatch` follows edits of nested fields; `form.watch('passengers')` does not.
  const passengers = useWatch({ control: form.control, name: 'passengers' }) ?? []
  const assigned = passengers.map((p) => p.seatId).filter(Boolean)
  const unassigned = passengers.length - assigned.length
  const duplicateSeats = new Set(assigned).size !== assigned.length
  const canContinue =
    passengers.length > 0 &&
    unassigned === 0 &&
    !duplicateSeats &&
    passengers.every((p) => p.name.trim())

  return {
    form,
    fields,
    passengers,
    seats,
    /** What the picked seats cost before discounts. */
    subtotal: seats.reduce((sum, seat) => sum + seat.price, 0),
    unassigned,
    duplicateSeats,
    canContinue,
    addPassenger: () => {
      if (fields.length < seats.length) append(passenger(ADULT_AGE))
    },
    removePassenger: (index: number) => {
      if (fields.length > 1) remove(index)
    },
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
