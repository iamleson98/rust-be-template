'use client'

/**
 * FeedbackRatingField — the interactive 1–5 star rating control of the
 * feedback form (emoji + label feedback, hover preview, brand accent
 * on the label).
 *
 * Extracted from the original `feedback-form.tsx`. The hover state lives
 * in the parent (reset() clears it), so `hoverRating`/`setHoverRating`
 * + the watched `rating` are passed down.
 */

import type { UseFormReturn } from 'react-hook-form'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Star } from 'lucide-react'
import type { FeedbackValues } from './feedback-schema'

export function FeedbackRatingField({
  form,
  setHoverRating,
  hoverRating,
  rating,
  accent,
}: {
  form: UseFormReturn<FeedbackValues>
  setHoverRating: (rating: number) => void
  hoverRating: number
  rating: number
  accent: string
}) {
  const displayRating = hoverRating || rating
  const ratingLabels = ['', 'Rất tệ', 'Tệ', 'Bình thường', 'Tốt', 'Rất tốt']
  const ratingEmojis = ['', '😣', '😕', '😐', '🙂', '🤩']

  return (
            <FormField
              control={form.control}
              name="rating"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <div className="flex flex-col items-center gap-1.5 py-2 bg-linear-to-b from-amber-50/60 to-transparent rounded-lg">
                    <div className="text-3xl">{ratingEmojis[displayRating] ?? '🚌'}</div>
                    <div className="flex items-center gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          onMouseEnter={() => setHoverRating(n)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => field.onChange(n)}
                          className="transition-transform hover:scale-110"
                          aria-label={`Đánh giá ${n} sao`}
                          type="button"
                        >
                          <Star
                            className={`h-8 w-8 transition-colors ${n <= displayRating
                              ? 'fill-amber-400 text-amber-400 drop-'
                              : 'fill-slate-100 text-slate-300'
                              }`}
                          />
                        </button>
                      ))}
                    </div>
                    {displayRating > 0 && (
                      <span
                        key={displayRating}
                        className="text-sm font-semibold text-amber-600"
                        style={{ color: accent }}
                      >
                        {ratingLabels[displayRating]}
                      </span>
                    )}
                  </div>
                  <FormMessage className="text-center" />
                </FormItem>
              )}
            />
  )
}
