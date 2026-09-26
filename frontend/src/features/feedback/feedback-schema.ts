/**
 * Zod schema + form types for the FeedbackForm.
 *
 * Extracted from the original 'feedback-form.tsx' so the form
 * orchestrator and the extracted field components can share the
 * same validation contract.
 */

import { z } from 'zod'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// Error messages use Zod's functional `{ error: () => ... }` form so the
// string is resolved (in the store's current language) at validation
// time, not at module load.
const tSync = (key: string) => translate(useApp.getState().lang, key)

/**
 * Zod schema for the review form.
 *   - rating 1-5 (required, must be > 0)
 *   - title ≤ 80 chars (optional)
 *   - content ≤ 2000 chars, ≥ 20 chars if non-empty (optional but recommended)
 *   - tags: optional array of strings
 *   - photos: optional array of data-URL/HTTP strings
 */
export const feedbackSchema = z.object({
  rating: z
    .number()
    .min(1, { error: () => tSync('feedbackSchema.ratingRequired') })
    .max(5, { error: () => tSync('feedbackSchema.ratingMax') }),
  title: z.string().trim().max(255, { error: () => tSync('feedbackSchema.titleMax') }),
  content: z
    .string()
    .trim()
    .max(10000, { error: () => tSync('feedbackSchema.contentTooLong') })
    .refine(
      (val) => val.length === 0 || val.length >= 20,
      { error: () => tSync('feedbackSchema.contentMin') },
    ),
  // Backend enforces max 20 tags + max 10 photos.
  tags: z.array(z.string()).max(20, { error: () => tSync('feedbackSchema.tagsMax') }),
  photos: z.array(z.string()).max(10, { error: () => tSync('feedbackSchema.photosMax') }),
})

export type FeedbackValues = z.infer<typeof feedbackSchema>
