'use client'

/**
 * Account — Feedback history page (`/account/feedback`).
 *
 * The user-facing feedback surface:
 *   1. "Chưa đánh giá" — rides the user actually took (completed /
 *      past-departure bookings) that have no review yet. Each card has
 *      a star-CTA that expands the full FeedbackForm inline.
 *   2. "Đã gửi" — the feedback the user already submitted
 *      (server-side paginated via `GET /api/reviews/mine`), with
 *      moderation status + the brand's reply.
 *
 * UX goals (from the product spec): beautiful, snappy, "make the user
 * happy when giving feedback" — amber star pops, hover previews with
 * emoji + label, gradient hero stats, structure-matched skeletons
 * while loading (never a blank-white spinner).
 */
import { lazy, Suspense, useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/currency'
import { useMyBookings, useMyReviews } from '@/lib/queries'
import { useApp } from '@/lib/store'
import { isBookingReviewable, type BookingItem, type ReviewItem } from '@/components/bookings/booking-types'
import { StarRating } from '@/components/feedback/star-rating'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowRight,
  Bus,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  MessageSquareHeart,
  PartyPopper,
  Pencil,
  Star,
} from 'lucide-react'

const FeedbackForm = lazy(() =>
  import('@/components/feedback/feedback-form').then((m) => ({ default: m.FeedbackForm })),
)
const FeedbackFormFallback = <div className="h-32 animate-pulse rounded-lg bg-slate-100" />

/** Page size for the "sent feedback" list (server-side pagination). */
const PAGE_SIZE = 8

/* ── Moderation status badges ─────────────────────────────────── */
const REVIEW_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Chờ duyệt', cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/20' },
  approved: { label: 'Đã hiển thị', cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/20' },
  rejected: { label: 'Bị từ chối', cls: 'bg-rose-500/10 text-rose-600 ring-rose-500/20' },
  hidden: { label: 'Đã ẩn', cls: 'bg-slate-500/10 text-slate-600 ring-slate-500/20' },
}

/* ── Date helpers ─────────────────────────────────────────────── */
function formatDeparture(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/* ── Section: ride awaiting feedback ──────────────────────────── */
function PendingRideCard({
  booking,
  expanded,
  onToggle,
  onSubmitted,
}: {
  booking: BookingItem
  expanded: boolean
  onToggle: () => void
  onSubmitted: () => void
}) {
  const trip = booking.trip
  return (
    <Card className="group ring-1 ring-black/5 overflow-hidden transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left px-4 py-3.5 flex items-center gap-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <div
          className="size-11 shrink-0 rounded-xl grid place-items-center text-white font-bold"
          style={{ background: `linear-gradient(135deg, ${trip?.brandAccent || '#2563eb'}, ${trip?.brandAccent || '#2563eb'}cc)` }}
          aria-hidden
        >
          <Bus className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold truncate">
            <span>{trip?.routeName || 'Chuyến đi'}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 truncate">
              <CalendarDays className="size-3" />
              {formatDeparture(trip?.departureAt || booking.createdAt)}
            </span>
            {trip?.brandName && <span className="truncate">{trip.brandName}</span>}
            <span className="inline-flex items-center gap-1 shrink-0">
              <Star className="size-3 text-amber-500" />
              {booking.seats.length} ghế
            </span>
          </div>
        </div>
        <div className="hidden sm:block text-sm font-semibold tabular-nums">
          {formatCurrency(booking.total, 'VND')}
        </div>
        <span
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 ring-1 ring-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-600 transition-colors group-hover:bg-amber-500/15"
        >
          <MessageSquareHeart className="size-3.5" />
          Đánh giá ngay
        </span>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <Suspense fallback={FeedbackFormFallback}>
            <FeedbackForm booking={booking} existingReview={null} onSubmitted={onSubmitted} onClose={onToggle} />
          </Suspense>
        </div>
      )}
    </Card>
  )
}

