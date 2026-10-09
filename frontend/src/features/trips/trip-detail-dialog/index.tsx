'use client'

/**
 * TripDetailDialog — full-screen modal showing trip details + the
 * seat-selection / pickup-point / proceed-to-booking flow.
 *
 * This is the named-export entry point. It owns the dialog's state
 * (selected seats, boarding/dropping points, fetched detail) and
 * orchestrates the left-side tabs (seats / boarding points on mobile /
 * route schedule map / fares & policy / reviews) plus the right-rail
 * boarding points and the sticky price-summary CTA.
 *
 * 2026-10 cleanup: the fabricated tabs were REMOVED — "tracking"
 * (simulated random-walk bus speed/progress with no real GPS feed),
 * "travel tips" (a made-up static tips DB keyed by destination) and
 * "bus info" (a deterministic mock of plate number / year / fuel /
 * mileage). Every remaining tab renders real API data only.
 */

import { useUi } from '@/stores/ui'
import { usePrefs } from '@/stores/prefs'
import { useSearchForm } from '@/stores/search-form'
import { useBookingFlow } from '@/stores/booking-flow'
import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n'
import { useTripDetail } from '@/features/trips/api'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SeatMap } from '@/features/seat-plan'
import { ReviewsList } from '@/features/reviews/reviews-list'
import { TripDetailSkeleton } from './trip-detail-skeleton'
import { formatCurrency } from '@/lib/format'
import { ErrorState } from '@/components/error-state'
import { Bus, MapPin, CheckCircle2, MessageSquareQuote, Users, ArrowLeftRight } from 'lucide-react'
import type { TripSeat } from '@/api'
import type { TripDetailDialogData as TripDetail } from './types'
import { TripInfo } from './trip-info'
import { BoardingPoints, BoardingPointsInline } from './boarding-points'
import { PriceSummary } from './price-summary'
import { RouteScheduleMap } from '@/features/map/route-schedule-map'
import { RouteTimeline } from './route-timeline'
import { PolicyBlock } from './policy-block'
import { BookingFlow } from '@/features/booking/flow/booking-flow'

