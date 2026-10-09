import { useState } from 'react'
import type { UseFormReturn } from 'react-hook-form'
import { FormField, FormItem, FormMessage } from '@/components/ui/form'
import { Star } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { FeedbackValues } from './feedback-schema'

export function FeedbackRatingField({
  form,
  accent,
}: {
  form: UseFormReturn<FeedbackValues>
  accent: string
}) {
  const t = useT()
  const [hoverRating, setHoverRating] = useState(0)
  const rating: number = form.watch('rating') ?? 0
  const displayRating = hoverRating || rating
  const ratingLabels = [
    '',
    t('feedbackForm.ratingVeryBad'),
    t('feedbackForm.ratingBad'),
    t('feedbackForm.ratingOk'),
    t('feedbackForm.ratingGood'),
    t('feedbackForm.ratingVeryGood'),
  ]
  const ratingEmojis = ['', '😣', '😕', '😐', '🙂', '🤩']

  return (
    <FormField
      control={form.control}
      name="rating"
      render={({ field }) => (
        <FormItem className="space-y-1.5">
          <div className="flex flex-col items-center gap-1.5 py-2 rounded-lg">
            <div className="text-3xl" aria-hidden>
              {ratingEmojis[displayRating] ?? '🚌'}
            </div>
            {/* Container-level hover: moving across stars (or the gaps
                between them) never fires leave→enter pairs, so the
                preview can't flicker. */}
            <div
              className="flex items-center gap-1.5"
              onMouseLeave={() => setHoverRating(0)}
              role="radiogroup"
              aria-label={t('feedbackForm.formTitle')}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  onMouseEnter={() => setHoverRating(n)}
                  onFocus={() => setHoverRating(n)}
                  onBlur={() => setHoverRating(0)}
                  onClick={() => field.onChange(n)}
                  className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={t('feedbackForm.rateAria', { count: n })}
                  aria-checked={rating === n}
                  role="radio"
                  type="button"
                >
                  <Star
                    className={`h-8 w-8 transition-colors ${
                      n <= displayRating
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-slate-100 text-slate-300'
                    }`}
                  />
                </button>
              ))}
            </div>
            {/* Stable node (no key-remount): swapping text in place
                instead of unmounting/remounting the span. */}
            <span className="text-sm font-semibold min-h-5" style={{ color: accent }}>
              {displayRating > 0 ? ratingLabels[displayRating] : ''}
            </span>
          </div>
          <FormMessage className="text-center" />
        </FormItem>
      )}
    />
  )
}
