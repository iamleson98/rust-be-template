'use client'

import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftRight,
  Bus,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquareQuote,
  Users,
} from 'lucide-react'
import type { TripDetail, TripSeat } from '@/api'
import { ErrorState } from '@/components/error-state'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookingFlow } from '@/features/booking/flow/booking-flow'
import { RouteScheduleMap } from '@/features/map/route-schedule-map'
import { ReviewsList } from '@/features/reviews/reviews-list'
import { SeatMap } from '@/features/seat-plan'
import { useTripDetail } from '@/features/trips/api'
import { useT } from '@/lib/i18n'
import { useBookingFlow } from '@/stores/booking-flow'
import { useSession } from '@/stores/session'
import { useUi } from '@/stores/ui'
import { BoardingPoints } from './boarding-points'
import { FareTable } from './fare-table'
import { PolicyBlock } from './policy-block'
import { PriceSummary } from './price-summary'
import { StopTimeline } from './stop-timeline'
import { TripDetailSkeleton } from './trip-detail-skeleton'
import { TripInfo } from './trip-info'
import { tripStops } from './trip-stops'

/** Seats one booking may hold. */
const MAX_SEATS = 10

const TAB =
  'flex flex-col items-center justify-center gap-1.5 whitespace-normal rounded-none border-r border-slate-200/70 px-1 py-2.5 text-[11px] leading-tight sm:flex-row sm:text-xs'

/**
 * A trip in full: seat map, stops, fares and reviews, then the booking wizard, which
 * takes over the same dialog once the customer goes on to book.
 */
