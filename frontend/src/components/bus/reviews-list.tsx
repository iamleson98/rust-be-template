'use client'

import { memo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReviewsByRoute } from '@/lib/queries'
import { apiJson } from '@/lib/api-client'
import {
  Star,
  ThumbsUp,
  Loader2,
  MessageSquareQuote,
  ChevronLeft,
  ChevronRight,
  Quote,
  Clock,
  Sparkles,
  Smile,
  Armchair,
  ShieldCheck,
  Wallet,
  Wifi,
  Snowflake,
  Ticket as TicketIcon,
  Images,
  AlertCircle,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatDateTimeVN } from '@/lib/types'
import { NoReviewsYet } from './empty-states'
import { Lightbox } from './lightbox'

type Review = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  photos?: string[]
  authorName: string
  helpfulCount: number
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

type Aggregate = {
  avgRating: number
  count: number
  distribution: number[] // length 5, index 0 = 1-star
}

type TagStat = {
  tag: string
  label: string
  emoji: string
  count: number
  percentage: number
}

const TAG_LABELS: Record<string, { label: string; emoji: string }> = {
  on_time: { label: 'Đúng giờ', emoji: '⏱️' },
  clean: { label: 'Sạch sẽ', emoji: '✨' },
  friendly_driver: { label: 'Tài xế thân thiện', emoji: '😊' },
  comfortable: { label: 'Thoải mái', emoji: '🛋️' },
  value: { label: 'Đáng đồng tiền', emoji: '💰' },
  easy_booking: { label: 'Đặt dễ', emoji: '🎟️' },
  good_wifi: { label: 'Wifi mạnh', emoji: '📶' },
  safe_drive: { label: 'Lái xe an toàn', emoji: '🛡️' },
}

// Icon mapping for tag stats — keys aligned to actual DB tag keys.
const TAG_ICONS: Record<string, LucideIcon> = {
  on_time: Clock,
  clean: Sparkles,
  friendly_driver: Smile,
  comfortable: Armchair,
  safe_drive: ShieldCheck,
  value: Wallet,
  good_wifi: Wifi,
  ac: Snowflake,
  easy_booking: TicketIcon,
}

type Props = {
  brandId: string
  routeId: string
  brandName: string
  routeName: string
  accentColor?: string
}

const PAGE_SIZE = 5

/**
 * Aggregate response shape returned by `/api/reviews?brandId=X&aggregate=1`.
 * The backend computes avg + 5-bucket distribution across ALL published
 * reviews for the brand (not just the first 20).
 */
type BrandAggregateResponse = {
  avgRating: number
  count: number
  distribution: number[]
  tags?: Record<string, unknown>
}

/**
 * Tag-stats response shape returned by `/api/reviews/tags?routeId=Y`.
 */