/* ── Section: submitted feedback card ─────────────────────────── */
function SentFeedbackCard({
  review,
  booking,
  onEdit,
  editing,
  onEdited,
}: {
  review: ReviewItem
  booking?: BookingItem
  onEdit: () => void
  editing: boolean
  onEdited: () => void
}) {
  const status = REVIEW_STATUS[review.status] ?? REVIEW_STATUS.pending
  const canEdit = !!booking && review.status !== 'approved'
  return (
    <Card className="ring-1 ring-black/5 overflow-hidden transition-shadow hover:shadow-md">
      <div className="px-4 py-4 space-y-3">
        {/* Ride context line */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 text-sm">
            <div
              className="size-8 shrink-0 rounded-lg grid place-items-center"
              style={{ background: `linear-gradient(135deg, ${booking?.trip?.brandAccent || '#2563eb'}22, ${booking?.trip?.brandAccent || '#2563eb'}11)` }}
              aria-hidden
            >
              <Bus className="size-4" style={{ color: booking?.trip?.brandAccent || '#2563eb' }} />
            </div>
            <div className="min-w-0">
              <div className="font-semibold truncate">
                {booking?.trip?.routeName || review.title || 'Chuyến đi'}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {booking?.trip?.brandName} · {formatDeparture(booking?.trip?.departureAt || review.createdAt)}
              </div>
            </div>
          </div>
          <span className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${status.cls}`}>
            {status.label}
          </span>
        </div>

        {/* Stars + content */}
        <div className="flex items-start justify-between gap-3">
          <StarRating value={review.rating} />
          {canEdit && !editing && (
            <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 gap-1.5 text-xs text-muted-foreground">
              <Pencil className="size-3" /> Sửa
            </Button>
          )}
        </div>
        {review.content && (
          <p className="text-sm leading-relaxed text-foreground/90 line-clamp-4">{review.content}</p>
        )}
        {(review.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {review.tags.slice(0, 6).map((t) => (
              <Badge key={t} variant="secondary" className="text-[11px] font-normal">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* Brand reply */}
        {review.reply && (
          <div className="rounded-lg rounded-tl-sm border-l-2 border-primary/50 bg-primary/5 px-3.5 py-2.5">
            <div className="text-[11px] font-semibold text-primary">
              {booking?.trip?.brandName || 'Nhà xe'} đã phản hồi
            </div>
            <p className="mt-0.5 text-sm text-foreground/80">{review.reply}</p>
          </div>
        )}
      </div>

      {editing && booking && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <Suspense fallback={FeedbackFormFallback}>
            <FeedbackForm
              booking={booking}
              existingReview={review as any}
              onSubmitted={onEdited}
              onClose={onEdit}
            />
          </Suspense>
        </div>
      )}
    </Card>
  )
}

/* ── Skeletons (structure-matched, never a white flash) ────────── */
function PendingRideSkeleton() {
  return (
    <Card className="ring-1 ring-black/5 overflow-hidden" aria-hidden>
      <div className="px-4 py-3.5 flex items-center gap-4">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
    </Card>
  )
}

function SentFeedbackSkeleton() {
  return (
    <Card className="ring-1 ring-black/5 overflow-hidden" aria-hidden>
      <div className="px-4 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-8 rounded-lg" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
    </Card>
  )
}

/* ── Page ─────────────────────────────────────────────────────── */
export function AccountFeedbackContent() {
  const { currency } = useApp()
  const [tab, setTab] = useState<'pending' | 'sent'>('pending')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  // The user's rides + submitted reviews. Both are cheap list queries
  // with keepPreviousData, so tab switches and pagination feel snappy.
  const { data: bookingsData, isLoading: bookingsLoading, refetch: refetchBookings } = useMyBookings('past')
  const { data: reviewsData, isLoading: reviewsLoading, refetch: refetchReviews } = useMyReviews({
    enabled: true,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const bookings: BookingItem[] = (bookingsData?.items ?? []) as unknown as BookingItem[]
  const reviews: ReviewItem[] = (reviewsData?.items ?? []) as unknown as ReviewItem[]
  const total = reviewsData?.total ?? 0

  // Rides taken but not yet reviewed → the "pending" tab.
  const reviewedBookingIds = useMemo(
    () => new Set(reviews.map((r) => r.bookingId).filter(Boolean)),
    [reviews],
  )
  const pendingBookings = useMemo(
    () => bookings.filter((b) => isBookingReviewable(b) && !reviewedBookingIds.has(b.id)),
    [bookings, reviewedBookingIds],
  )

  // Booking lookup for editing a submitted review.
  const bookingById = useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings])

  const refetchBoth = () => {
    void refetchBookings()
    void refetchReviews()
  }

  // Stats hero.
  const avgGiven = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0
  const approvedCount = reviews.filter((r) => r.status === 'approved').length

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const canPrev = page > 0
  const canNext = page < pages - 1

  return (
    <div className="p-3 md:p-6 space-y-5">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-blue-600 via-blue-700 to-indigo-700 text-white px-5 py-6 md:px-7 md:py-7">
        <div
          className="pointer-events-none absolute -right-8 -top-10 text-[10rem] leading-none opacity-[0.12] select-none"
          aria-hidden
        >
          🚌
        </div>
        <div className="relative">
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2.5">
            <MessageSquareHeart className="size-6 text-amber-300" />
            Chuyến đi của bạn thế nào?
          </h1>
          <p className="mt-1.5 text-sm text-blue-100 max-w-xl">
            Chia sẻ trải nghiệm của bạn để giúp các nhà xe phục vụ tốt hơn —
            và giúp hàng nghìn hành khách khác chọn đúng chuyến xe.
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <div className="flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur px-3.5 py-1.5 text-sm">
              <Star className="size-4 fill-amber-300 text-amber-300" />
              <span className="font-semibold tabular-nums">
                {avgGiven > 0 ? avgGiven.toFixed(1) : '—'}
              </span>
              <span className="text-blue-100">/ 5 trung bình</span>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 backdrop-blur px-3.5 py-1.5 text-sm">
              <PartyPopper className="size-4 text-amber-300" />
              <span className="font-semibold tabular-nums">{total}</span>
              <span className="text-blue-100">phản hồi đã gửi</span>
            </div>
            {approvedCount > 0 && (
              <div className="flex items-center gap-2 rounded-full bg-emerald-400/15 ring-1 ring-emerald-300/25 backdrop-blur px-3.5 py-1.5 text-sm">
                <Star className="size-4 fill-emerald-300 text-emerald-300" />
                <span className="font-semibold tabular-nums">{approvedCount}</span>
                <span className="text-emerald-100">được hiển thị công khai</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'sent')}>
        <TabsList className="h-10 rounded-lg bg-muted p-1">
          <TabsTrigger
            value="pending"
            className="gap-1.5 data-[state=active]:shadow-sm rounded-md px-4"
          >
            <Clock className="size-3.5" />
            Chưa đánh giá
            {pendingBookings.length > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 text-white text-[10px] font-bold min-w-4 h-4 grid place-items-center px-1">
                {pendingBookings.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="sent"
            className="gap-1.5 data-[state=active]:shadow-sm rounded-md px-4"
          >
            <Star className="size-3.5" />
            Đã gửi ({total})
          </TabsTrigger>
        </TabsList>

        {/* ── Pending tab ── */}
        <TabsContent value="pending" className="mt-4 space-y-3 outline-none">
          {bookingsLoading ? (
            Array.from({ length: 3 }).map((_, i) => <PendingRideSkeleton key={i} />)
          ) : pendingBookings.length === 0 ? (
            <Card className="ring-1 ring-black/5">
              <CardContent className="py-12 px-6 text-center space-y-2">
                <div className="mx-auto size-12 rounded-2xl bg-emerald-500/10 grid place-items-center">
                  <Star className="size-6 fill-emerald-500 text-emerald-500" />
                </div>
                <div className="font-semibold">Bạn đã đánh giá tất cả chuyến đi 🎉</div>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Cảm ơn bạn đã chia sẻ trải nghiệm! Các phản hồi mới sẽ xuất hiện ở đây
                  sau khi bạn hoàn thành chuyến đi tiếp theo.
                </p>
              </CardContent>
            </Card>
          ) : (
            pendingBookings.map((b) => (
              <PendingRideCard
                key={b.id}
                booking={b}
                expanded={expandedId === b.id}
                onToggle={() => setExpandedId(expandedId === b.id ? null : b.id)}
                onSubmitted={() => {
                  setExpandedId(null)
                  refetchBoth()
                }}
              />
            ))
          )}
          {!bookingsLoading && pendingBookings.length > 0 && (
            <p className="text-xs text-muted-foreground px-1">
              💡 Chỉ những chuyến bạn đã đi (đã khởi hành, không bị hủy) mới hiển thị để đánh giá.
            </p>
          )}
        </TabsContent>

        {/* ── Sent tab ── */}
        <TabsContent value="sent" className="mt-4 space-y-3 outline-none">
          {reviewsLoading && !reviewsData ? (
            Array.from({ length: 3 }).map((_, i) => <SentFeedbackSkeleton key={i} />)
          ) : reviews.length === 0 ? (
            <Card className="ring-1 ring-black/5">
              <CardContent className="py-12 px-6 text-center space-y-2">
                <div className="mx-auto size-12 rounded-2xl bg-amber-500/10 grid place-items-center">
                  <MessageSquareHeart className="size-6 text-amber-500" />
                </div>
                <div className="font-semibold">Chưa có phản hồi nào</div>
                <p className="text-sm text-muted-foreground">
                  Hãy bắt đầu với chuyến đi gần nhất của bạn ở tab "Chưa đánh giá".
                </p>
              </CardContent>
            </Card>
          ) : (
            reviews.map((r) => (
              <SentFeedbackCard
                key={r.id}
                review={r}
                booking={r.bookingId ? bookingById.get(r.bookingId) : undefined}
                editing={editingId === r.id}
                onEdit={() => setEditingId(editingId === r.id ? null : r.id)}
                onEdited={() => {
                  setEditingId(null)
                  refetchBoth()
                }}
              />
            ))
          )}

          {/* Pagination (server-side) */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-muted-foreground">
                Hiển thị {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / {total} phản hồi
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={!canPrev || reviewsLoading}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Trang trước"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {page + 1} / {pages}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8"
                  disabled={!canNext || reviewsLoading}
                  onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                  aria-label="Trang sau"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Cross-link back to rides */}
      <div className="pt-1 text-center">
        <a
          href="/account/trips"
          className="inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"
        >
          Xem lịch sử chuyến đi
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </div>
  )
}
