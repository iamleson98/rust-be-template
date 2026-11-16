import type { FieldErrors, Resolver } from 'react-hook-form'
import { tSync } from '@/lib/i18n'

/**
 * The search form's values: `SearchParams` from the store, as typed in the
 * form. `adults` / `children` are numbers (the passenger popover writes them
 * as such), the coordinates are all present when the customer picked precise
 * places and absent for a plain city search.
 */
export interface SearchFormValues {
  from: string
  to: string
  date: string
  /** Optional "leaving after" time, `HH:MM` or ''. */
  time: string
  roundTrip: boolean
  returnDate: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'rating' | 'distance'
  vehicleTypes: string[]
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  /** City-level fallback names for precise picks (the place's province). */
  fromCity?: string
  toCity?: string
}

/**
 * Checks a submitted search: the three places in the form must be filled in,
 * there is at least one adult, and a round trip comes back on or after the
 * day it leaves. Messages are resolved in the current language when they are
 * produced. Written by hand: the zod and resolver libraries would weigh more
 * than the page that shows this form.
 */
export const searchResolver: Resolver<SearchFormValues> = (values) => {
  const errors: FieldErrors<SearchFormValues> = {}
  const required = (name: 'from' | 'to' | 'date', label: string) => {
    if (values[name].trim() === '') {
      errors[name] = {
        type: 'too_small',
        message: tSync('validation.requiredLabel', { label: tSync(label) }),
      }
    }
  }
  required('from', 'search.from')
  required('to', 'search.to')
  required('date', 'search.date')
  if (!(values.adults >= 1)) {
    errors.adults = { type: 'too_small', message: tSync('searchSchema.adultsMin') }
  }
  if (values.roundTrip) {
    if (values.returnDate === '') {
      errors.returnDate = { type: 'custom', message: tSync('searchSchema.returnDateRequired') }
    } else if (values.returnDate < values.date) {
      errors.returnDate = { type: 'custom', message: tSync('searchSchema.returnDateAfter') }
    }
  }
  if (Object.keys(errors).length > 0) return { values: {}, errors }
  return {
    values: { ...values, from: values.from.trim(), to: values.to.trim(), date: values.date.trim() },
    errors: {},
  }
}
