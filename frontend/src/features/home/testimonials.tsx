import { memo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Star } from 'lucide-react'
import { reviewsListOptions } from '@/api'
import { formatDay } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { HomeSection, RAIL, RailSkeleton } from './section'

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/)
  return (
    parts.length >= 2 ? parts.at(-2)![0] + parts.at(-1)![0] : (parts[0]?.[0] ?? '?')
  ).toUpperCase()
}

/** The latest real reviews (`GET /api/reviews`); nothing at all while there are none. */
export const Testimonials = memo(function Testimonials() {
  const t = useT()
  const { data, isLoading } = useQuery(reviewsListOptions({ query: { limit: 6 } }))
  const items = data?.items ?? []

  if (isLoading) return <RailSkeleton count={3} cols="lg:grid-cols-3" />
  if (items.length === 0) return null

  return (
    <HomeSection title={t('home.testimonialsTitle')} subtitle={t('home.testimonialsSubtitle')}>
      <div className={cn(RAIL, 'lg:grid-cols-3')}>
        {items.map((item) => {
          const author = item.authorName ?? t('home.anonymousReviewer')
          return (
            <figure
              key={item.id}
              className="flex flex-col rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80"
            >
              <div className="flex items-center gap-0.5" aria-label={`${item.rating}/5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={cn(
                      'size-4',
                      i < item.rating
                        ? 'fill-amber-400 text-amber-400'
                        : 'fill-slate-200 text-slate-200',
                    )}
                  />
                ))}
              </div>
              {item.content && (
                <blockquote className="mt-3 line-clamp-4 text-sm leading-relaxed text-slate-700">
                  {item.content}
                </blockquote>
              )}
              <figcaption className="mt-auto flex items-center gap-3 pt-4">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary"
                  aria-hidden
                >
                  {initials(author)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {author}
                  </span>
                  <span className="block text-xs text-slate-500">{formatDay(item.createdAt)}</span>
                </span>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </HomeSection>
  )
})
