'use client'

/**
 * Testimonials — homepage social-proof section.
 *
 * Rewritten to render REAL reviews from `GET /api/reviews` (latest,
 * platform-wide) instead of the previously hardcoded fake personas,
 * fabricated quotes, invented "verified" claims and a made-up
 * "4.8 / ~125.000 reviews" aggregate. When the API returns nothing
 * (or fails) the section simply doesn't render — no fake fallback.
 */

import { memo } from 'react'
import { Star, Quote, ThumbsUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import { useLatestReviews } from '@/lib/queries'
import type { ReviewOut } from '@/lib/api/types.gen'
import { formatDateTimeVN } from '@/lib/types'
import { TestimonialsSkeleton } from '@/features/home/components/testimonials-skeleton'

/* Generate initials from a Vietnamese name */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return parts[parts.length - 2][0] + parts[parts.length - 1][0]
  }
  return parts[0]?.[0] ?? '?'
}

const avatarColors = ['bg-blue-500', 'bg-blue-600', 'bg-blue-700']

/* Deterministic color from name */
function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

const StarRating = memo(function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating}/5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 transition-colors ${
            i < rating ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'
          }`}
        />
      ))}
    </div>
  )
})

export const Testimonials = memo(function Testimonials() {
  const t = useT()
  const { data, isLoading } = useLatestReviews(6)
  const items: ReviewOut[] = data?.items ?? []

  if (isLoading) {
    return <TestimonialsSkeleton count={3} />
  }

  // Real data only — hide the whole section when there is nothing to show.
  if (items.length === 0) return null

  return (
    <section className="relative bg-white">
      <div className="container mx-auto px-4 py-16">
        {/* Subtle background pattern */}
        <div
          className="absolute inset-0 -z-10 opacity-[0.03]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, oklch(0.556 0.13 250) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Section header */}
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
            {t('home.testimonialsBadge')}
          </div>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">
            {t('home.testimonialsTitle')}
          </h2>
          <p className="text-muted-foreground mt-3">{t('home.testimonialsSubtitle')}</p>
        </div>

        {/* Review cards — manual horizontal scroll with snap (mobile-first;
            auto-scroll carousels fight the reader's own pace). */}
        <div
          className="flex gap-5 overflow-x-auto pb-2 snap-x snap-mandatory scrollbar-hide"
          style={{ scrollbarWidth: 'none' }}
        >
          {items.map((item) => {
            const author = item.authorName ?? t('home.anonymousReviewer')
            return (
              <div key={item.id} className="snap-start shrink-0 w-75 sm:w-85">
                <Card className="group h-full border-slate-100 relative overflow-hidden">
                  {/* Quote mark decoration */}
                  <Quote className="absolute -top-2 -right-2 h-16 w-16 text-blue-50 rotate-0 group-hover:text-blue-100 transition-colors" />
                  {/* Top gradient stripe (subtle) */}
                  <div className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-blue-400 via-blue-400 to-amber-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                  <CardContent className="p-5 relative">
                    {/* Top row: avatar + name + date */}
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className={`h-10 w-10 shrink-0 rounded-full ${getAvatarColor(author)} flex items-center justify-center text-white text-sm font-bold`}
                        aria-hidden
                      >
                        {getInitials(author)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-sm truncate">{author}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatDateTimeVN(item.createdAt)}
                        </div>
                      </div>
                    </div>

                    <StarRating rating={item.rating} />

                    {item.content && (
                      <p className="text-sm text-muted-foreground mt-2 leading-relaxed line-clamp-4">
                        {item.content}
                      </p>
                    )}

                    {item.helpfulCount > 0 && (
                      <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                        <ThumbsUp className="h-3 w-3" />
                        {item.helpfulCount}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
})
