// Extracted from the original 'cancel-dialog.tsx'.

import { z } from 'zod'

export const CANCEL_REASONS = [
  { key: 'change', labelKey: 'cancel.reason.change' },
  { key: 'cheaper', labelKey: 'cancel.reason.cheaper' },
  { key: 'tripCancel', labelKey: 'cancel.reason.tripCancel' },
  { key: 'other', labelKey: 'cancel.reason.other' },
] as const

export type Step = 1 | 2 | 3

/**
 * Zod schema for the cancel-dialog form.
 *   - selectedReason: required (one of CANCEL_REASONS keys)
 *   - otherReason:    optional, max 500 chars; required (min 10) when reason==='other'
 *   - agreed:         required true (only validated on step 2)
 *
 * Step-aware validation is handled manually with form.trigger + setError,
 * so step-1 submission doesn't surface the "agreed" error from step 2.
 */
export const cancelSchema = z.object({
  selectedReason: z.string().min(1, 'Vui lòng chọn lý do huỷ vé'),
  otherReason: z.string().trim().max(500, 'Lý do huỷ vé tối đa 500 ký tự'),
  agreed: z.boolean(),
})

export type CancelValues = z.infer<typeof cancelSchema>
