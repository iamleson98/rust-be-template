'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { BookingCard } from '@/features/booking/history/booking-card'
import { BookingItem } from '@/features/booking/history/booking-types'
import { NoResultsFound, NoBookingsYet, NoReviewsYet } from '@/components/layout/empty-states'
import { MyBookingsSkeleton } from '@/components/layout/skeletons'
import { Card } from '@/components/ui/card'

type Currency = 'VND' | 'USD'

type Props = {
  bookings: BookingItem[]
  currency: Currency
  loading: boolean
  loaded: boolean
  expandedId: string | null
  onToggleExpand: (id: string) => void
  onCancelClick?: (id: string) => void
  cancellingId?: string | null
  onExploreOther?: () => void
  onLeaveFeedback?: (id: string) => void
  feedbackOpenId?: string | null
  onReload?: () => void
  /** Optional extra action node factory for each BookingCard. */
  renderExtraActions?: (b: BookingItem) => React.ReactNode
  /** Which "tab" / empty-state variant to show. */
  variant: 'upcoming' | 'past' | 'cancelled' | 'reviews' | 'all' | 'search'
  /** Optional node rendered below the list (e.g. the inline FeedbackForm
   *  for the booking whose id == feedbackOpenId). */
  children?: React.ReactNode
}

const EMPTY_COPY: Record<Props['variant'], { title: string; subtitle: string }> = {
  upcoming: {
    title: 'Chưa có chuyến sắp đi',
    subtitle: 'Bạn chưa có vé nào cho chuyến đi sắp tới. Hãy tìm chuyến phù hợp và đặt ngay!',
  },
  past: {
    title: 'Chưa có chuyến đã đi',
    subtitle: 'Sau khi hoàn thành chuyến đi, vé sẽ hiển thị tại đây để bạn có thể để lại đánh giá.',
  },
  cancelled: {
    title: 'Chưa có vé bị hủy',
    subtitle: 'Các vé đã huỷ hoặc đã hoàn tiền sẽ hiển thị tại đây.',
  },
  reviews: {
    title: 'Chưa có đánh giá nào',
    subtitle: 'Sau khi đi chuyến, hãy quay lại đây để chia sẻ trải nghiệm của bạn về nhà xe.',
  },
  all: {
    title: 'Chưa có vé nào',
    subtitle: 'Bắt đầu đặt chuyến đi đầu tiên của bạn ngay hôm nay.',
  },
  search: {
    title: 'Không tìm thấy vé',
    subtitle: 'Vui lòng kiểm tra lại mã vé hoặc số điện thoại đã nhập.',
  },
}

/**
 * BookingList — renders a vertical stack of BookingCard with header
 * (count + reload), loading skeleton, and empty state. Memoized via
 * useMemo on the bookings array reference.
 */
export function BookingList({
  bookings,
  currency,
  loading,
  loaded,
  expandedId,
  onToggleExpand,
  onCancelClick,
  cancellingId,
  onExploreOther,
  onLeaveFeedback,
  feedbackOpenId,
  onReload,
  renderExtraActions,
  variant,
  children,
}: Props) {
  const count = bookings.length
  const emptyCopy = EMPTY_COPY[variant]

  const cards = useMemo(() => {
    return bookings.map((b) => (
      <div key={b.id} className="space-y-3">
        <BookingCard
          b={b}
          currency={currency}
          isExpanded={expandedId === b.id}
          onToggleExpand={() => onToggleExpand(b.id)}
          onCancelClick={onCancelClick ? () => onCancelClick(b.id) : undefined}
          cancelling={cancellingId === b.id}
          onExploreOther={onExploreOther}
          onLeaveFeedback={onLeaveFeedback ? () => onLeaveFeedback(b.id) : undefined}
          feedbackOpen={feedbackOpenId === b.id}
          hasReview={!!b.review}
          extraActions={renderExtraActions?.(b)}
        />
        {/* Inline feedback form for this booking (rendered by parent) */}
        {feedbackOpenId === b.id && children}
      </div>
    ))
  }, [bookings, currency, expandedId, onToggleExpand, onCancelClick, cancellingId, onExploreOther, onLeaveFeedback, feedbackOpenId, renderExtraActions, children])

  if (loading && !loaded) {
    return <MyBookingsSkeleton count={3} />
  }

  if (count === 0) {
    return (
      <Card className="ring-1 ring-black/5 overflow-hidden">
        {variant === 'reviews' ? (
          <NoReviewsYet onWrite={onExploreOther ?? (() => { })} />
        ) : variant === 'search' ? (
          <NoResultsFound onReset={onExploreOther ?? (() => { })} onExplore={onExploreOther ?? (() => { })} />
        ) : (
          <NoBookingsYet onSearch={onExploreOther ?? (() => { })} />
        )}
        <div className="border-t bg-slate-50/50 px-6 py-4">
          <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 text-blue-500 shrink-0 mt-0.5" />
            <p>
              <span className="font-semibold text-foreground">{emptyCopy.title}.</span>{' '}
              {emptyCopy.subtitle}
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Tìm thấy <span className="font-bold text-foreground">{count}</span> vé
        </p>
        {onReload && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
            onClick={onReload}
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Tải lại
          </Button>
        )}
      </div>
      {cards}
    </div>
  )
}
