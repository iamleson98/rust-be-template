import { z } from 'zod'
import { User, UserCheck, Baby } from 'lucide-react'
import { fullNameSchema, phoneSchema, emailSchema } from '@/lib/forms'
import { tSync } from '@/lib/i18n'

export type PassengerType = 'adult' | 'child' | 'infant'

// `age` is a plain number: the age input parses before calling `field.onChange`.
// Messages are functions so they resolve in the current language at validation time.

const passengerSchema = z.object({
  name: fullNameSchema,
  age: z
    .number()
    .int({ error: () => tSync('bookingFlow.ageInteger') })
    .min(0, { error: () => tSync('bookingFlow.ageInvalid') })
    .max(120, { error: () => tSync('bookingFlow.ageInvalid') }),
  gender: z.enum(['male', 'female', 'other']),
  seatId: z.string().min(1, { error: () => tSync('bookingFlow.seatRequired') }),
})

export const bookingSchema = z.object({
  passengers: z.array(passengerSchema).min(1, { error: () => tSync('bookingFlow.minPassengers') }),
  contactName: fullNameSchema,
  contactPhone: phoneSchema,
  contactEmail: emailSchema.optional().or(z.literal('')),
})

export type BookingValues = z.infer<typeof bookingSchema>
export type PassengerFormValue = z.infer<typeof passengerSchema>

/** Infants (under 2) travel free, children are under 12. */
export function getPassengerType(age: number): PassengerType {
  if (age < 2) return 'infant'
  if (age < 12) return 'child'
  return 'adult'
}

/** `label` is an i18n key. */
export const PASSENGER_TYPE_META: Record<
  PassengerType,
  {
    label: string
    gradient: string
    border: string
    pill: string
    text: string
    icon: React.ReactNode
  }
> = {
  adult: {
    label: 'booking.passengerType.adult',
    gradient: 'from-blue-50 to-blue-50',
    border: 'border-blue-200',
    pill: 'bg-blue-100 text-blue-700',
    text: 'text-blue-700',
    icon: <User className="h-3 w-3" />,
  },
  child: {
    label: 'booking.passengerType.child',
    gradient: 'from-amber-50 to-orange-50',
    border: 'border-amber-200',
    pill: 'bg-amber-100 text-amber-700',
    text: 'text-amber-700',
    icon: <UserCheck className="h-3 w-3" />,
  },
  infant: {
    label: 'booking.passengerType.infant',
    gradient: 'from-pink-50 to-rose-50',
    border: 'border-rose-200',
    pill: 'bg-pink-100 text-pink-700',
    text: 'text-pink-700',
    icon: <Baby className="h-3 w-3" />,
  },
}

/** A picked seat with its price, as the passenger step lists it. */
export type SelectedSeat = {
  id: string
  code: string
  price: number
  class: string
}
