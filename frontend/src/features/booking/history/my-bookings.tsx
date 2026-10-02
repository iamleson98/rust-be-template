'use client'

/**
 * MyBookings — the booking history of the SIGNED-IN user.
 *
 * Rendered inside the account area (`/account/trips`). The old guest
 * "check ticket by phone number" lookup flow was removed: booking hold
 * requires an authenticated caller, so every booking belongs to an
 * account and the phone lookup had nothing to find. Guests who need
 * their tickets sign in — the account guard redirects them.
 */

import { useEffect, useMemo, useState, Suspense } from 'react'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { useMyBookings, useMyReviews } from '@/lib/queries'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Ticket, CalendarCheck, Wallet } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'

// Re-export shared types for backward compatibility (other modules may
// still `import { BookingItem } from '@/features/booking/history/my-bookings'`).
export type { BookingItem, ReviewItem, ReviewSummary } from '@/features/booking/history/booking-types'

import {
  BookingItem,
  ReviewItem,
  ReviewSummary,
  isBookingUpcoming,
  isBookingPast,
  isBookingCancelled,
  isBookingReviewable,
} from '@/features/booking/history/booking-types'
import { BookingList } from '@/features/booking/history/booking-list'
import { StatsRow } from './stats-row'
import { FeedbackForm, FeedbackFormFallback } from './feedback-form-lazy'
import { BookingsHero } from './bookings-hero'
import { BookingsTabBar } from './bookings-tab-bar'
import { ReviewsTabContent } from './reviews-tab-content'


/** Stable empty default — keeps useMemo deps referentially stable when data is not loaded yet. */
const EMPTY_ITEMS: never[] = []
type UserTab = 'upcoming' | 'past' | 'cancelled' | 'reviews'

