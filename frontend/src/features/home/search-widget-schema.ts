// Extracted from the original 'search-widget.tsx'.

import { z } from 'zod'
import { requiredText } from '@/lib/forms'

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
    from: requiredText('Điểm đi'),
    to: requiredText('Điểm đến'),
    date: requiredText('Ngày đi'),
    roundTrip: z.boolean(),
    returnDate: z.string(),
    adults: z.number().int().min(1, 'Phải có ít nhất 1 người lớn'),
    children: z.number().int().min(0),
    sort: z.enum(['departure', 'price', 'duration', 'rating']),
    vehicleTypes: z.array(z.string()),
  })
  .refine((d) => !d.roundTrip || d.returnDate !== '', {
    message: 'Vui lòng chọn ngày về cho chuyến khứ hồi',
    path: ['returnDate'],
  })
  .refine((d) => !d.roundTrip || d.returnDate >= d.date, {
    message: 'Ngày về phải sau ngày đi',
    path: ['returnDate'],
  })

export type SearchFormValues = z.infer<typeof searchSchema>
