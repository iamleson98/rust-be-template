'use client'

import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
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
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsContent } from '@/components/ui/tabs'
import {
  Search,
  Ticket,
  Bus,
  User,
  ChevronDown,
  ShieldCheck,
  RefreshCw,
  History,
  X,
  CalendarCheck,
  Wallet,
  Star,
  MessageSquare,
  TrendingUp,
  LogIn,
} from 'lucide-react'
import { formatCurrency } from '@/lib/currency'
import { lookupSchema, type LookupValues } from '@/components/bookings/guest-lookup-form'

// Re-export shared types for backward compatibility (other modules may
// still `import { BookingItem } from '@/components/bookings/my-bookings'`).
export type { BookingItem, ReviewItem, ReviewSummary } from '@/components/bookings/booking-types'

import {
  BookingItem,
  ReviewItem,
  ReviewSummary,
  isBookingUpcoming,
  isBookingPast,
  isBookingCancelled,
  isBookingReviewable,
} from '@/components/bookings/booking-types'
import { BookingList } from '@/components/bookings/booking-list'
import { GuestLookupForm } from '@/components/bookings/guest-lookup-form'
import { StatsRow, UserTabTrigger, ReviewCard } from '@/components/bookings/booking-stats'
import { NoResultsFound, NoBookingsYet, NoReviewsYet } from '@/components/layout/empty-states'
import { MyBookingsSkeleton } from '@/components/layout/skeletons'
import { Card as UiCard } from '@/components/ui/card'

// Lazy-load the FeedbackForm so its star-rating + photo-upload code only
// loads when a user actually opens the form on a completed booking.
const FeedbackForm = lazy(() => import('@/components/feedback/feedback-form').then((m) => ({ default: m.FeedbackForm })))
const FeedbackFormFallback = <div className="h-32 animate-pulse rounded-lg bg-slate-100" />

const RECENT_SEARCHES_KEY = 'vexevn_booking_recent_searches'
const MAX_RECENT = 3

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
  } catch {
    return []
  }
}

function addRecentSearch(term: string) {
  if (!term.trim()) return
  try {
    const existing = getRecentSearches().filter((s) => s !== term.trim())
    const updated = [term.trim(), ...existing].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {
    // noop
  }
}

function removeRecentSearch(term: string) {
  try {
    const existing = getRecentSearches().filter((s) => s !== term)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(existing))
  } catch {
    // noop
  }
}

type UserTab = 'upcoming' | 'past' | 'cancelled' | 'reviews'

