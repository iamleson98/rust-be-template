import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { bookingsListOptions, reviewsMineOptions } from '@/api'
import {
  isBookingReviewable,
  type BookingItem,
  type ReviewItem,
} from '@/features/booking/history/booking-types'

export const PAGE_SIZE = 8
const NONE: never[] = []

/** The customer's past rides and one page of their reviews, plus what is derived from both. */
export function useFeedbackData(page: number) {
  const rides = useQuery(bookingsListOptions())
  const mine = useQuery({
    ...reviewsMineOptions({ query: { limit: PAGE_SIZE, offset: page * PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  })
  const bookings: BookingItem[] = rides.data?.items ?? NONE
  const reviews = (mine.data?.items ?? NONE) as unknown as ReviewItem[]

  // Rides taken but not reviewed yet (judged on the loaded page of reviews).
  const pending = useMemo(() => {
    const reviewed = new Set(reviews.map((r) => r.bookingId).filter(Boolean))
    return bookings.filter((b) => isBookingReviewable(b) && !reviewed.has(b.id))
  }, [bookings, reviews])

  return {
    bookings,
    reviews,
    pending,
    bookingById: useMemo(() => new Map(bookings.map((b) => [b.id, b])), [bookings]),
    total: mine.data?.total ?? 0,
    ridesLoading: rides.isLoading,
    reviewsLoading: mine.isLoading,
    refetch: () => {
      void rides.refetch()
      void mine.refetch()
    },
  }
}