type TagStatsResponse = { items: TagStat[] }

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
  // Fetched from a separate endpoint because the list endpoint returns
  // only the first 20 rows — not enough to compute an accurate mean.
  const aggregateQuery = useQuery<BrandAggregateResponse>({
    queryKey: ['reviews', 'aggregate', 'brand', brandId],
    queryFn: () => apiJson(`/api/reviews?brandId=${encodeURIComponent(brandId)}&aggregate=1`),
    enabled: !!brandId,
    staleTime: 60 * 1000,
  })
  const aggregate: Aggregate | null = aggregateQuery.data
    ? {
      avgRating: aggregateQuery.data.avgRating,
      count: aggregateQuery.data.count,
      distribution: aggregateQuery.data.distribution,
    }
    : null

  // ── Tag aggregate (route-scoped) ────────────────────────
  // Top praised features for this specific route. Used to render the
  // "Đặc điểm được khen nhiều" section above the review list.
  const tagStatsQuery = useQuery<TagStatsResponse>({
    queryKey: ['reviews', 'tags', 'route', routeId],
    queryFn: () => apiJson(`/api/reviews/tags?routeId=${encodeURIComponent(routeId)}`),
    enabled: !!routeId,
    staleTime: 60 * 1000,
  })
  const tagStats: TagStat[] = tagStatsQuery.data?.items ?? []

  // Total review count — prefer the backend's `total` field (it counts all
  // matching reviews, not just the first 20). Fall back to the items length
  // if the field is missing.
  const total = reviewsQuery.data?.total ?? reviews.length

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
              <div
                key={r.id}
                className="rounded-xl bg-white ring-1 ring-black/5 p-4"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="h-10 w-10 rounded-full text-white inline-flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)` }}
                  >
                    {r.authorName?.slice(0, 1).toUpperCase() ?? 'A'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.authorName}</span>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star
                            key={n}
                            className={`h-3 w-3 ${n <= r.rating
                                ? 'fill-amber-400 text-amber-400'
                                : 'fill-slate-200 text-slate-200'
                              }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">{formatDateTimeVN(r.createdAt)}</span>
                    </div>
                    {r.title && <div className="font-medium text-sm mt-1">{r.title}</div>}
                    {r.content && (
                      <div className="text-sm text-muted-foreground mt-1 leading-relaxed">
                        <Quote className="inline h-3 w-3 mr-1 text-slate-400" />
                        {r.content}
                      </div>
                    )}
                    {r.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.tags.map((t) => {
                          const tl = TAG_LABELS[t]
                          return (
                            <Badge key={t} variant="outline" className="text-[10px] gap-1 bg-slate-50 font-normal">
                              {tl?.emoji ?? '🏷️'} {tl?.label ?? t}
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                    {r.photos && r.photos.length > 0 && (
                      <ReviewPhotoGrid
                        photos={r.photos}
                        onOpen={(i) => openLightbox(r.photos!, i)}
                      />
                    )}
                    {r.reply && (
                      <div className="mt-3 ml-3 pl-3 border-l-2 space-y-1" style={{ borderColor: accentColor }}>
                        <div className="text-xs font-semibold flex items-center gap-1">
                          <span className="inline-flex h-5 w-5 rounded-full items-center justify-center text-[10px] text-white" style={{ background: accentColor }}>
                            {brandName.slice(0, 1)}
                          </span>
                          Phản hồi từ {brandName}
                        </div>
                        <p className="text-xs text-muted-foreground">{r.reply}</p>
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => markHelpful(r.id)}
                        disabled={helpfulMap[r.id]}
                        className={`inline-flex items-center gap-1 text-xs transition-colors ${helpfulMap[r.id] ? 'text-blue-600 cursor-default' : 'text-muted-foreground hover:text-blue-600'
                          }`}
                      >
                        <ThumbsUp className={`h-3 w-3 ${helpfulMap[r.id] ? 'fill-blue-100' : ''}`} />
                        Hữu ích ({r.helpfulCount})
                      </button>
                    </div>
                  </div>
                </div>
              </div>
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

// ── Photo grid inside a review (max 4 thumbnails,"+N more"overlay) ──
function ReviewPhotoGrid({ photos, onOpen }: { photos: string[]; onOpen: (i: number) => void }) {
  const visible = photos.slice(0, 4)
  const hiddenCount = photos.length - visible.length
  return (
    <div className="mt-3">
      <button
        onClick={() => onOpen(0)}
        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 mb-2"
      >
        <Images className="h-3.5 w-3.5" />
        Xem ảnh ({photos.length})
      </button>
      <div className="grid grid-cols-4 gap-1.5 max-w-70">
        {visible.map((src, i) => (
          <button
            key={i}
            onClick={() => onOpen(i)}
            className="relative aspect-square rounded-md overflow-hidden ring-1 ring-black/5 hover:ring-2 hover:ring-blue-400 transition-all group"
          >
            <img src={src} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover transition-transform" loading="lazy" decoding="async" />
            {i === 3 && hiddenCount > 0 && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-xs font-bold">
                +{hiddenCount}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Tag aggregate stats section ("Đặc điểm được khen nhiều") ──
function TagStatsSection({ tagStats, accentColor }: { tagStats: TagStat[]; accentColor: string }) {
  return (
    <div
      className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-4"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <h4 className="text-sm font-semibold text-blue-800">Đặc điểm được khen nhiều</h4>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Top {tagStats.length} nổi bật nhất
        </span>
      </div>
      <div className="space-y-2.5">
        {tagStats.map((t, idx) => {
          const Icon = TAG_ICONS[t.tag] ?? Star
          return (
            <div
              key={t.tag}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-1.5 w-40 sm:w-48 shrink-0">
                <div
                  className="h-7 w-7 rounded-md flex items-center justify-center text-white shrink-0"
                  style={{ background: accentColor }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground">{t.count} lượt nhắc</div>
                </div>
              </div>
              <div className="flex-1 h-2.5 bg-white/70 rounded-full overflow-hidden ring-1 ring-blue-100">
                <div
                  className="h-full rounded-full"
                  style={{
                    background: `linear-gradient(90deg, ${accentColor}, ${accentColor}cc)`,
                  }}
                />
              </div>
              <span className="text-xs font-bold tabular-nums w-10 text-right" style={{ color: accentColor }}>
                {t.percentage}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
