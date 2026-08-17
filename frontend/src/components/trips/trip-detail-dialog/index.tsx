'use client'

/**
 * TripDetailDialog — full-screen modal showing trip details + the
 * seat-selection / pickup-point / proceed-to-booking flow.
 *
 * This is the named-export entry point. It owns the dialog's state
 * (selected seats, boarding/dropping points, fetched detail) and
 * orchestrates the 8 left-side tabs (seats/route/tracking/businfo/
 * weather/tips/info/reviews) plus the right-rail boarding points
 * and the sticky price-summary CTA.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 175-665). Pure refactor — same UI, same handlers, same
 * state shape; only the imports moved.
 */

import { useEffect, useState } from 'react'
import { useApp } from '@/lib/store'
import { useTripDetail } from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SeatMap, type SeatInv } from '@/components/trips/seat-map'
import { RouteMapPreview } from '@/components/map/route-map-preview'
import { ReviewsList } from '@/components/reviews/reviews-list'
import { TripDetailSkeleton } from '@/components/layout/skeletons'
import { LiveTracking } from '@/components/map/live-tracking'
import { formatCurrency } from '@/lib/currency'
import {
  Bus,
  MapPin,
  Radar,
  Cloud,
  Compass,
  CheckCircle2,
  MessageSquareQuote,
  Users,
} from 'lucide-react'
import type { TripDetailDialogData as TripDetail } from './types'
import { TripInfo } from './trip-info'
import { BoardingPoints } from './boarding-points'
import { PriceSummary } from './price-summary'
import { BusInfoTab } from './bus-info-tab'
import { WeatherTab } from './weather-tab'
import { TravelTipsTab } from './travel-tips-tab'
import { RouteTimeline } from './route-timeline'
import { PolicyBlock } from './policy-block'

