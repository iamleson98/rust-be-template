import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import {
  isBookingReviewable,
  isBookingUpcoming,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { useLoyalty } from '@/features/loyalty/api'
import { ActiveTicketsCard } from './active-tickets-card'
import { AwaitingFeedbackCard } from './awaiting-feedback-card'
import { ConsoleHero } from './console-hero'
import { ConsoleStatCards } from './console-stats'
import { LoyaltySnapshotCard } from './loyalty-snapshot-card'
import { QuickLinks } from './quick-links'
import { RecentPurchasesCard } from './recent-purchases-card'

/** `/account`: the customer's home — hero, headline numbers, tickets, reviews owed, recent purchases, loyalty. */
export function UserConsole() {
  const bookingsQuery = useQuery(bookingsListOptions({ query: { status: 'all' } }))
  const { data: loyalty } = useLoyalty()

  const bookings = useMemo(
    () => (bookingsQuery.data?.items ?? []) as unknown as BookingItem[],
    [bookingsQuery.data],
  )
  const awaiting = useMemo(
    () => bookings.filter((b) => isBookingReviewable(b) && !b.review),
    [bookings],
  )
  const upcoming = useMemo(() => bookings.filter(isBookingUpcoming).length, [bookings])
  const stats = {
    upcoming,
    completed: bookings.filter((b) => b.status === 'completed').length,
    awaitingFeedback: awaiting.length,
  }
  const loading = bookingsQuery.isLoading

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6">
      <ConsoleHero upcoming={stats.upcoming} loyalty={loyalty} />
      <ConsoleStatCards stats={stats} loading={loading} loyalty={loyalty} />
      <div className="mb-5">
        <ActiveTicketsCard bookings={bookings} loading={loading} />
      </div>
      <div className="mb-5">
        <AwaitingFeedbackCard bookings={awaiting} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentPurchasesCard bookings={bookings} loading={loading} />
        <LoyaltySnapshotCard />
      </div>
      <QuickLinks />
    </div>
  )
}
