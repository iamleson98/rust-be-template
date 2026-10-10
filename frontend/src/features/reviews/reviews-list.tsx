'use client'

import { useQuery } from '@tanstack/react-query'
import { reviewsListOptions, reviewsStatsOptions } from '@/api'
import { memo, useState } from 'react'
import { Loader2, MessageSquareQuote, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { NoReviewsYet } from '@/features/reviews/no-reviews-yet'
import { Lightbox } from '@/components/icons/lightbox'
import { type Review, ReviewCard } from './review-card'
import { ReviewSummary } from './review-summary'

type Props = {
  brandId: string
  /** Only this route's reviews in the list; else the whole brand's. */
  routeId?: string
  brandName: string
  routeName?: string
  accentColor?: string
}

const PAGE_SIZE = 5

/**
 * A brand's review summary (counted on the server) above the latest
 * reviews of one of its routes, or of the whole brand.
 */
export const ReviewsList = memo(function ReviewsList({
  brandId,
  routeId,
  brandName,
  routeName,
  accentColor = '#2563eb',
}: Props) {
  const t = useT()
  const [page, setPage] = useState(1)
  const [helpfulMap, setHelpfulMap] = useState<Record<string, boolean>>({})
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxImages, setLightboxImages] = useState<string[]>([])
  const [lightboxIdx, setLightboxIdx] = useState(0)

  const openLightbox = (images: string[], idx: number) => {
    setLightboxImages(images)
    setLightboxIdx(idx)
    setLightboxOpen(true)
  }

  // The latest reviews in scope. The backend serializes them with the
  // legacy field names (`content` / `photos` / `reply` / `tags`), hence the
  // local Review type.
  const scope = routeId ? { route_id: routeId } : { brand_id: brandId }
  const reviewsQuery = useQuery(reviewsListOptions({ query: { ...scope, limit: 20 } }))
  const reviews: Review[] = (reviewsQuery.data?.items ?? []) as unknown as Review[]

  // Exact totals from the server: the brand's summary, and how many
  // reviews the list's scope has (the list only fetches the latest 20).
  const brandStats = useQuery(reviewsStatsOptions({ query: { brand_id: brandId } }))
  const routeStats = useQuery({
    ...reviewsStatsOptions({ query: { route_id: routeId } }),
    enabled: !!routeId,
  })
  const total = (routeId ? routeStats.data : brandStats.data)?.count ?? reviews.length

  const loading = reviewsQuery.isLoading || brandStats.isLoading
  const isError = reviewsQuery.isError

  const totalPages = Math.max(1, Math.ceil(reviews.length / PAGE_SIZE))
  const pageReviews = reviews.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const markHelpful = (id: string) => {
    if (helpfulMap[id]) return
    setHelpfulMap((m) => ({ ...m, [id]: true }))
    // NOTE: We no longer mutate the cached query data directly — the
    // server-side helpfulCount will refresh on the next refetch. The
    // local `helpfulMap` flips the button state to give immediate UX
    // feedback.
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2" />
        <p className="text-sm">{t('reviews.loading')}</p>
      </div>
    )
  }

  if (isError && reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500 mb-2" />
        <p className="text-sm text-muted-foreground mb-3">{t('reviews.loadError')}</p>
        <Button size="sm" variant="outline" onClick={() => reviewsQuery.refetch()}>
          {t('payment.retry')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {brandStats.data && <ReviewSummary stats={brandStats.data} caption={brandName} />}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <NoReviewsYet />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <MessageSquareQuote className="h-4 w-4 text-amber-500" />
              {routeName
                ? t('reviews.reviewsForRoute', { count: total, route: routeName })
                : t('reviews.countLabel', { count: total })}
            </h4>
            <div className="text-xs text-muted-foreground">
              {t('reviews.pageIndicator', { page, totalPages })}
            </div>
          </div>
          <div className="space-y-3">
            {pageReviews.map((r) => (
              <ReviewCard
                key={r.id}
                r={r}
                accentColor={accentColor}
                brandName={brandName}
                helpfulMap={helpfulMap}
                markHelpful={markHelpful}
                openLightbox={openLightbox}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      <Lightbox
        open={lightboxOpen}
        images={lightboxImages}
        initialIndex={lightboxIdx}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  )
})