export function TripDetailDialog({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const { setBookingStep, setBookingContext, searchParams, currency, setShareOpen, setShareTripData } = useApp()
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
  const { data: rawDetail, isLoading: loading } = useTripDetail(tripId)
  const detail = rawDetail as unknown as TripDetail | undefined

  // When detail data arrives (or changes), reset seat selection + default
  // boarding/dropping points. This replaces the old fetch-then-setState pattern.
  useEffect(() => {
    if (!detail) return
    setSelectedSeats([])
    if (detail?.pickupPoints?.length) {
      setBoardingPoint(detail.pickupPoints[0].id)
      setDroppingPoint(detail.pickupPoints[detail.pickupPoints.length - 1].id)
    }
  }, [detail])

  const toggleSeat = (seatId: string) => {
    setSelectedSeats((prev) =>
      prev.includes(seatId) ? prev.filter((s) => s !== seatId) : prev.length < searchParams.adults + searchParams.children ? [...prev, seatId] : prev
    )
  }

  const maxSeats = searchParams.adults + searchParams.children
  const selectedSeatDetails = detail?.seatMap.decks
    .flatMap((d) => d.rows.flatMap((r) => r.seats.filter(Boolean) as SeatInv[]))
    .filter((s) => selectedSeats.includes(s.id)) ?? []

  const total = selectedSeatDetails.reduce((sum, s) => sum + s.finalPrice, 0)

  const proceed = () => {
    setBookingContext({
      tripId,
      seatIds: selectedSeats,
      boardingPointId: boardingPoint,
      droppingPointId: droppingPoint,
    })
    // Don't navigate away — the BookingDialog overlay renders on top of
    // the trip detail page (it's a persistent overlay in the root layout,
    // gated by `bookingStep !== 'idle'`). The trip detail stays mounted
    // so the user can return to it if they cancel the booking.
    setBookingStep('passengers')
  }

  const canProceed = selectedSeats.length === maxSeats && !!boardingPoint && !!droppingPoint

  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-7xl w-[97vw] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col">
        {loading || !detail ? (
          <>
            <DialogTitle className="sr-only">Đang tải chi tiết chuyến xe</DialogTitle>
            <DialogDescription className="sr-only">
              Vui lòng đợi trong khi chúng tôi tải thông tin chuyến xe.
            </DialogDescription>
            <TripDetailSkeleton />
          </>
        ) : (
          <>
            <TripInfo
              detail={detail}
              onShare={() => {
                setShareTripData({
                  tripId: detail.trip.id,
                  fromName: detail.from.name,
                  toName: detail.to.name,
                  departureAt: detail.trip.departureAt,
                  departureTime: detail.trip.departureTime,
                  brandName: detail.brand.name,
                  brandAccent: detail.brand.accentColor,
                  brandRating: detail.brand.rating,
                  minPrice: detail.pricing.basePriceAdult,
                  vehicleTypeLabel: detail.busLayout.vehicleTypeLabel,
                })
                setShareOpen(true)
              }}
            />

            {/* Body */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] lg:grid-cols-[1.3fr_420px] flex-1 min-h-0 overflow-hidden">
              {/* Left: seat map / route / info tabs */}
              <div className="overflow-hidden md:border-r flex flex-col min-h-0">
                <Tabs defaultValue="seats" className="flex-1 flex flex-col min-h-0">
                  <ScrollArea className="shrink-0">
                    <TabsList className="rounded-none border-b bg-slate-50 justify-start px-3 h-auto py-2 w-max">
                      <TabsTrigger value="seats" className="gap-1.5">
                        <Bus className="h-4 w-4" /> Sơ đồ ghế
                      </TabsTrigger>
                      <TabsTrigger value="route" className="gap-1.5">
                        <MapPin className="h-4 w-4" /> Lộ trình
                      </TabsTrigger>
                      <TabsTrigger value="tracking" className="gap-1.5">
                        <Radar className="h-4 w-4" /> Theo dõi xe
                      </TabsTrigger>
                      <TabsTrigger value="businfo" className="gap-1.5">
                        <Bus className="h-4 w-4" /> Thông tin xe
                      </TabsTrigger>
                      <TabsTrigger value="weather" className="gap-1.5">
                        <Cloud className="h-4 w-4" /> Thời tiết
                      </TabsTrigger>
                      <TabsTrigger value="tips" className="gap-1.5">
                        <Compass className="h-4 w-4" /> Mẹo du lịch
                      </TabsTrigger>
                      <TabsTrigger value="info" className="gap-1.5">
                        <CheckCircle2 className="h-4 w-4" /> Chính sách
                      </TabsTrigger>
                      <TabsTrigger value="reviews" className="gap-1.5">
                        <MessageSquareQuote className="h-4 w-4" /> Đánh giá
                      </TabsTrigger>
                    </TabsList>
                  </ScrollArea>

                  <ScrollArea className="flex-1 max-h-[55vh] lg:max-h-[calc(92vh-280px)]">
                    <TabsContent value="seats" className="m-0 p-4">
                      <div className="mb-3 flex items-center justify-between text-sm">
                        <div className="font-semibold">
                          Chọn {maxSeats} ghế
                          <span className="text-muted-foreground font-normal ml-1">
                            ({selectedSeats.length}/{maxSeats})
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          {detail.trip.availableSeats}/{detail.trip.totalSeats} chỗ trống
                        </div>
                      </div>
                      <SeatMap
                        decks={detail.seatMap.decks}
                        selectedSeatIds={selectedSeats}
                        onToggleSeat={toggleSeat}
                        maxSeats={maxSeats}
                      />
                    </TabsContent>

                    <TabsContent value="route" className="m-0 p-4 space-y-5">
                      <RouteMapPreview
                        geometry={detail.route.geometry}
                        pickupPoints={detail.pickupPoints}
                        fromName={detail.from.name}
                        toName={detail.to.name}
                        accentColor={detail.brand.accentColor}
                      />
                      <RouteTimeline
                        departureTime={detail.trip.departureTime}
                        arrivalTime={detail.trip.arrivalTime}
                        fromName={detail.from.name}
                        toName={detail.to.name}
                        durationMin={detail.route.durationMin}
                        pickupPoints={detail.pickupPoints}
                      />
                    </TabsContent>

                    <TabsContent value="tracking" className="m-0 p-4">
                      <LiveTracking detail={detail} />
                    </TabsContent>

                    <TabsContent value="businfo" className="m-0 p-4">
                      <BusInfoTab detail={detail} />
                    </TabsContent>

                    <TabsContent value="weather" className="m-0 p-4">
                      <WeatherTab destination={detail.to.name} arrivalDate={detail.trip.arrivalAt} />
                    </TabsContent>

                    <TabsContent value="tips" className="m-0 p-4">
                      <TravelTipsTab destination={detail.to.name} />
                    </TabsContent>

                    <TabsContent value="info" className="m-0 p-4 space-y-4">
                      <PolicyBlock
                        title="Giá vé"
                        items={[
                          { label: 'Người lớn', value: formatCurrency(detail.pricing.basePriceAdult, currency) },
                          { label: 'Trẻ em (0-9 tuổi)', value: formatCurrency(detail.pricing.basePriceChild, currency) },
                        ]}
                      />
                      {detail.discountPrograms.length > 0 && (
                        <PolicyBlock
                          title="Ưu đãi đặc biệt"
                          items={detail.discountPrograms.map((dp) => ({
                            label: `${dp.passengerType === 'child' ? 'Trẻ em' : dp.passengerType === 'student' ? 'Học sinh/Sinh viên' : 'Người cao tuổi'} (${dp.minAge}-${dp.maxAge} tuổi)`,
                            value: `Giảm ${dp.value}%`,
                          }))}
                        />
                      )}
                      <PolicyBlock
                        title="Quy định hành lý"
                        items={[
                          { label: 'Hành lý xách tay', value: 'Tối đa 7kg' },
                          { label: 'Vali lớn', value: 'Để dưới khoang xe' },
                          { label: 'Hàng cấm', value: 'Dễ cháy nổ, mùi mạnh' },
                        ]}
                      />
                      <PolicyBlock
                        title="Đổi / Huỷ vé"
                        items={[
                          { label: 'Trước 24h', value: 'Hoàn 90%' },
                          { label: 'Trước 12h', value: 'Hoàn 70%' },
                          { label: 'Sau 12h', value: 'Không hoàn' },
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
