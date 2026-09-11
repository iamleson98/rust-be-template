'use client'

// Extracted from the original 'my-bookings.tsx'.

import { Suspense } from 'react'
import { useNavigate } from '@/router'
import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { MessageSquare, Star, TrendingUp, RefreshCw } from 'lucide-react'
import { Card as UiCard } from '@/components/ui/card'
import type { Currency } from '@/lib/currency'
import {
  BookingItem,
  ReviewItem,
  ReviewSummary,
} from '@/features/booking/history/booking-types'
import { BookingList } from '@/features/booking/history/booking-list'
import { MyBookingsSkeleton } from '@/features/booking/history/my-bookings-skeleton'
import { NoReviewsYet } from '@/features/reviews/no-reviews-yet'
import { StatsRow } from './stats-row'
import { ReviewCard } from './review-card'
import { FeedbackForm, FeedbackFormFallback } from './feedback-form-lazy'

export function ReviewsTabContent({
  reviewableBookings,
  expandedId,
  setExpandedId,
  feedbackOpenId,
  setFeedbackOpenId,
  onFeedbackSubmitted,
  reviewsLoading,
  reviewsData,
  userReviews,
  userAvgRating,
  currency,
  onReloadReviews,
}: {
  reviewableBookings: BookingItem[]
  expandedId: string | null
  setExpandedId: React.Dispatch<React.SetStateAction<string | null>>
  feedbackOpenId: string | null
  setFeedbackOpenId: React.Dispatch<React.SetStateAction<string | null>>
  onFeedbackSubmitted: (bookingId: string, review: ReviewSummary) => void
  reviewsLoading: boolean
  reviewsData: { items?: unknown[] } | undefined
  userReviews: ReviewItem[]
  userAvgRating: number
  currency: Currency
  onReloadReviews: () => void
}) {
  const navigate = useNavigate()

  return (
    <TabsContent value="reviews" className="mt-6 outline-none space-y-6">
      {reviewableBookings.length > 0 && (
        <div className="space-y-3">
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <MessageSquare className="h-3.5 w-3.5" />
            {reviewableBookings.length} chuyến đang chờ đánh giá của bạn
          </div>
          {reviewableBookings.map((b) => (
            <BookingList
              key={b.id}
              variant="past"
              bookings={[b]}
              currency={currency}
              loading={false}
              loaded
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              onExploreOther={() => navigate({ to: '/' })}
              onLeaveFeedback={(id) => setFeedbackOpenId(feedbackOpenId === id ? null : id)}
              feedbackOpenId={feedbackOpenId}
            >
              {feedbackOpenId === b.id && (
                <Suspense fallback={FeedbackFormFallback}>
                  <FeedbackForm
                    booking={b}
                    existingReview={null}
                    onSubmitted={(review) => onFeedbackSubmitted(b.id, review)}
                    onClose={() => setFeedbackOpenId(null)}
                  />
                </Suspense>
              )}
            </BookingList>
          ))}
        </div>
      )}

      {/* Already-written reviews */}
      {reviewsLoading && !reviewsData ? (
        <MyBookingsSkeleton count={3} />
      ) : userReviews.length === 0 ? (
        <UiCard className="ring-1 ring-black/5 overflow-hidden">
          <NoReviewsYet onWrite={() => navigate({ to: '/' })} />
          <div className="border-t bg-slate-50/50 px-6 py-4">
            <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
              <Star className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <p>
                Mẹo: Sau khi hoàn thành chuyến đi, mở chi tiết vé ở tab{' '}
                <span className="font-semibold text-foreground">"Đã đi"</span> →{' '}
                <span className="font-semibold text-foreground">"Viết đánh giá"</span> để
                chia sẻ trải nghiệm của bạn về nhà xe.
              </p>
            </div>
          </div>
        </UiCard>
      ) : (
        <div className="space-y-5">
          <StatsRow
            stats={[
              { icon: <MessageSquare className="h-5 w-5" />, label: 'Số đánh giá', value: String(userReviews.length), accent: 'from-amber-500 to-orange-500', subtitle: 'đánh giá đã viết' },
              { icon: <Star className="h-5 w-5" />, label: 'Điểm trung bình', value: userAvgRating > 0 ? userAvgRating.toFixed(1) : '—', accent: 'from-yellow-400 to-amber-500', subtitle: 'trên 5 sao' },
              { icon: <TrendingUp className="h-5 w-5" />, label: 'Nhà xe đã đi', value: String(new Set(userReviews.map((r) => r.brand?.name ?? r.brandId ?? 'unknown')).size), accent: 'from-blue-500 to-blue-500', subtitle: 'hãng khác nhau' },
            ]}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-bold text-foreground">{userReviews.length}</span> đánh giá
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              onClick={() => onReloadReviews()}
              disabled={reviewsLoading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${reviewsLoading ? 'animate-spin' : ''}`} />
              Tải lại
            </Button>
          </div>
          {userReviews.map((r) => (
            <ReviewCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </TabsContent>
  )
}
