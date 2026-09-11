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

export type Frequency = 'immediate' | 'daily' | 'weekly'

export const priceAlertSchema = z.object({
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email không hợp lệ',
    ),
  targetPrice: z.coerce.number().positive('Mức giá mục tiêu phải lớn hơn 0'),
  frequency: z.enum(['immediate', 'daily', 'weekly']),
})
export type PriceAlertFormValues = z.infer<typeof priceAlertSchema>

/**
 * The dialog's `useForm` instance type (input ≠ output because of the
 * `z.coerce.number()` on targetPrice) — shared with the extracted
 * field components.
 */
export type PriceAlertForm = UseFormReturn<z.input<typeof priceAlertSchema>, unknown, z.output<typeof priceAlertSchema>>
