// Extracted from the original 'search-widget.tsx'.

import { z } from 'zod'
import { requiredText } from '@/lib/forms'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.
const tSync = (key: string) => translate(useApp.getState().lang, key)

/**
 * Search-widget schema.
 *
 * Mirrors `SearchParams` from the store. We use `z.number()` (not
 * `z.coerce.number()`) for `adults` / `children` because the PAX
 * popover writes actual numbers via `field.onChange(next)` — there's
 * no string→number coercion needed at the zod layer, and using
 * `z.number()` keeps RHF's input/output types identical so
 * `form.watch` / `form.getValues` return `number` instead of
 * `unknown`. The two `.refine` calls encode the round-trip rules
 * that were previously inline `toast.error` checks in `doSearch`.
 */
export const searchSchema = z
  .object({
    from: requiredText('search.from'),
    to: requiredText('search.to'),
    date: requiredText('search.date'),
    roundTrip: z.boolean(),
    returnDate: z.string(),
    adults: z
      .number()
      .int()
      .min(1, { error: () => tSync('searchSchema.adultsMin') }),
    children: z.number().int().min(0),
    sort: z.enum(['departure', 'price', 'rating']),
    vehicleTypes: z.array(z.string()),
    // Smart-search coordinates (optional): set when the user picks a
    // precise place (autocomplete hit or map click) instead of a city.
    // All four present → the geo proximity search runs; otherwise the
    // plain city-to-city name search does.
    fromLat: z.number().optional(),
    fromLon: z.number().optional(),
    toLat: z.number().optional(),
    toLon: z.number().optional(),
    // City-level fallback names for precise picks (the place's province) —
    // used by buildSearchInput when only ONE end carries coordinates.
    fromCity: z.string().optional(),
    toCity: z.string().optional(),
  })
  .refine((d) => !d.roundTrip || d.returnDate !== '', {
    error: () => tSync('searchSchema.returnDateRequired'),
    path: ['returnDate'],
  })
  .refine((d) => !d.roundTrip || d.returnDate >= d.date, {
    error: () => tSync('searchSchema.returnDateAfter'),
    path: ['returnDate'],
  })

export type SearchFormValues = z.infer<typeof searchSchema>
