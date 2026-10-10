import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { bookingsListOptions } from '@/api'
import { ConsolePage } from '@/components/console/page'
import { isBookingReviewable, type BookingItem } from '@/features/booking/history/booking-types'
import { useMyCoupons } from '@/features/campaigns/api'
import { MyCouponCard } from '@/features/campaigns/my-coupon-card'
import { AccountHero } from './account-hero'
import { ActiveTicketsCard } from './active-tickets-card'
import { AwaitingFeedbackCard } from './awaiting-feedback-card'
import { RecentPurchasesCard } from './recent-purchases-card'

/**
 * `/account`: who you are and your points, the coupon you hold, the next trip,
 * reviews owed, recent purchases.
 */
export function UserConsole() {
  const bookingsQuery = useQuery(bookingsListOptions())
  const bookings: BookingItem[] = useMemo(
    () => bookingsQuery.data?.items ?? [],
    [bookingsQuery.data],
  )
  const awaiting = useMemo(
    () => bookings.filter((b) => isBookingReviewable(b) && !b.review),
    [bookings],
  )
  const loading = bookingsQuery.isLoading
  const coupon = useMyCoupons().data?.active

  return (
    <ConsolePage className="space-y-6">
      <AccountHero />
      {coupon && <MyCouponCard coupon={coupon} />}
      <ActiveTicketsCard bookings={bookings} loading={loading} />
      <AwaitingFeedbackCard bookings={awaiting} />
      <RecentPurchasesCard bookings={bookings} loading={loading} />
    </ConsolePage>
  )
}