export function TripDetailDialog({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const bookingStep = useBookingFlow((s) => s.step)
  const setBookingStep = useBookingFlow((s) => s.setStep)
  const setBookingContext = useBookingFlow((s) => s.setContext)
  const searchParams = useSearchForm((s) => s.searchParams)
  const currency = usePrefs((s) => s.currency)
  const openShare = useUi((s) => s.openShare)
  const t = useT()
  const [selectedSeats, setSelectedSeats] = useState<string[]>([])
  const [boardingPoint, setBoardingPoint] = useState<string>('')
  const [droppingPoint, setDroppingPoint] = useState<string>('')

  // Fetch trip detail via the centralized TanStack Query hook — gives us:
  //  - Automatic caching (2 min staleTime) → reopening the same trip is instant.
  //  - Request deduplication (multiple components fetching the same trip share one request).
  //  - Background refetch on reconnect.
  //  - Built-in loading/error states.
  //
  // We cast to the local TripDetail type because the centralized type in
  // `@/lib/queries/types` is out of sync with the actual backend response
  // (it lacks `seatMap.decks`, `route.geometry`, `pricing.basePriceAdult`,
  // `discountPrograms`, etc.). The local type matches the backend exactly.
  const { data: rawDetail, isLoading: loading, isError, refetch } = useTripDetail(tripId)
  const detail = rawDetail as unknown as TripDetail | undefined

  // When detail data arrives (or changes), reset seat selection + default
  // boarding/dropping points. This replaces the old fetch-then-setState pattern.
  useEffect(() => {
    if (!detail) return
    // Intentional effect-synced state (dialog reset-on-open /
    // server-data snapshot / DOM-availability gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSeats([])
    // Guard the whole chain — a malformed payload (or a legacy shape
    // without pickup points) must not crash the dialog on open.
    const points = detail.pickupPoints ?? []
    if (points.length > 0) {
      setBoardingPoint(points[0].id)
      setDroppingPoint(points[points.length - 1].id)
    }
  }, [detail])

  const toggleSeat = ({ id }: TripSeat) => {
    setSelectedSeats((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : prev.length < searchParams.adults + searchParams.children
          ? [...prev, id]
          : prev,
    )
  }

  const maxSeats = searchParams.adults + searchParams.children
  // Guard every nested access — a malformed payload (200 with an
  // unexpected shape) previously crashed the dialog with
  // "Cannot read properties of undefined (reading 'decks')".
  const selectedSeatDetails =
    detail?.seatMap?.decks
      ?.flatMap((d) => d.rows.flatMap((r) => r.seats))
      .filter((s) => selectedSeats.includes(s.id)) ?? []

  const total = selectedSeatDetails.reduce((sum, s) => sum + s.finalPrice, 0)

  const proceed = () => {
    setBookingContext({
      tripId,
      seatIds: selectedSeats,
      boardingPointId: boardingPoint,
      droppingPointId: droppingPoint,
    })
    // Single-dialog checkout: the booking wizard takes over THIS dialog's
    // body (see the `bookingStep !== 'idle'` branch below) — no second
    // dialog stacked on top of the trip information anymore. Closing the
    // wizard (or finishing it) returns to the trip view.
    setBookingStep('passengers')
  }

  const canProceed = selectedSeats.length === maxSeats && !!boardingPoint && !!droppingPoint

  // Safety: if the dialog unmounts mid-booking (browser Back, route
  // change), reset the flow state — otherwise `bookingStep` stays stuck
  // non-idle with nothing rendered AND the body scroll lock stays on.
  useEffect(() => {
    return () => {
      if (useBookingFlow.getState().step !== 'idle') {
        useBookingFlow.getState().setStep('idle')
        useBookingFlow.getState().setContext(null)
      }
    }
  }, [])

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-7xl w-[97vw] max-h-[92dvh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Booking wizard takes over the dialog body (single-dialog
            checkout) while the flow is active. */}
        {bookingStep !== 'idle' ? (
          <>
            <DialogTitle className="sr-only">{t('bookingFlow.completeBooking')}</DialogTitle>
            <DialogDescription className="sr-only">{t('tripDetail.loadingDesc')}</DialogDescription>
            <BookingFlow />
          </>
        ) : loading || !detail ? (
          isError ? (
            // Error branch — previously a 404/network failure left the
            // skeleton spinning forever (e.g. stale "recently viewed"
            // entries or old share links).
            <>
              <DialogTitle className="sr-only">{t('tripDetail.errorTitle')}</DialogTitle>
              <div className="flex min-h-60 flex-1 items-center justify-center p-6">
                <ErrorState description={t('tripDetail.errorDesc')} onRetry={() => refetch()} />
              </div>
            </>
          ) : (
            <>
              <DialogTitle className="sr-only">{t('tripDetail.loadingTitle')}</DialogTitle>
              <DialogDescription className="sr-only">
                {t('tripDetail.loadingDesc')}
              </DialogDescription>
              <TripDetailSkeleton />
            </>
          )
        ) : (
          <>
            <TripInfo
              detail={detail}
              onShare={() => {
                openShare({
                  tripId: detail.trip.id,
                  fromName: detail.from.name,
                  toName: detail.to.name,
                  departureAt: detail.trip.departureAt ?? undefined,
                  departureTime: detail.trip.departureTime ?? undefined,
                  brandName: detail.brand.name,
                  brandAccent: detail.brand.accentColor,
                  brandRating: detail.brand.rating,
                  minPrice: detail.pricing.basePriceAdult,
                  vehicleTypeLabel: detail.busLayout.vehicleTypeLabel,
                })
              }}
            />

            {/* Body */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] lg:grid-cols-[1.3fr_420px] flex-1 min-h-0 overflow-hidden">
              {/* Left: seat map / route / info tabs */}
              <div className="overflow-hidden md:border-r flex flex-col min-h-0">
                <Tabs defaultValue="seats" className="flex-1 flex flex-col min-h-0">
                  {/* Proportional tab strip — equal-width segments that
                      together fill the parent width (grid, not
                      content-sized). 5 columns on mobile (the points tab
                      is mobile-only), 4 from md up. */}
                  <div className="shrink-0">
                    <TabsList className="rounded-none border-b bg-slate-50 p-0 h-auto w-full grid grid-cols-5 md:grid-cols-4">
                      <TabsTrigger
                        value="seats"
                        className="gap-1.5 rounded-none border-r border-slate-200/70 flex flex-col sm:flex-row items-center justify-center py-2.5 px-1 text-[11px] sm:text-xs leading-tight whitespace-normal"
                      >
                        <Bus className="h-4 w-4 shrink-0" /> {t('booking.seatSelector')}
                      </TabsTrigger>
                      {/* Mobile-only tab — pickup/drop-off selection used to be
                          desktop-only (hidden md:flex right rail), so phone
                          users could never change boarding points. */}
                      <TabsTrigger
                        value="points"
                        className="gap-1.5 rounded-none border-r border-slate-200/70 md:border-r-0 flex flex-col sm:flex-row items-center justify-center py-2.5 px-1 text-[11px] sm:text-xs leading-tight whitespace-normal md:hidden"
                      >
                        <ArrowLeftRight className="h-4 w-4 shrink-0" /> {t('tripDetail.tabPoints')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="route"
                        className="gap-1.5 rounded-none border-r border-slate-200/70 flex flex-col sm:flex-row items-center justify-center py-2.5 px-1 text-[11px] sm:text-xs leading-tight whitespace-normal"
                      >
                        <MapPin className="h-4 w-4 shrink-0" /> {t('tripDetail.tabRoute')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="info"
                        className="gap-1.5 rounded-none border-r border-slate-200/70 flex flex-col sm:flex-row items-center justify-center py-2.5 px-1 text-[11px] sm:text-xs leading-tight whitespace-normal"
                      >
                        <CheckCircle2 className="h-4 w-4 shrink-0" /> {t('tripDetail.tabPolicy')}
                      </TabsTrigger>
                      <TabsTrigger
                        value="reviews"
                        className="gap-1.5 rounded-none flex flex-col sm:flex-row items-center justify-center py-2.5 px-1 text-[11px] sm:text-xs leading-tight whitespace-normal"
                      >
                        <MessageSquareQuote className="h-4 w-4 shrink-0" />{' '}
                        {t('tripDetail.tabReviews')}
                      </TabsTrigger>
                    </TabsList>
                  </div>

                  {/* The tab body fills the remaining dialog height and scrolls —
                      flex chain instead of magic max-h arithmetic; dvh tracks the
                      iOS dynamic toolbar. */}
                  <ScrollArea className="flex-1 min-h-0">
                    <TabsContent value="seats" className="m-0 p-4">
                      <div className="mb-3 flex items-center justify-between text-sm">
                        <div className="font-semibold">
                          {t('tripDetail.chooseSeats', { count: maxSeats })}
                          <span className="text-muted-foreground font-normal ml-1">
                            ({selectedSeats.length}/{maxSeats})
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {detail.trip.availableSeats}/{detail.trip.totalSeats}{' '}
                          {t('common.seatsAvailable')}
                        </div>
                      </div>
                      <SeatMap
                        decks={detail.seatMap?.decks ?? []}
                        selectedSeatIds={selectedSeats}
                        onToggleSeat={toggleSeat}
                        maxSeats={maxSeats}
                      />
                    </TabsContent>

                    {/* Mobile-only boarding/dropping tab (mirrors the md+
                        right rail — see comment on the tab trigger). */}
                    <TabsContent value="points" className="m-0 p-4 md:hidden">
                      <BoardingPointsInline
                        detail={detail}
                        boardingPoint={boardingPoint}
                        droppingPoint={droppingPoint}
                        onSetBoardingPoint={setBoardingPoint}
                        onSetDroppingPoint={setDroppingPoint}
                      />
                    </TabsContent>

                    <TabsContent value="route" className="m-0 p-4 space-y-5">
                      {/* Real Leaflet map with the route geometry polyline
                          and EVERY pickup/drop point marked + numbered
                          (replaces the old stylized SVG sketch). */}
                      <RouteScheduleMap
                        geometry={
                          detail.route.geometry ?? [
                            [detail.from.lat, detail.from.lon],
                            [detail.to.lat, detail.to.lon],
                          ]
                        }
                        pickupPoints={detail.pickupPoints}
                        fromName={detail.from.name}
                        toName={detail.to.name}
                        accentColor={detail.brand.accentColor}
                      />
                      <RouteTimeline
                        departureDate={detail.trip.departureDate}
                        departureTime={detail.trip.departureTime}
                        arrivalTime={detail.trip.arrivalTime}
                        fromName={detail.from.name}
                        toName={detail.to.name}
                        pickupPoints={detail.pickupPoints}
                        schedulePoints={detail.schedulePoints}
                      />
                    </TabsContent>

                    {/* The mock weather tab was removed — it fabricated a
                        deterministic "forecast" from a string hash and
                        presented it as real advice. Same fate for the
                        simulated live-tracking, static travel-tips and
                        mock bus-info tabs: no real data, no tab. */}

                    <TabsContent value="info" className="m-0 p-4 space-y-4">
                      <PolicyBlock
                        title={t('search.sort.price')}
                        items={[
                          {
                            label: t('booking.passengerType.adult'),
                            value: formatCurrency(detail.pricing.basePriceAdult, currency),
                          },
                          {
                            label: t('tripDetail.childFare'),
                            value: formatCurrency(detail.pricing.basePriceChild, currency),
                          },
                        ]}
                      />
                      {(detail.discountPrograms?.length ?? 0) > 0 && (
                        <PolicyBlock
                          title={t('tripDetail.specialOffers')}
                          items={(detail.discountPrograms ?? []).map((dp) => ({
                            label: `${dp.passengerType === 'child' ? t('booking.passengerType.child') : dp.passengerType === 'student' ? t('tripDetail.passengerStudent') : t('tripDetail.passengerSenior')} ${t('tripDetail.ageRange', { min: dp.minAge, max: dp.maxAge })}`,
                            value: t('tripDetail.discountValue', { value: dp.value }),
                          }))}
                        />
                      )}
                      <PolicyBlock
                        title={t('tripDetail.luggagePolicy')}
                        items={[
                          { label: t('tripDetail.carryOn'), value: t('tripDetail.carryOnMax') },
                          {
                            label: t('tripDetail.largeLuggage'),
                            value: t('tripDetail.underCompartment'),
                          },
                          {
                            label: t('tripDetail.prohibitedItemsLabel'),
                            value: t('tripDetail.prohibitedItems'),
                          },
                        ]}
                      />
                      <PolicyBlock
                        title={t('tripDetail.changeCancelPolicy')}
                        items={[
                          { label: t('tripDetail.before24h'), value: t('tripDetail.refund90') },
                          { label: t('tripDetail.before12h'), value: t('tripDetail.refund70') },
                          { label: t('tripDetail.after12h'), value: t('tripDetail.noRefund') },
                        ]}
                      />
                    </TabsContent>

                    <TabsContent value="reviews" className="m-0 p-4">
                      <ReviewsList
                        brandId={detail.brand.id}
                        routeId={detail.route.id}
                        brandName={detail.brand.name}
                        routeName={detail.route.name}
                        accentColor={detail.brand.accentColor}
                      />
                    </TabsContent>
                  </ScrollArea>
                </Tabs>
              </div>

              {/* Right: pickup/drop + summary */}
              <BoardingPoints
                detail={detail}
                boardingPoint={boardingPoint}
                droppingPoint={droppingPoint}
                onSetBoardingPoint={setBoardingPoint}
                onSetDroppingPoint={setDroppingPoint}
                selectedSeatDetails={selectedSeatDetails}
                currency={currency}
              />
            </div>

            {/* Sticky CTA bar */}
            <PriceSummary
              selectedSeatsCount={selectedSeats.length}
              maxSeats={maxSeats}
              total={total}
              canProceed={canProceed}
              onProceed={proceed}
              currency={currency}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
