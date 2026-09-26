/**
 * Shared types, zod schemas and helpers for the BookingDialog module.
 *
 * Extracted from the original `booking-dialog.tsx` so the form section,
 * passenger list, seat selector, price summary, payment method and
 * success state can each live in their own file under `booking/`.
 */

import { z } from 'zod'
import { fullNameSchema, phoneSchema, emailSchema } from '@/lib/forms'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'
import {
  User,
  UserCheck,
  Baby,
} from 'lucide-react'
import type { TripSeat } from '@/lib/api/types.gen'

// ── Trip detail shape (local — matches the actual backend response) ──
// The centralized type in `@/lib/queries/types` lacks `seatMap.decks`,
// `pricing.basePriceAdult`, etc. so we keep this local type that mirrors
// the backend's `GET /api/trips/{id}` response shape.
export type TripDetail = {
  trip: { id: string; departureAt: string; departureTime: string; arrivalTime: string; status: string }
  route: { name: string }
  brand: { id: string; name: string; accentColor: string; logoUrl: string | null }
  from: { name: string }
  to: { name: string }
  busLayout: { name: string; vehicleTypeLabel: string }
  pricing: { basePriceAdult: number; basePriceChild: number }
  pickupPoints: { id: string; name: string; stopOrder: number; etaOffsetMin: number }[]
  seatMap: {
    decks: { deck: number; rows: { row: number; seats: TripSeat[] }[] }[]
  }
}

export type PassengerType = 'adult' | 'child' | 'infant'
export type Gender = 'male' | 'female' | 'other'

// ── Zod schema ──────────────────────────────────────────────
// `age` uses `z.number()` (not `z.coerce.number()`) because the
// `<Input type="number">` onChange converts via `parseInt(... ) || 0`
// before calling `field.onChange`, so the form value is always a
// real `number`.
// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.
const tSync = (key: string) => translate(useApp.getState().lang, key)

export const passengerSchema = z.object({
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

// Auto-detect passenger type from age
export function getPassengerType(age: number): PassengerType {
  if (age < 2) return 'infant'
  if (age < 12) return 'child'
  return 'adult'
}

// `label` holds an i18n key (not display text) — render it with
// `t(PASSENGER_TYPE_META[type].label)`.
export const PASSENGER_TYPE_META: Record<
  PassengerType,
  { label: string; gradient: string; border: string; pill: string; text: string; icon: React.ReactNode }
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

// Selected seat row shape — used by the seat selector + passenger list.
export type SelectedSeat = {
  id: string
  code: string
  price: number
  class: string
}
