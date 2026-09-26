/**
 * Zod schema + form types for the PriceAlertDialog.
 *
 * Extracted from the original 'price-alert-dialog.tsx' so the dialog
 * and the extracted field components can share the same validation
 * contract + form-instance type.
 */

import type { UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { phoneSchema } from '@/lib/forms'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.
const tSync = (key: string) => translate(useApp.getState().lang, key)

export type Frequency = 'immediate' | 'daily' | 'weekly'

export const priceAlertSchema = z.object({
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      { error: () => tSync('validation.email') },
    ),
  targetPrice: z.coerce
    .number()
    .positive({ error: () => tSync('priceAlertSchema.targetPricePositive') }),
  frequency: z.enum(['immediate', 'daily', 'weekly']),
})
export type PriceAlertFormValues = z.infer<typeof priceAlertSchema>

/**
 * The dialog's `useForm` instance type (input ≠ output because of the
 * `z.coerce.number()` on targetPrice) — shared with the extracted
 * field components.
 */
export type PriceAlertForm = UseFormReturn<z.input<typeof priceAlertSchema>, unknown, z.output<typeof priceAlertSchema>>