export function MyBookings() {
  const { setCancelDialogOpen, setCancelBookingId, currency, user, setAuthOpen } = useApp()
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
  // The backend `GET /api/reviews` filters by `userId=` — pass the current
  // user's id so we only get this user's reviews.
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useMyReviews({ enabled: isUserLoggedIn && userTab === 'reviews', userId: user?.id })
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

  const totalBookings = results.length
  const totalAmount = results
    .filter((b) => b.status === 'paid' || b.status === 'confirmed')
    .reduce((s, b) => s + b.total, 0)
  const upcoming = results.filter(
    (b) => b.trip && b.status !== 'cancelled' && new Date(b.trip.departureAt).getTime() > Date.now(),
  ).length

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="min-h-[60vh] bg-linear-to-b from-slate-50 via-white to-slate-50">
      {/* Hero Header */}
      <div className="relative overflow-hidden bg-linear-to-br from-blue-700 via-blue-800 to-blue-900 text-white">
        <div className="absolute inset-0 opacity-[0.06]">
          <div className="absolute top-4 left-[10%]"><Bus className="h-16 w-16 rotate-[-15deg]" /></div>
          <div className="absolute top-20 right-[15%]"><Bus className="h-12 w-12 rotate-10" /></div>
          <div className="absolute bottom-8 left-[30%]"><Bus className="h-10 w-10 rotate-[-5deg]" /></div>
          <div className="absolute top-2 right-[45%]"><Bus className="h-8 w-8 rotate-20" /></div>
          <div className="absolute bottom-4 right-[8%]"><Bus className="h-14 w-14 rotate-[-10deg]" /></div>
          <div className="absolute top-16 left-[60%]"><Bus className="h-9 w-9 rotate-15" /></div>
        </div>
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 50%, white 0, transparent 50%), radial-gradient(circle at 85% 70%, white 0, transparent 50%)',
          }}
        />
        <div className="container mx-auto px-4 py-12 md:py-16 relative">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 backdrop-blur-sm px-4 py-1.5 text-xs font-semibold ring-1 ring-white/20 mb-5">
              {isUserLoggedIn ? (
                <>
                  <User className="h-3.5 w-3.5" />
                  Xin chào, {user?.name}
                </>
              ) : (
                <>
                  <Ticket className="h-3.5 w-3.5" />
                  Tra cứu vé xe trực tuyến
                </>
              )}
            </div>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold tracking-tight mb-3 leading-tight">
              {isUserLoggedIn ? 'Lịch sử đặt vé của tôi' : 'Tra cứu vé đã đặt'}
            </h1>
            <p className="text-blue-100 text-sm md:text-base leading-relaxed max-w-lg">
              {isUserLoggedIn
                ? 'Xem lại các chuyến đi sắp đi, đã đi, đã hủy và để lại đánh giá cho từng chuyến hoàn thành.'
                : 'Nhập mã vé hoặc số điện thoại để xem chi tiết đặt vé, trạng thái chuyến đi và thông tin hành khách'}
            </p>
          </div>
        </div>
        <svg
          className="absolute bottom-0 left-0 w-full"
          viewBox="0 0 1440 60"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <path d="M0 60V30C240 0 480 0 720 30C960 60 1200 60 1440 30V60H0Z" fill="white" fillOpacity="0.06" />
          <path d="M0 60V40C360 10 720 10 1080 40C1260 55 1350 55 1440 40V60H0Z" fill="white" fillOpacity="0.04" />
        </svg>
      </div>

      <div className="container mx-auto px-4 -mt-8 relative z-10">
        {isUserLoggedIn ? (
          <Tabs value={userTab} onValueChange={(v) => setUserTab(v as UserTab)} className="w-full">
            <div className="flex justify-center">
              <TabsList className="bg-white ring-1 ring-black/5 backdrop-blur h-auto p-1.5 rounded-xl gap-1 flex-wrap">
                <UserTabTrigger
                  value="upcoming"
                  icon={<CalendarCheck className="h-4 w-4" />}
                  label="Sắp đi"
                  count={upcomingBookings.length}
                  activeClass="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"
                />
                <UserTabTrigger
                  value="past"
                  icon={<History className="h-4 w-4" />}
                  label="Đã đi"
                  count={pastBookings.length}
                  activeClass="data-[state=active]:bg-blue-50 data-[state=active]:text-blue-700"
                />
                <UserTabTrigger
                  value="cancelled"
                  icon={<X className="h-4 w-4" />}
                  label="Đã hủy"
                  count={cancelledBookings.length}
                  activeClass="data-[state=active]:bg-rose-50 data-[state=active]:text-rose-700"
                />
                <UserTabTrigger
                  value="reviews"
                  icon={<Star className="h-4 w-4" />}
                  label="Đánh giá"
                  count={reviewableBookings.length}
                  activeClass="data-[state=active]:bg-amber-50 data-[state=active]:text-amber-700"
                  badgeClass="bg-amber-100 text-amber-700"
                />
              </TabsList>
            </div>

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
                            onSubmitted={(review) => handleFeedbackSubmitted(b.id, review)}
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
                      { icon: <TrendingUp className="h-5 w-5" />, label: 'Nhà xe đã đi', value: String(new Set(userReviews.map((r) => r.brand.name)).size), accent: 'from-blue-500 to-blue-500', subtitle: 'hãng khác nhau' },
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
                      onClick={() => refetchReviews()}
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

            {/* Secondary: manual lookup for other bookings */}
            <div className="mt-8">
              <div className="rounded-xl ring-1 ring-black/5 bg-white overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowGuestLookup((s) => !s)}
                  className="w-full flex items-center justify-between gap-2 px-4 md:px-5 py-3.5 text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-slate-50 transition-colors"
                  aria-expanded={showGuestLookup}
                >
                  <span className="inline-flex items-center gap-2">
                    <Search className="h-4 w-4 text-blue-600" />
                    Tra cứu vé khác bằng mã vé hoặc SĐT
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${showGuestLookup ? 'rotate-180' : ''}`}
                  />
                </button>
                {showGuestLookup && (
                  <div className="border-t bg-slate-50/50 px-4 md:px-5 py-4 space-y-4">
                    <GuestLookupForm
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
                    />
                    {loading ? (
                      <MyBookingsSkeleton count={2} />
                    ) : searched && results.length === 0 ? (
                      <UiCard className="ring-1 ring-black/5 overflow-hidden">
                        <NoResultsFound
                          onReset={() => {
                            setSearchCode('')
                            setSearchPhone('')
                            setSearched(false)
                            setSubmittedLookup(null)
                          }}
                          onExplore={() => navigate({ to: '/' })}
                        />
                      </UiCard>
                    ) : searched ? (
                      <BookingList
                        variant="search"
                        bookings={results}
                        currency={currency}
                        loading={loading}
                        loaded
                        expandedId={expandedId}
                        onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                        onCancelClick={cancelBooking}
                        cancellingId={cancelling}
                        onExploreOther={() => navigate({ to: '/' })}
                      />
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </Tabs>
        ) : (
          /* ── Guest view ── */
          <>
            <Card className="ring-1 ring-black/5 overflow-hidden backdrop-blur">
              <CardContent className="p-5 md:p-7">
                <GuestLookupForm
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
                />
                <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                  Thông tin đặt vé của bạn được bảo mật. Vui lòng không chia sẻ mã vé với người lạ.
                </div>
              </CardContent>
            </Card>

            <div className="mt-6 pb-10">
              {loading ? (
                <MyBookingsSkeleton count={3} />
              ) : searched && results.length === 0 ? (
                <UiCard className="ring-1 ring-black/5 overflow-hidden">
                  <NoResultsFound
                    onReset={() => {
                      setSearchCode('')
                      setSearchPhone('')
                      setSearched(false)
                      setSubmittedLookup(null)
                    }}
                    onExplore={() => navigate({ to: '/' })}
                  />
                </UiCard>
              ) : searched ? (
                <div className="space-y-5">
                  <StatsRow
                    stats={[
                      { icon: <Ticket className="h-5 w-5" />, label: 'Tổng số vé', value: String(totalBookings), accent: 'from-blue-500 to-blue-500', subtitle: 'vé đã đặt' },
                      { icon: <CalendarCheck className="h-5 w-5" />, label: 'Sắp khởi hành', value: String(upcoming), accent: 'from-blue-500 to-blue-500', subtitle: 'chuyến sắp đi' },
                      { icon: <Wallet className="h-5 w-5" />, label: 'Tổng chi phí', value: formatCurrency(totalAmount, currency), accent: 'from-amber-500 to-orange-500', subtitle: 'đã thanh toán' },
                    ]}
                  />
                  <BookingList
                    variant="search"
                    bookings={results}
                    currency={currency}
                    loading={loading}
                    loaded
                    expandedId={expandedId}
                    onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                    onCancelClick={cancelBooking}
                    cancellingId={cancelling}
                    onExploreOther={() => navigate({ to: '/' })}
                  />
                </div>
              ) : (
                <UiCard className="ring-1 ring-black/5 overflow-hidden">
                  <NoBookingsYet onSearch={() => navigate({ to: '/' })} />
                  <div className="border-t bg-blue-50/60 px-6 py-4">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
                      <div className="h-10 w-10 rounded-xl bg-blue-100 text-blue-600 inline-flex items-center justify-center shrink-0">
                        <LogIn className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-foreground">
                          Đăng nhập để xem toàn bộ lịch sử đặt vé & đánh giá
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          Chỉ cần số điện thoại — vé và đánh giá của bạn sẽ tự động hiển thị.
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white shrink-0"
                        onClick={() => setAuthOpen(true)}
                      >
                        <LogIn className="h-4 w-4" />
                        Đăng nhập
                      </Button>
                    </div>
                  </div>
                </UiCard>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
