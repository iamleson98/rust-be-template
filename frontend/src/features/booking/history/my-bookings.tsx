'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import {
  useMyBookings,
  useMyReviews,
  useGuestBookings,
  useCancelBooking,
} from '@/lib/queries'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Ticket, CalendarCheck, Wallet } from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { lookupSchema, type LookupValues } from '@/features/booking/history/guest-lookup-form'

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
import { getRecentSearches, addRecentSearch, removeRecentSearch } from './recent-searches'
import { BookingsHero } from './bookings-hero'
import { BookingsTabBar } from './bookings-tab-bar'
import { ReviewsTabContent } from './reviews-tab-content'
import { GuestLookupPanel } from './guest-lookup-panel'
import { GuestLookupView } from './guest-lookup-view'

type UserTab = 'upcoming' | 'past' | 'cancelled' | 'reviews'

export function MyBookings() {
  const { setCancelDialogOpen, setCancelBookingId, currency, user } = useApp()
  const navigate = useNavigate()

  // ── Guest lookup state ─────────────────────────────────
  // The lookup form is owned by react-hook-form (zod-validated via the
  // shared `lookupSchema` exported from guest-lookup-form.tsx). The
  // `searchCode` / `searchPhone` strings exposed to <GuestLookupForm />
  // are derived from the form via `watch`, and the setters write back
  // via `setValue` — so the parent and the embedded <GuestLookupForm />
  // RHF instance stay in sync (the child also validates on its own
  // before `doSearch` is invoked).
  const lookupForm = useForm<LookupValues>({
    resolver: zodResolver(lookupSchema),
    defaultValues: { code: '', phone: '' },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })
  const searchCode = lookupForm.watch('code') ?? ''
  const searchPhone = lookupForm.watch('phone') ?? ''
  const setSearchCode = useCallback(
    (v: string) => lookupForm.setValue('code', v, { shouldValidate: false }),
    [lookupForm],
  )
  const setSearchPhone = useCallback(
    (v: string) => lookupForm.setValue('phone', v, { shouldValidate: false }),
    [lookupForm],
  )

  // Submitted lookup search — set when the user clicks "Tìm kiếm".
  // Until then, useGuestBookings stays disabled (no fetch on every
  // keystroke). After submit, the hook fetches once + caches for 30s.
  const [submittedLookup, setSubmittedLookup] = useState<{ phone: string; code: string } | null>(null)
  const [searched, setSearched] = useState(false)
  const [recentSearches, setRecentSearches] = useState<string[]>([])

  // ── Logged-in user state ───────────────────────────────
  const isUserLoggedIn = !!user && user.type === 'user'
  const [userTab, setUserTab] = useState<UserTab>('upcoming')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [feedbackOpenId, setFeedbackOpenId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [showGuestLookup, setShowGuestLookup] = useState(false)

  // ── Bookings: TanStack Query (auto-fetches when user is logged in) ──
  // We fetch status='all' so the upcoming/past/cancelled tabs can all be
  // filtered client-side from a single cached response.
  //
  // The centralized `BookingItem` type in `@/lib/queries/types` is a
  // minimal summary; the actual `/api/bookings` response matches the
  // richer local `BookingItem` (with `seats`, `trip`, `subtotal`, etc.).
  // We cast to the local type so the rest of the component stays typed.
  const {
    data: bookingsData,
    isLoading: bookingsLoading,
    refetch: refetchBookings,
  } = useMyBookings('all')
  const userBookings: BookingItem[] = (bookingsData?.items ?? []) as unknown as BookingItem[]
  const bookingsLoaded = !!bookingsData

  // Reviews: lazy-loaded only when the user opens the "Đánh giá" tab.
  // `GET /api/reviews/mine` scopes to the CALLER server-side (the
  // userId query param is never trusted).
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useMyReviews({ enabled: isUserLoggedIn && userTab === 'reviews' })
  const userReviews: ReviewItem[] = (reviewsData?.items ?? []) as unknown as ReviewItem[]

  // Guest lookup: TanStack Query driven by `submittedLookup`.
  const {
    data: lookupData,
    isLoading: lookupLoading,
  } = useGuestBookings(submittedLookup?.phone, submittedLookup?.code)
  const results: BookingItem[] = (lookupData?.items ?? []) as unknown as BookingItem[]
  const loading = lookupLoading

  // Cancel booking mutation — invalidates the bookings cache on success
  // so the list refreshes automatically (no manual state patching).
  const { mutateAsync: cancelBookingMut } = useCancelBooking()

  // Auto-expand the first booking once after the initial load.
  useEffect(() => {
    if (bookingsLoaded && userBookings.length > 0 && expandedId === null) {
      setExpandedId(userBookings[0].id)
    }
  }, [bookingsLoaded, userBookings, expandedId])

  useEffect(() => {
    if (isUserLoggedIn) refetchBookings()
  }, [isUserLoggedIn, refetchBookings])

  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

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

  const cancelBooking = async (bookingId: string) => {
    setCancelling(bookingId)
    try {
      await cancelBookingMut({ path: { id: bookingId }, body: {} })
      // The mutation invalidates the bookings query on success, so the
      // list refreshes automatically — no manual state patching needed.
    } catch {
      // noop — the dialog handles its own error toasts
    } finally {
      setCancelling(null)
    }
  }

  const handleFeedbackSubmitted = (bookingId: string, review: ReviewSummary) => {
    // Refresh both the bookings list (so the booking's `review` field
    // updates) and the reviews list (so the new review appears).
    refetchBookings()
    if (userTab === 'reviews') refetchReviews()
    setFeedbackOpenId(null)
  }

  // ── Guest lookup ───────────────────────────────────────
  // `doSearch` is invoked by <GuestLookupForm />'s RHF `handleSubmit` —
  // so by the time we get here the child form has already validated.
  // We re-read the latest values from `lookupForm.getValues()` (rather
  // than the closure-captured `searchCode` / `searchPhone`) so that the
  // very latest setValue from the child's onSubmit is guaranteed to be
  // reflected even if a React batch hasn't flushed yet.
  const doSearch = useCallback(() => {
    const { code, phone } = lookupForm.getValues()
    const codeTrim = (code ?? '').trim()
    const phoneTrim = (phone ?? '').trim()
    if (!codeTrim && !phoneTrim) return
    setSearched(true)
    const term = codeTrim || phoneTrim
    addRecentSearch(term)
    setRecentSearches(getRecentSearches())
    // Trigger useGuestBookings by setting the submitted lookup. The hook
    // handles the fetch + caching. Auto-expand the first result when it
    // arrives (see the useEffect below).
    setSubmittedLookup({ phone: phoneTrim, code: codeTrim })
  }, [lookupForm])

  // Auto-expand the first lookup result when it arrives.
  useEffect(() => {
    if (searched && results.length > 0) {
      setExpandedId(results[0].id)
    }
  }, [searched, results])

  const handleRecentClick = (term: string) => {
    if (/^[A-Z]{2}-/i.test(term)) {
      lookupForm.setValue('code', term, { shouldValidate: true })
      lookupForm.setValue('phone', '', { shouldValidate: false })
    } else {
      lookupForm.setValue('phone', term, { shouldValidate: true })
      lookupForm.setValue('code', '', { shouldValidate: false })
    }
  }

  // ── Stats card rows (reused across tabs) ───────────────
  const bookingStats = (
    <StatsRow
      stats={[
        { icon: <Ticket className="h-5 w-5" />, label: 'Tổng số vé', value: String(userBookings.length), accent: 'from-blue-500 to-blue-500', subtitle: 'vé đã đặt' },
        { icon: <CalendarCheck className="h-5 w-5" />, label: 'Sắp khởi hành', value: String(upcomingBookings.length), accent: 'from-blue-500 to-blue-500', subtitle: 'chuyến sắp đi' },
        { icon: <Wallet className="h-5 w-5" />, label: 'Tổng chi phí', value: formatCurrency(userTotalAmount, currency), accent: 'from-amber-500 to-orange-500', subtitle: 'đã thanh toán' },
      ]}
    />
  )

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-[60vh] bg-linear-to-b from-slate-50 via-white to-slate-50">
      {/* Hero Header */}
      <BookingsHero isUserLoggedIn={isUserLoggedIn} user={user} />

      <div className="container mx-auto px-4 -mt-8 relative z-10">
        {isUserLoggedIn ? (
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
                cancellingId={cancelling}
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
                cancellingId={cancelling}
                onExploreOther={() => navigate({ to: '/' })}
                onReload={refetchBookings}
                onLeaveFeedback={(id) => setFeedbackOpenId(feedbackOpenId === id ? null : id)}
                feedbackOpenId={feedbackOpenId}
              >
                {feedbackOpenId && (
                  <Suspense fallback={FeedbackFormFallback}>
                    <FeedbackForm
                      booking={userBookings.find((b) => b.id === feedbackOpenId)!}
                      existingReview={userBookings.find((b) => b.id === feedbackOpenId)?.review ?? null}
                      onSubmitted={(review) => handleFeedbackSubmitted(feedbackOpenId, review)}
                      onClose={() => setFeedbackOpenId(null)}
                    />
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

            {/* Secondary: manual lookup for other bookings */}
            <GuestLookupPanel
              showGuestLookup={showGuestLookup}
              setShowGuestLookup={setShowGuestLookup}
              searchCode={searchCode}
              setSearchCode={setSearchCode}
              searchPhone={searchPhone}
              setSearchPhone={setSearchPhone}
              loading={loading}
              doSearch={doSearch}
              recentSearches={recentSearches}
              onRecentClick={handleRecentClick}
              onRemoveRecent={(term) => {
                removeRecentSearch(term)
                setRecentSearches(getRecentSearches())
              }}
              results={results}
              searched={searched}
              onReset={() => {
                setSearchCode('')
                setSearchPhone('')
                setSearched(false)
                setSubmittedLookup(null)
              }}
              expandedId={expandedId}
              setExpandedId={setExpandedId}
              onCancelBooking={cancelBooking}
              cancelling={cancelling}
              currency={currency}
            />
          </Tabs>
        ) : (
          /* ── Guest view ── */
          <GuestLookupView
            searchCode={searchCode}
            setSearchCode={setSearchCode}
            searchPhone={searchPhone}
            setSearchPhone={setSearchPhone}
            loading={loading}
            doSearch={doSearch}
            recentSearches={recentSearches}
            onRecentClick={handleRecentClick}
            onRemoveRecent={(term) => {
              removeRecentSearch(term)
              setRecentSearches(getRecentSearches())
            }}
            results={results}
            searched={searched}
            onReset={() => {
              setSearchCode('')
              setSearchPhone('')
              setSearched(false)
              setSubmittedLookup(null)
            }}
            expandedId={expandedId}
            setExpandedId={setExpandedId}
            onCancelBooking={cancelBooking}
            cancelling={cancelling}
            currency={currency}
          />
        )}
      </div>
    </div>
  )
}
