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

import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { useMemo, useState, Suspense } from 'react'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { ConsolePage, PageHeader } from '@/components/console/page'

import {
  BookingItem,
  isBookingUpcoming,
  isBookingPast,
  isBookingCancelled,
} from '@/features/booking/history/booking-types'
import { BookingList } from '@/features/booking/history/booking-list'
import { FeedbackForm, FeedbackFormFallback } from './feedback-form-lazy'
import { BookingsTabBar } from './bookings-tab-bar'

/** Stable empty default — keeps useMemo deps referentially stable when data is not loaded yet. */
const EMPTY_ITEMS: never[] = []
type UserTab = 'upcoming' | 'past' | 'cancelled'

export function MyBookings() {
  const openCancel = useUi((s) => s.openCancel)
  const currency = usePrefs((s) => s.currency)
  const t = useT()
  const navigate = useNavigate()

  const [userTab, setUserTab] = useState<UserTab>('upcoming')
  /** The ticket the user opened (`null`: none); until they choose, the next trip is open. */
  const [chosenId, setChosenId] = useState<string | null | undefined>(undefined)
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null)

  // One fetch of every ticket; the tabs filter it client-side.
  const {
    data: bookingsData,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useQuery(bookingsListOptions())
  const userBookings: BookingItem[] = bookingsData?.items ?? EMPTY_ITEMS
  const bookingsLoaded = !!bookingsData

  // ── Filtered lists via useMemo ─────────────────────────
  const upcomingBookings = useMemo(() => userBookings.filter(isBookingUpcoming), [userBookings])
  const pastBookings = useMemo(() => userBookings.filter(isBookingPast), [userBookings])
  const expandedId = chosenId === undefined ? (upcomingBookings[0]?.id ?? null) : chosenId
  const toggleExpand = (id: string) => setChosenId(expandedId === id ? null : id)
  const cancelledBookings = useMemo(() => userBookings.filter(isBookingCancelled), [userBookings])

  // ── Actions ────────────────────────────────────────────
  // The booking's `review` field changes once a review is sent.
  const handleFeedbackSubmitted = () => {
    refetchBookings()
    setFeedbackOpenId(null)
  }

  // ── Render ─────────────────────────────────────────────
  return (
    <ConsolePage>
      <PageHeader title={t('bookingHistory.myBookingsTitle')} />

      <div>
        <Tabs
          value={userTab}
          onValueChange={(v) => setUserTab(v as UserTab)}
          className="w-full gap-4"
        >
          <BookingsTabBar
            upcomingCount={upcomingBookings.length}
            pastCount={pastBookings.length}
            cancelledCount={cancelledBookings.length}
          />

          {/* ─── Sắp đi tab ─── */}
          <TabsContent value="upcoming" className="outline-none">
            <BookingList
              variant="upcoming"
              bookings={upcomingBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={toggleExpand}
              onCancelClick={openCancel}
              cancellingId={null}
              onExploreOther={() => navigate({ to: '/' })}
              onReload={refetchBookings}
            />
          </TabsContent>

          {/* ─── Đã đi tab ─── */}
          <TabsContent value="past" className="outline-none">
            <BookingList
              variant="past"
              bookings={pastBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={toggleExpand}
              onCancelClick={openCancel}
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
                        onSubmitted={handleFeedbackSubmitted}
                        onClose={() => setFeedbackOpenId(null)}
                      />
                    )
                  })()}
                </Suspense>
              )}
            </BookingList>
          </TabsContent>

          {/* ─── Đã hủy tab ─── */}
          <TabsContent value="cancelled" className="outline-none">
            <BookingList
              variant="cancelled"
              bookings={cancelledBookings}
              currency={currency}
              loading={bookingsLoading}
              loaded={bookingsLoaded}
              expandedId={expandedId}
              onToggleExpand={toggleExpand}
              onExploreOther={() => navigate({ to: '/' })}
              onReload={refetchBookings}
            />
          </TabsContent>
        </Tabs>
      </div>
    </ConsolePage>
  )
}
