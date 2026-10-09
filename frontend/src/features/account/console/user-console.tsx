import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import {
  isBookingReviewable,
  isBookingUpcoming,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { useLoyalty } from '@/features/loyalty/api'
import { ConsolePage } from '@/components/console/page'
import { ActiveTicketsCard } from './active-tickets-card'
import { AwaitingFeedbackCard } from './awaiting-feedback-card'
import { ConsoleGreeting } from './console-greeting'
import { ConsoleStatCards } from './console-stats'
import { LoyaltySnapshotCard } from './loyalty-snapshot-card'
import { RecentPurchasesCard } from './recent-purchases-card'

/** `/account`: the customer's home — greeting, headline numbers, tickets, reviews owed, recent purchases, loyalty. */
export function UserConsole() {
  const bookingsQuery = useQuery(bookingsListOptions())
  const { data: loyalty } = useLoyalty()

  const bookings: BookingItem[] = useMemo(
    () => bookingsQuery.data?.items ?? [],
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
    <ConsolePage>
      <ConsoleGreeting upcoming={stats.upcoming} loyalty={loyalty} />
      <ConsoleStatCards stats={stats} loading={loading} loyalty={loyalty} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <ActiveTicketsCard bookings={bookings} loading={loading} />
          <AwaitingFeedbackCard bookings={awaiting} />
          <RecentPurchasesCard bookings={bookings} loading={loading} />
        </div>
        <LoyaltySnapshotCard />
      </div>
    </ConsolePage>
  )
}
