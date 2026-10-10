import {
  Armchair,
  Clock,
  ShieldCheck,
  Smile,
  Sparkles,
  Star,
  Ticket,
  Wallet,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import type { ReviewStats } from '@/api'
import { REVIEW_TAG_LABELS } from '@/features/booking/history/booking-types'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const TAG_ICONS: Record<string, LucideIcon> = {
  on_time: Clock,
  clean: Sparkles,
  friendly_driver: Smile,
  comfortable: Armchair,
  safe_drive: ShieldCheck,
  value: Wallet,
  good_wifi: Wifi,
  easy_booking: Ticket,
}

/** Five stars, filled to the nearest half of `rating`. */
export function Stars({ rating, className = 'size-3.5' }: { rating: number; className?: string }) {
  const halves = Math.round(rating * 2)
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            className,
            n * 2 <= halves
              ? 'fill-amber-400 text-amber-400'
              : n * 2 - 1 === halves
                ? 'fill-amber-400/50 text-amber-400'
                : 'text-muted-foreground/30',
          )}
        />
      ))}
    </span>
  )
}

/**
 * What the approved reviews in a scope add up to, all counted on the
 * server: the average, how many gave each star, and the most mentioned
 * praise. Renders nothing until there is a review.
 */
export function ReviewSummary({ stats, caption }: { stats: ReviewStats; caption?: string }) {
  const t = useT()
  const average = stats.average
  if (stats.count === 0 || average == null) return null

  return (
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <div className="flex flex-col items-center justify-center text-center sm:border-r sm:pr-4">
          <div className="text-4xl font-bold text-amber-600 tabular-nums">{average.toFixed(1)}</div>
          <Stars rating={average} className="size-4" />
          <div className="mt-1 text-xs text-muted-foreground">
            {t('reviews.countLabel', { count: stats.count.toLocaleString('vi-VN') })}
          </div>
          {caption && <div className="text-[11px] text-muted-foreground">{caption}</div>}
        </div>
        <ul className="space-y-1.5" aria-label={t('reviews.ratingDistribution')}>
          {[5, 4, 3, 2, 1].map((star) => {
            const n = stats.byRating[star - 1] ?? 0
            return (
              <li key={star} className="flex items-center gap-2 text-xs">
                <span className="flex w-7 shrink-0 items-center gap-0.5 text-muted-foreground">
                  {star}
                  <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${(n / stats.count) * 100}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-muted-foreground tabular-nums">
                  {n}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      {stats.topTags.length > 0 && (
        <div className="border-t pt-3">
          <h4 className="mb-2 text-sm font-semibold">{t('reviews.topPraisedTitle')}</h4>
          <ul className="flex flex-wrap gap-2">
            {stats.topTags.map(({ tag, count }) => {
              const Icon = TAG_ICONS[tag] ?? Star
              const label = REVIEW_TAG_LABELS[tag] ? t(REVIEW_TAG_LABELS[tag].labelKey) : tag
              return (
                <li
                  key={tag}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  <Icon className="size-3.5 text-primary" aria-hidden />
                  {label}
                  <span className="text-muted-foreground tabular-nums">
                    {t('reviews.mentionCount', { count })}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
