'use client'

import { memo, useState } from 'react'
import { useReviewsByRoute, useReviewsByBrand, useReviewTags } from '@/lib/queries'
import {
  Star,
  Loader2,
  MessageSquareQuote,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { NoReviewsYet } from '@/features/reviews/no-reviews-yet'
import { Lightbox } from '@/components/icons/lightbox'
import { type Review, ReviewCard } from './review-card'
import { type TagStat, TagStatsSection } from './tag-stats-section'

type Aggregate = {
  avgRating: number
  count: number
  distribution: number[] // length 5, index 0 = 1-star
}

type Props = {
  brandId: string
  routeId: string
  brandName: string
  routeName: string
  accentColor?: string
}

const PAGE_SIZE = 5

/** Compute the 5-bucket distribution from raw review items. */
function computeDistribution(reviews: { rating?: number }[]): number[] {
  const dist = [0, 0, 0, 0, 0]
  for (const r of reviews) {
    if (typeof r.rating !== 'number') continue
    const idx = Math.max(0, Math.min(4, r.rating - 1))
    dist[idx] += 1
  }
  return dist
}

export const ReviewsList = memo(function ReviewsList({ brandId, routeId, brandName, routeName, accentColor = '#2563eb' }: Props) {
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

  // ── Reviews list (route-scoped) ─────────────────────────
  // The centralized hook returns ReviewItem[] (the typed shape used by the
  // rest of the app), but the backend serializes reviews with the legacy
  // field names (`content` / `photos` / `reply` / `tags`). We cast the
  // response to our local Review type so the renderer can access those
  // fields without touching the centralized type definition.
  const reviewsQuery = useReviewsByRoute(routeId)
  const reviews: Review[] = (reviewsQuery.data?.items ?? []) as unknown as Review[]

  // ── Brand-wide aggregate (avg + 5-bucket distribution) ──
  // Backend `GET /api/reviews` returns `{ items: [...] }` — no aggregate
  // shape. We compute the avg + distribution client-side from the items
  // we fetched. (The previous `?aggregate=1` query param was ignored by
  // the backend and the response shape was wrong anyway.)
  const aggregateQuery = useReviewsByBrand(brandId)
  const aggregate: Aggregate | null = aggregateQuery.data
    ? {
      avgRating:
        aggregateQuery.data.items && aggregateQuery.data.items.length > 0
          ? aggregateQuery.data.items.reduce((s, r) => s + (r.rating ?? 0), 0) /
            aggregateQuery.data.items.length
          : 0,
      count: aggregateQuery.data.items?.length ?? 0,
      distribution: computeDistribution(aggregateQuery.data.items ?? []),
    }
    : null

  // ── Tag aggregate (route-scoped) ────────────────────────
  // Top praised features for this specific route. Backend `GET /api/reviews/tags`
  // takes NO params — returns the global tag index. We filter client-side
  // by routeId if the items carry it.
  const tagStatsQuery = useReviewTags()
  const tagStats: TagStat[] = ((tagStatsQuery.data as any)?.items ?? []).filter(
    (t: any) => !('routeId' in t) || t.routeId === routeId,
  )

  // Total review count — the backend's ReviewListResponse only has `items`
  // (no `total` field). Fall back to the items length.
  const total = reviews.length

  const loading = reviewsQuery.isLoading || aggregateQuery.isLoading
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
        <p className="text-sm">Đang tải đánh giá...</p>
      </div>
    )
  }

  if (isError && reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500 mb-2" />
        <p className="text-sm text-muted-foreground mb-3">Không thể tải đánh giá</p>
        <Button size="sm" variant="outline" onClick={() => reviewsQuery.refetch()}>
          Thử lại
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Aggregate header */}
      {aggregate && aggregate.count > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4 p-4 rounded-xl bg-linear-to-br from-amber-50 to-orange-50 ring-1 ring-amber-200/50">
          <div className="flex flex-col items-center justify-center text-center md:border-r md:border-amber-200/50">
            <div className="text-5xl font-extrabold text-amber-600 tabular-nums">
              {aggregate.avgRating.toFixed(1)}
            </div>
            <div className="flex items-center gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  className={`h-4 w-4 ${n <= Math.round(aggregate.avgRating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'fill-slate-200 text-slate-200'
                    }`}
                />
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {aggregate.count.toLocaleString('vi-VN')} đánh giá
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{brandName}</div>
          </div>
          <div className="space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Phân bố sao
            </div>
            {[5, 4, 3, 2, 1].map((star) => {
              const count = aggregate.distribution[star - 1] ?? 0
              const pct = aggregate.count > 0 ? Math.round((count / aggregate.count) * 100) : 0
              return (
                <div key={star} className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 w-10">
                    <span className="text-xs text-muted-foreground">{star}</span>
                    <Star className="h-3 w-3 fill-amber-300 text-amber-300" />
                  </div>
                  <Progress value={pct} className="h-2 flex-1" />
                  <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tag aggregate stats —"Đặc điểm được khen nhiều"*/}
      {tagStats.length > 0 && (
        <TagStatsSection tagStats={tagStats.slice(0, 5)} accentColor={accentColor} />
      )}

      {/* Reviews list */}
      {reviews.length === 0 ? (
        <NoReviewsYet />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <MessageSquareQuote className="h-4 w-4 text-amber-500" />
              {total} đánh giá cho tuyến {routeName}
            </h4>
            <div className="text-xs text-muted-foreground">Trang {page}/{totalPages}</div>
          </div>
          <div className="space-y-3">
            {pageReviews.map((r, idx) => (
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
              <span className="text-sm text-muted-foreground tabular-nums">{page} / {totalPages}</span>
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
