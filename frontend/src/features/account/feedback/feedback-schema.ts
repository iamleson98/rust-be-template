import { z } from 'zod'
import { tSync } from '@/lib/i18n'

export const feedbackSchema = z.object({
  rating: z
    .number()
    .min(1, { error: () => tSync('feedbackSchema.ratingRequired') })
    .max(5, { error: () => tSync('feedbackSchema.ratingMax') }),
  title: z
    .string()
    .trim()
    .max(255, { error: () => tSync('feedbackSchema.titleMax') }),
  content: z
    .string()
    .trim()
    .max(10000, { error: () => tSync('feedbackSchema.contentTooLong') })
    .refine((val) => val.length === 0 || val.length >= 20, {
      error: () => tSync('feedbackSchema.contentMin'),
    }),
  tags: z.array(z.string()).max(20, { error: () => tSync('feedbackSchema.tagsMax') }),
  photos: z.array(z.string()).max(10, { error: () => tSync('feedbackSchema.photosMax') }),
})

export type FeedbackValues = z.infer<typeof feedbackSchema>