export function TripDetailDialog({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const t = useT()
  const bookingStep = useBookingFlow((s) => s.step)
  const { data: detail, isError, refetch } = useTripDetail(tripId)

  // Leaving mid-booking (Back, a route change) must not leave the flow stuck open.
  useEffect(
    () => () => {
      const flow = useBookingFlow.getState()
      if (flow.step !== 'idle') {
        flow.setStep('idle')
        flow.setContext(null)
      }
    },
    [],
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* Full screen on phones (a multi-step flow needs the whole height). */}
      <DialogContent className="flex max-h-[92dvh] w-[97vw] max-w-7xl flex-col gap-0 overflow-hidden p-0 max-md:h-dvh max-md:max-h-dvh max-md:w-screen max-md:max-w-none max-md:rounded-none max-md:border-0">
        {bookingStep !== 'idle' ? (
          <>
            <DialogTitle className="sr-only">{t('bookingFlow.completeBooking')}</DialogTitle>
            <DialogDescription className="sr-only">{t('tripDetail.loadingDesc')}</DialogDescription>
            <BookingFlow />
          </>
        ) : detail ? (
          <TripView detail={detail} />
        ) : isError ? (
          <>
            <DialogTitle className="sr-only">{t('tripDetail.errorTitle')}</DialogTitle>
            <div className="flex min-h-60 flex-1 items-center justify-center p-6">
              <ErrorState description={t('tripDetail.errorDesc')} onRetry={() => refetch()} />
            </div>
          </>
        ) : (
          <>
            <DialogTitle className="sr-only">{t('tripDetail.loadingTitle')}</DialogTitle>
            <DialogDescription className="sr-only">{t('tripDetail.loadingDesc')}</DialogDescription>
            <TripDetailSkeleton />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TripView({ detail }: { detail: TripDetail }) {
  const t = useT()
  const navigate = useNavigate()
  const signedIn = useSession((s) => !!s.user)
  const openShare = useUi((s) => s.openShare)
  const setBookingStep = useBookingFlow((s) => s.setStep)
  const setBookingContext = useBookingFlow((s) => s.setContext)
  // Back from signing in: the seats and stops picked before are still picked.
  const [saved] = useState(() => {
    const context = useBookingFlow.getState().context
    return context?.tripId === detail.trip.id ? context : null
  })
  const [picked, setPicked] = useState<string[]>(saved?.seatIds ?? [])
  const [boarding, setBoarding] = useState(saved?.boardingPointId ?? '')
  const [dropping, setDropping] = useState(saved?.droppingPointId ?? '')

  const seats = detail.seatMap.decks.flatMap((deck) => deck.rows.flatMap((row) => row.seats))
  // A refetch may show a picked seat sold in the meantime: it simply drops out.
  const selected = seats.filter((seat) => picked.includes(seat.id) && seat.status === 'available')
  const points = [...detail.pickupPoints].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
  const boardingId = boarding || points[0]?.id || ''
  const droppingId = dropping || points.at(-1)?.id || ''
  const { bookable } = detail.trip
  const canProceed =
    bookable && selected.length > 0 && (points.length === 0 || (!!boardingId && !!droppingId))
  const { stops, timetable } = tripStops(detail)

  const toggleSeat = ({ id }: TripSeat) =>
    setPicked((prev) =>
      prev.includes(id)
        ? prev.filter((s) => s !== id)
        : prev.length < MAX_SEATS
          ? [...prev, id]
          : prev,
    )

  const proceed = () => {
    setBookingContext({
      tripId: detail.trip.id,
      seatIds: selected.map((seat) => seat.id),
      boardingPointId: points.length ? boardingId : null,
      droppingPointId: points.length ? droppingId : null,
    })
    // Tickets belong to an account: sign in first, then come straight back.
    if (signedIn) setBookingStep('passengers')
    else navigate({ to: '/login', search: { redirect: `/trips/${detail.trip.id}` } })
  }

  const stopPicker = (
    <BoardingPoints
      points={points}
      boardingPoint={boardingId}
      droppingPoint={droppingId}
      onBoardingPoint={setBoarding}
      onDroppingPoint={setDropping}
    />
  )
  const timeline = (
    <StopTimeline
      title={t('tripDetail.scheduleTimelineTitle')}
      aside={stops.some((s) => s.time) ? t('tripDetail.localTimeNote') : undefined}
      stops={stops}
    />
  )

  return (
    <>
      <TripInfo
        detail={detail}
        onShare={() =>
          openShare({
            tripId: detail.trip.id,
            fromName: detail.from.name ?? '',
            toName: detail.to.name ?? '',
            departureAt: detail.trip.departureAt ?? undefined,
            departureTime: detail.trip.departureTime ?? undefined,
            brandName: detail.brand.name ?? '',
            brandAccent: detail.brand.accentColor ?? undefined,
            brandRating: detail.brand.rating,
            minPrice: detail.pricing.fares[0]?.priceAdult ?? detail.pricing.basePriceAdult,
            vehicleTypeLabel: detail.busLayout.vehicleTypeLabel,
          })
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_320px] lg:grid-cols-[1.3fr_420px]">
        <div className="flex min-h-0 flex-col overflow-hidden md:border-r">
          <Tabs defaultValue="seats" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="grid h-auto w-full shrink-0 grid-cols-5 rounded-none border-b bg-slate-50 p-0 md:grid-cols-4">
              <TabsTrigger value="seats" className={TAB}>
                <Bus className="h-4 w-4 shrink-0" /> {t('booking.seatSelector')}
              </TabsTrigger>
              <TabsTrigger value="points" className={`${TAB} md:hidden`}>
                <ArrowLeftRight className="h-4 w-4 shrink-0" /> {t('tripDetail.tabPoints')}
              </TabsTrigger>
              <TabsTrigger value="route" className={TAB}>
                <MapPin className="h-4 w-4 shrink-0" /> {t('tripDetail.tabRoute')}
              </TabsTrigger>
              <TabsTrigger value="info" className={TAB}>
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {t('tripDetail.tabPolicy')}
              </TabsTrigger>
              <TabsTrigger value="reviews" className={`${TAB} border-r-0`}>
                <MessageSquareQuote className="h-4 w-4 shrink-0" /> {t('tripDetail.tabReviews')}
              </TabsTrigger>
            </TabsList>

            <ScrollArea className="min-h-0 flex-1">
              <TabsContent value="seats" className="m-0 p-4">
                <div className="mb-3 flex items-center justify-between text-sm">
                  <div className="font-semibold">
                    {t('tripDetail.chooseSeatsUpTo', { max: MAX_SEATS })}
                    <span className="ml-1 font-normal text-muted-foreground">
                      ({selected.length}/{MAX_SEATS})
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5" />
                    {detail.trip.availableSeats}/{detail.trip.totalSeats}{' '}
                    {t('common.seatsAvailable')}
                  </div>
                </div>
                {!bookable && (
                  <p className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <Clock className="h-4 w-4 shrink-0" />
                    {t('tripDetail.notBookable')}
                  </p>
                )}
                <SeatMap
                  decks={detail.seatMap.decks}
                  selectedSeatIds={selected.map((seat) => seat.id)}
                  onToggleSeat={toggleSeat}
                  maxSeats={bookable ? MAX_SEATS : 0}
                  childFare={detail.pricing.childFare}
                />
              </TabsContent>

              <TabsContent value="points" className="m-0 space-y-5 p-4 md:hidden">
                {timeline}
                {stopPicker}
              </TabsContent>

              <TabsContent value="route" className="m-0 space-y-5 p-4">
                <RouteScheduleMap
                  geometry={[
                    [detail.from.lat, detail.from.lon],
                    [detail.to.lat, detail.to.lon],
                  ]}
                  pickupPoints={detail.pickupPoints}
                  fromName={detail.from.name ?? ''}
                  toName={detail.to.name ?? ''}
                  accentColor={detail.brand.accentColor ?? undefined}
                />
                <StopTimeline
                  title={t('tripDetail.routeTimelineTitle')}
                  stops={stops}
                  footer={
                    !timetable && (
                      <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-muted-foreground">
                        {t('tripDetail.timetableFallbackNotice')}
                      </p>
                    )
                  }
                />
              </TabsContent>

              <TabsContent value="info" className="m-0 space-y-4 p-4">
                <FareTable pricing={detail.pricing} />
                <PolicyBlock
                  title={t('tripDetail.changeCancelPolicy')}
                  items={[
                    { label: t('tripDetail.before24h'), value: t('tripDetail.refund90') },
                    { label: t('tripDetail.before4h'), value: t('tripDetail.refund50') },
                    { label: t('tripDetail.within4h'), value: t('tripDetail.noRefund') },
                  ]}
                />
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
              </TabsContent>

              <TabsContent value="reviews" className="m-0 p-4">
                <ReviewsList
                  brandId={detail.brand.id ?? ''}
                  routeId={detail.route.id}
                  brandName={detail.brand.name ?? ''}
                  routeName={detail.route.name}
                  accentColor={detail.brand.accentColor ?? undefined}
                />
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>

        <aside className="hidden min-h-0 flex-col bg-slate-50 md:flex">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-5 p-4 md:p-5">
              {timeline}
              {points.length > 0 && <div className="border-t border-slate-200" />}
              {stopPicker}
            </div>
          </ScrollArea>
        </aside>
      </div>

      <PriceSummary
        seats={selected}
        maxSeats={MAX_SEATS}
        closed={!bookable}
        signedIn={signedIn}
        canProceed={canProceed}
        onRemove={toggleSeat}
        onProceed={proceed}
      />
    </>
  )
}