export function MyBookings() {
  const { setCancelDialogOpen, setCancelBookingId, currency, user } = useApp()
  const t = useT()
  const navigate = useNavigate()

  const [userTab, setUserTab] = useState<UserTab>('upcoming')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null)

  // ── Bookings: TanStack Query (auto-fetches; the account layout's
  // requireAuth guard guarantees a signed-in caller here) ──
  // We fetch status='all' so the upcoming/past/cancelled tabs can all be
  // filtered client-side from a single cached response.
  const {
    data: bookingsData,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useMyBookings('all')
  const userBookings: BookingItem[] = (bookingsData?.items ?? EMPTY_ITEMS) as unknown as BookingItem[]
  const bookingsLoaded = !!bookingsData

  // Reviews: lazy-loaded only when the user opens the "Đánh giá" tab.
  // `GET /api/reviews/mine` scopes to the CALLER server-side.
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useMyReviews({ enabled: userTab === 'reviews' })
  const userReviews: ReviewItem[] = (reviewsData?.items ?? EMPTY_ITEMS) as unknown as ReviewItem[]

  // Auto-expand the first booking once after the initial load.
  useEffect(() => {
    if (bookingsLoaded && userBookings.length > 0 && expandedId === null) {
      // Intentional effect-synced state (server-data snapshot — the
      // first row expands the moment bookings arrive).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedId(userBookings[0].id)
    }
  }, [bookingsLoaded, userBookings, expandedId])

  // ── Filtered lists via useMemo ─────────────────────────
  const upcomingBookings = useMemo(() => userBookings.filter(isBookingUpcoming), [userBookings])
  const pastBookings = useMemo(() => userBookings.filter(isBookingPast), [userBookings])
  const cancelledBookings = useMemo(() => userBookings.filter(isBookingCancelled), [userBookings])
  const reviewableBookings = useMemo(
    () => userBookings.filter((b) => isBookingReviewable(b) && !b.review),
    [userBookings],
  )

  // ── Stats ──────────────────────────────────────────────
  const userTotalAmount = useMemo(
    () =>
      userBookings
        .filter((b) => b.status === 'paid' || b.status === 'confirmed')
        .reduce((s, b) => s + b.total, 0),
    [userBookings],
  )
  const userAvgRating = useMemo(
    () =>
      userReviews.length > 0
        ? Math.round((userReviews.reduce((s, r) => s + r.rating, 0) / userReviews.length) * 10) / 10
        : 0,
    [userReviews],
  )

  // ── Actions ────────────────────────────────────────────
  const openCancelDialog = (bookingId: string) => {
    setCancelBookingId(bookingId)
    setCancelDialogOpen(true)
  }

  const handleFeedbackSubmitted = (_bookingId: string, _review: ReviewSummary) => {
    // Refresh both the bookings list (so the booking's `review` field
    // updates) and the reviews list (so the new review appears).
    refetchBookings()
    if (userTab === 'reviews') refetchReviews()
    setFeedbackOpenId(null)
  }

  // ── Stats card rows (reused across tabs) ───────────────
  const bookingStats = (
    <StatsRow
      stats={[
        { icon: <Ticket className="h-5 w-5" />, label: t('bookingHistory.statTotalTickets'), value: String(userBookings.length), accent: 'from-blue-500 to-blue-500', subtitle: t('bookingHistory.statTicketsBooked') },
        { icon: <CalendarCheck className="h-5 w-5" />, label: t('bookingHistory.statUpcoming'), value: String(upcomingBookings.length), accent: 'from-blue-500 to-blue-500', subtitle: t('bookingHistory.statUpcomingSub') },
        { icon: <Wallet className="h-5 w-5" />, label: t('bookingHistory.statTotalSpend'), value: formatCurrency(userTotalAmount, currency), accent: 'from-amber-500 to-orange-500', subtitle: t('bookingHistory.statPaidSub') },
      ]}
    />
  )

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-[60vh] bg-linear-to-b from-slate-50 via-white to-slate-50">
      {/* Hero Header — pass the user so the greeting shows a real name
          (previously always rendered "Chào , ..." with an empty name). */}
      <BookingsHero user={user ? { name: user.name } : null} />

      <div className="container mx-auto px-4 -mt-8 relative z-10">
        <Tabs value={userTab} onValueChange={(v) => setUserTab(v as UserTab)} className="w-full">
          <BookingsTabBar
            upcomingCount={upcomingBookings.length}
            pastCount={pastBookings.length}
            cancelledCount={cancelledBookings.length}
            reviewableCount={reviewableBookings.length}
          />

          {/* ─── Sắp đi tab ─── */}
          <TabsContent value="upcoming" className="mt-6 outline-none">
            {upcomingBookings.length > 0 && <div className="mb-5">{bookingStats}</div>}
            <BookingList
              variant="upcoming"
              bookings={upcomingBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              onCancelClick={openCancelDialog}
              cancellingId={null}
              onExploreOther={() => navigate({ to: '/' })}
              onReload={refetchBookings}
            />
          </TabsContent>

          {/* ─── Đã đi tab ─── */}
          <TabsContent value="past" className="mt-6 outline-none">
            <BookingList
              variant="past"
              bookings={pastBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              onCancelClick={openCancelDialog}
              cancellingId={null}
              onExploreOther={() => navigate({ to: '/' })}
              onReload={refetchBookings}
              onLeaveFeedback={(id) => setFeedbackOpenId(feedbackOpenId === id ? null : id)}
              feedbackOpenId={feedbackOpenId}
            >
              {feedbackOpenId && (
                <Suspense fallback={FeedbackFormFallback}>
                  {/* Guard the non-null lookup: if the bookings refetch
                      removes this booking while the form is open, the old
                      `find(...)!` would pass undefined into FeedbackForm
                      and crash on `booking.id`. */}
                  {(() => {
                    const feedbackBooking = userBookings.find((b) => b.id === feedbackOpenId)
                    if (!feedbackBooking) return null
                    return (
                      <FeedbackForm
                        booking={feedbackBooking}
                        existingReview={feedbackBooking.review ?? null}
                        onSubmitted={(review) => handleFeedbackSubmitted(feedbackOpenId, review)}
                        onClose={() => setFeedbackOpenId(null)}
                      />
                    )
                  })()}
                </Suspense>
              )}
            </BookingList>
          </TabsContent>

          {/* ─── Đã hủy tab ─── */}
          <TabsContent value="cancelled" className="mt-6 outline-none">
            <BookingList
              variant="cancelled"
              bookings={cancelledBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
              onExploreOther={() => navigate({ to: '/' })}
              onReload={refetchBookings}
            />
          </TabsContent>

          {/* ─── Đánh giá tab ─── */}
          <ReviewsTabContent
            reviewableBookings={reviewableBookings}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            feedbackOpenId={feedbackOpenId}
            setFeedbackOpenId={setFeedbackOpenId}
            onFeedbackSubmitted={handleFeedbackSubmitted}
            reviewsLoading={reviewsLoading}
            reviewsData={reviewsData}
            userReviews={userReviews}
            userAvgRating={userAvgRating}
            currency={currency}
            onReloadReviews={refetchReviews}
          />
        </Tabs>
      </div>
    </div>
  )
}
