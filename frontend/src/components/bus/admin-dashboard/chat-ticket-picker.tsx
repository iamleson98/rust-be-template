'use client'

/**
 * ChatTicketPicker — the "Đặt vé cho khách" dialog used inside the admin
 * chat workspace. Lets an employee create a booking on behalf of the chat
 * user without leaving the conversation.
 *
 * Flow:
 *   1. Search trips (from / to / date) — reuses `useTripSearch`.
 *   2. Pick a trip → load seat map (`useTripDetail`) → select seats.
 *   3. Pick boarding + dropping points.
 *   4. Enter passenger info (auto-filled from the channel's user when
 *      available — `contactName`, `contactPhone`, `userId`).
 *   5. Confirm → `useAdminCreateBooking` POSTs to `/api/admin/bookings`.
 *   6. On success, the parent sends a chat message with `kind: 'ticket'`
 *      containing the booking-card payload (so the customer sees a nicely
 *      rendered ticket card inline in the conversation).
 *
 * Designed to be mobile-friendly (Step indicator + scrollable content)
 * and accessible (every interactive element has an aria-label).
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Calendar,
  Search,
  Bus,
  Clock,
  MapPin,
  User,
  Phone,
  Armchair,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Ticket as TicketIcon,
  X,
  Sparkles,
} from 'lucide-react'
import { format } from 'date-fns'
import { vi } from 'date-fns/locale'
import {
  usePlaceSearch,
  useTripSearch,
  useTripDetail,
  useAdminCreateBooking,
} from '@/lib/queries'
import type { TripResult, TripDetail } from '@/lib/api/types.gen'
import type { Channel } from './types'

// ── Types ───────────────────────────────────────────────────

type Seat = {
  id: string
  code: string
  row: number
  col: number
  deck: number
  seatClass: string
  priceMultiplier: number
  status: string
  finalPrice: number
}

type Passenger = {
  seatId: string
  seatCode: string
  name: string
  type: 'adult' | 'child' | 'infant'
  age: number
}

type Step = 'search' | 'seats' | 'passenger' | 'confirm'

export type CreatedTicketPayload = {
  bookingId: string
  bookingCode: string
  status: string
  totalAmount: number
  currency: string | null
  contactName: string
  contactPhone: string
  trip: {
    routeName: string | null
    fromName: string | null
    toName: string | null
    departureDate: string | null
    departureAt: string | null
    brandName: string | null
    brandAccent: string | null
    brandLogo: string | null
  }
  seats: { code: string; passengerName: string; price: number }[]
  createdAt: string
}

// ── Component ───────────────────────────────────────────────

export function ChatTicketPicker({
  open,
  onOpenChange,
  channel,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  channel: Channel | null
  /** Called after a booking is successfully created. The parent uses this
   * to send a `kind: 'ticket'` chat message with the booking-card payload. */
  onCreated: (payload: CreatedTicketPayload) => void
}) {
  // ── Step state ──
  const [step, setStep] = useState<Step>('search')
  const [selectedTrip, setSelectedTrip] = useState<TripResult | null>(null)
  const [selectedSeats, setSelectedSeats] = useState<Seat[]>([])
  const [boardingPointId, setBoardingPointId] = useState<string>('')
  const [droppingPointId, setDroppingPointId] = useState<string>('')
  const [passengers, setPassengers] = useState<Passenger[]>([])
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [autoConfirm, setAutoConfirm] = useState(true)

  // ── Search state ──
  const [fromQuery, setFromQuery] = useState('')
  const [toQuery, setToQuery] = useState('')
  const [fromPlace, setFromPlace] = useState<{ id: string; name: string } | null>(null)
  const [toPlace, setToPlace] = useState<{ id: string; name: string } | null>(null)
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  // ── Reset state when dialog closes ──
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep('search')
        setSelectedTrip(null)
        setSelectedSeats([])
        setBoardingPointId('')
        setDroppingPointId('')
        setPassengers([])
        setFromQuery('')
        setToQuery('')
        setFromPlace(null)
        setToPlace(null)
        setContactEmail('')
      }, 200)
      return () => clearTimeout(t)
    }
    // Pre-fill contact info from the channel's user.
    if (channel?.user) {
      setContactName(channel.user.fullName ?? '')
      setContactPhone(channel.user.phone ?? '')
    }
  }, [open, channel])

  // ── Data hooks ──
  const fromSearch = usePlaceSearch(fromQuery, { enabled: fromQuery.length >= 1 })
  const toSearch = usePlaceSearch(toQuery, { enabled: toQuery.length >= 1 })
  const tripSearch = useTripSearch(
    fromPlace && toPlace && date
      ? { from: fromPlace.name, to: toPlace.name, date }
      : null,
  )
  const tripDetail = useTripDetail(selectedTrip?.tripId)
  const createBooking = useAdminCreateBooking()

  // ── Derived state ──
  const trip = tripDetail.data
  const seatMap = trip?.seatMap ?? []
  const pickupPoints = trip?.pickupPoints ?? []
  const boardingPoints = useMemo(
    () => pickupPoints.filter((p) => true), // all points can be boarding
    [pickupPoints],
  )
  const droppingPoints = pickupPoints // symmetric

  // Auto-select first boarding/dropping when trip loads.
  useEffect(() => {
    if (trip && !boardingPointId && boardingPoints[0]) {
      setBoardingPointId(boardingPoints[0].id)
    }
    if (trip && !droppingPointId && droppingPoints[0]) {
      setDroppingPointId(droppingPoints[droppingPoints.length - 1]?.id ?? droppingPoints[0]?.id ?? '')
    }
  }, [trip, boardingPointId, droppingPointId, boardingPoints, droppingPoints])

  // ── Handlers ──
  const toggleSeat = useCallback((seat: Seat) => {
    setSelectedSeats((prev) => {
      const exists = prev.find((s) => s.id === seat.id)
      if (exists) {
        return prev.filter((s) => s.id !== seat.id)
      }
      if (prev.length >= 6) {
        toast.warning('Tối đa 6 ghế / lần đặt')
        return prev
      }
      return [...prev, seat]
    })
  }, [])

  // When selectedSeats changes, sync passengers array.
  useEffect(() => {
    setPassengers((prev) => {
      const next: Passenger[] = selectedSeats.map((s) => {
        const existing = prev.find((p) => p.seatId === s.id)
        if (existing) return existing
        return {
          seatId: s.id,
          seatCode: s.code,
          name: contactName || '',
          type: 'adult' as const,
          age: 0,
        }
      })
      return next
    })
  }, [selectedSeats, contactName])

  const totalPrice = useMemo(
    () => selectedSeats.reduce((sum, s) => sum + s.finalPrice, 0),
    [selectedSeats],
  )

  const canProceedSeats = selectedSeats.length > 0
  const canProceedPassenger =
    passengers.every((p) => p.name.trim().length >= 2) &&
    contactName.trim().length >= 2 &&
    contactPhone.trim().length >= 7

  const handleSubmit = useCallback(async () => {
    if (!selectedTrip || !trip) {
      toast.error('Thiếu thông tin chuyến đi')
      return
    }
    if (!boardingPointId || !droppingPointId) {
      toast.error('Vui lòng chọn điểm đón / trả')
      return
    }
    try {
      const result = await createBooking.mutateAsync({
        tripId: selectedTrip.tripId,
        seatIds: selectedSeats.map((s) => s.id),
        passengers: passengers.map((p) => ({
          name: p.name,
          type: p.type,
          age: p.age,
        })),
        boardingPointId,
        droppingPointId,
        contactName,
        contactPhone,
        contactEmail: contactEmail || undefined,
        userId: channel?.user?.phone ? undefined : undefined, // would need user.id; Channel doesn't expose it
        autoConfirm,
      })
      const item = (result as any)?.item ?? result
      const payload: CreatedTicketPayload = {
        bookingId: item?.id ?? '',
        bookingCode: item?.code ?? '',
        status: item?.status ?? (autoConfirm ? 'confirmed' : 'pending'),
        totalAmount: item?.total ?? totalPrice,
        currency: item?.currency ?? null,
        contactName,
        contactPhone,
        trip: {
          routeName: selectedTrip.routeName,
          fromName: selectedTrip.fromName,
          toName: selectedTrip.toName,
          departureDate: trip.trip.departureDate,
          departureAt: trip.trip.departureAt ?? null,
          brandName: selectedTrip.brandName,
          brandAccent: selectedTrip.brandAccent,
          brandLogo: selectedTrip.brandLogo ?? null,
        },
        seats: selectedSeats.map((s, i) => ({
          code: s.code,
          passengerName: passengers[i]?.name ?? '',
          price: s.finalPrice,
        })),
        createdAt: new Date().toISOString(),
      }
      onCreated(payload)
      toast.success('Đã đặt vé thành công', {
        description: `Mã vé: ${payload.bookingCode}`,
      })
      onOpenChange(false)
    } catch (e: any) {
      toast.error('Đặt vé thất bại', {
        description: e?.message ?? 'Vui lòng thử lại',
      })
    }
  }, [
    selectedTrip,
    trip,
    boardingPointId,
    droppingPointId,
    createBooking,
    selectedSeats,
    passengers,
    contactName,
    contactPhone,
    contactEmail,
    channel,
    autoConfirm,
    totalPrice,
    onCreated,
    onOpenChange,
  ])

  // ── Render ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-blue-600" />
            Đặt vé cho khách
          </DialogTitle>
          <DialogDescription>
            Tạo vé nhanh cho khách hàng trong cuộc trò chuyện này. Khách sẽ nhận được vé trong chat.
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <StepIndicator step={step} />

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="pb-4 min-h-75">
            {step === 'search' && (
              <SearchStep
                fromQuery={fromQuery}
                toQuery={toQuery}
                setFromQuery={setFromQuery}
                setToQuery={setToQuery}
                fromPlace={fromPlace}
                toPlace={toPlace}
                setFromPlace={setFromPlace}
                setToPlace={setToPlace}
                date={date}
                setDate={setDate}
                fromSearch={fromSearch}
                toSearch={toSearch}
                tripSearch={tripSearch}
                onSelectTrip={(t) => {
                  setSelectedTrip(t)
                  setStep('seats')
                }}
              />
            )}

            {step === 'seats' && trip && (
              <SeatsStep
                trip={trip}
                selectedTrip={selectedTrip!}
                selectedSeats={selectedSeats}
                onToggleSeat={toggleSeat}
                boardingPoints={boardingPoints}
                droppingPoints={droppingPoints}
                boardingPointId={boardingPointId}
                droppingPointId={droppingPointId}
                setBoardingPointId={setBoardingPointId}
                setDroppingPointId={setDroppingPointId}
                totalPrice={totalPrice}
              />
            )}

            {step === 'seats' && tripDetail.isLoading && (
              <div className="space-y-2">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            )}

            {step === 'passenger' && (
              <PassengerStep
                passengers={passengers}
                setPassengers={setPassengers}
                contactName={contactName}
                contactPhone={contactPhone}
                contactEmail={contactEmail}
                setContactName={setContactName}
                setContactPhone={setContactPhone}
                setContactEmail={setContactEmail}
                autoConfirm={autoConfirm}
                setAutoConfirm={setAutoConfirm}
              />
            )}

            {step === 'confirm' && selectedTrip && trip && (
              <ConfirmStep
                selectedTrip={selectedTrip}
                trip={trip}
                selectedSeats={selectedSeats}
                passengers={passengers}
                contactName={contactName}
                contactPhone={contactPhone}
                boardingPointId={boardingPointId}
                droppingPointId={droppingPointId}
                pickupPoints={pickupPoints}
                totalPrice={totalPrice}
                autoConfirm={autoConfirm}
              />
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="border-t pt-3 flex-row justify-between items-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {selectedSeats.length > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Armchair className="h-3 w-3" />
                {selectedSeats.length} ghế
              </Badge>
            )}
            {totalPrice > 0 && (
              <Badge variant="outline" className="gap-1 text-blue-700 border-blue-300">
                {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step !== 'search' && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (step === 'seats') setStep('search')
                  else if (step === 'passenger') setStep('seats')
                  else if (step === 'confirm') setStep('passenger')
                }}
              >
                <ChevronLeft className="h-4 w-4" />
                Quay lại
              </Button>
            )}
            {step === 'seats' && (
              <Button
                size="sm"
                disabled={!canProceedSeats}
                onClick={() => setStep('passenger')}
              >
                Tiếp tục
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 'passenger' && (
              <Button
                size="sm"
                disabled={!canProceedPassenger}
                onClick={() => setStep('confirm')}
              >
                Xác nhận
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 'confirm' && (
              <Button
                size="sm"
                onClick={handleSubmit}
                disabled={createBooking.isPending}
                className="gap-1.5"
              >
                {createBooking.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Đang đặt…
                  </>
                ) : (
                  <>
                    <TicketIcon className="h-4 w-4" />
                    Đặt vé ngay
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── StepIndicator ───────────────────────────────────────────

function StepIndicator({ step }: { step: Step }) {
  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'search', label: 'Tìm chuyến', icon: <Search className="h-3.5 w-3.5" /> },
    { key: 'seats', label: 'Chọn ghế', icon: <Armchair className="h-3.5 w-3.5" /> },
    { key: 'passenger', label: 'Hành khách', icon: <User className="h-3.5 w-3.5" /> },
    { key: 'confirm', label: 'Xác nhận', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ]
  const currentIdx = steps.findIndex((s) => s.key === step)
  return (
    <div className="flex items-center gap-1 px-1 pb-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${
              i === currentIdx
                ? 'bg-blue-600 text-white'
                : i < currentIdx
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-muted-foreground'
            }`}
          >
            {s.icon}
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  )
}

// ── SearchStep ──────────────────────────────────────────────

function SearchStep({
  fromQuery,
  toQuery,
  setFromQuery,
  setToQuery,
  fromPlace,
  toPlace,
  setFromPlace,
  setToPlace,
  date,
  setDate,
  fromSearch,
  toSearch,
  tripSearch,
  onSelectTrip,
}: {
  fromQuery: string
  toQuery: string
  setFromQuery: (v: string) => void
  setToQuery: (v: string) => void
  fromPlace: { id: string; name: string } | null
  toPlace: { id: string; name: string } | null
  setFromPlace: (p: { id: string; name: string } | null) => void
  setToPlace: (p: { id: string; name: string } | null) => void
  date: string
  setDate: (d: string) => void
  fromSearch: ReturnType<typeof usePlaceSearch>
  toSearch: ReturnType<typeof usePlaceSearch>
  tripSearch: ReturnType<typeof useTripSearch>
  onSelectTrip: (t: TripResult) => void
}) {
  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="relative">
          <Label className="text-[10px] text-muted-foreground uppercase">Điểm đi</Label>
          <Input
            value={fromPlace ? fromPlace.name : fromQuery}
            onChange={(e) => {
              setFromQuery(e.target.value)
              setFromPlace(null)
            }}
            placeholder="VD: Hà Nội"
            className="h-9"
          />
          {fromSearch.data?.items && fromSearch.data.items.length > 0 && !fromPlace && fromQuery && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {fromSearch.data.items.slice(0, 6).map((p) => (
                <button
                  key={p.id ?? p.name}
                  onClick={() => {
                    setFromPlace({ id: p.id ?? p.name, name: p.name })
                    setFromQuery('')
                  }}
                  className="block w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.province && (
                    <span className="text-muted-foreground ml-1">· {p.province}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <Label className="text-[10px] text-muted-foreground uppercase">Điểm đến</Label>
          <Input
            value={toPlace ? toPlace.name : toQuery}
            onChange={(e) => {
              setToQuery(e.target.value)
              setToPlace(null)
            }}
            placeholder="VD: Đà Nẵng"
            className="h-9"
          />
          {toSearch.data?.items && toSearch.data.items.length > 0 && !toPlace && toQuery && (
            <div className="absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-48 overflow-y-auto">
              {toSearch.data.items.slice(0, 6).map((p) => (
                <button
                  key={p.id ?? p.name}
                  onClick={() => {
                    setToPlace({ id: p.id ?? p.name, name: p.name })
                    setToQuery('')
                  }}
                  className="block w-full text-left px-2.5 py-1.5 text-xs hover:bg-blue-50"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.province && (
                    <span className="text-muted-foreground ml-1">· {p.province}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <Label className="text-[10px] text-muted-foreground uppercase">Ngày đi</Label>
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <Separator />

      {/* Results */}
      {tripSearch.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : tripSearch.data?.items && tripSearch.data.items.length > 0 ? (
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {tripSearch.data.items.map((t) => (
            <button
              key={t.tripId}
              onClick={() => onSelectTrip(t)}
              className="w-full text-left rounded-lg border p-2.5 hover:border-blue-400 hover:bg-blue-50/30 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: t.brandAccent }}
                    />
                    <span className="font-medium">{t.brandName}</span>
                    <span className="text-muted-foreground">· {t.vehicleTypeLabel}</span>
                  </div>
                  <div className="font-semibold text-sm mt-0.5">
                    {t.fromName} → {t.toName}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2 mt-0.5">
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {t.departureTime}
                    </span>
                    <span>· {Math.floor(t.durationMin / 60)}h{t.durationMin % 60}m</span>
                    <span>· {t.availableSeats} ghế trống</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-blue-700 text-sm">
                    {new Intl.NumberFormat('vi-VN').format(t.minPrice)}₫
                  </div>
                  <div className="text-[10px] text-muted-foreground">/ghế</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : fromPlace && toPlace ? (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Bus className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Không tìm thấy chuyến nào phù hợp.
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          Chọn điểm đi, điểm đến và ngày đi để tìm chuyến.
        </div>
      )}
    </div>
  )
}

// ── SeatsStep ───────────────────────────────────────────────

function SeatsStep({
  trip,
  selectedTrip,
  selectedSeats,
  onToggleSeat,
  boardingPoints,
  droppingPoints,
  boardingPointId,
  droppingPointId,
  setBoardingPointId,
  setDroppingPointId,
  totalPrice,
}: {
  trip: TripDetail
  selectedTrip: TripResult
  selectedSeats: Seat[]
  onToggleSeat: (s: Seat) => void
  boardingPoints: TripDetail['pickupPoints']
  droppingPoints: TripDetail['pickupPoints']
  boardingPointId: string
  droppingPointId: string
  setBoardingPointId: (id: string) => void
  setDroppingPointId: (id: string) => void
  totalPrice: number
}) {
  const selectedIds = new Set(selectedSeats.map((s) => s.id))
  const decks = trip.seatMap?.decks ?? []
  return (
    <div className="space-y-3">
      {/* Trip summary */}
      <div className="rounded-lg bg-linear-to-r from-blue-50 to-emerald-50 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">
              {selectedTrip.fromName} → {selectedTrip.toName}
            </div>
            <div className="text-muted-foreground">
              {selectedTrip.brandName} · {selectedTrip.departureTime} ·{' '}
              {selectedTrip.vehicleTypeLabel}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {selectedTrip.availableSeats} ghế trống
          </Badge>
        </div>
      </div>

      {/* Seat map */}
      <div className="rounded-lg border p-3 bg-slate-50/50">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Armchair className="h-3.5 w-3.5" />
          Sơ đồ ghế
        </div>
        <div className="space-y-3">
          {decks.map((deck) => (
            <div key={deck.deck}>
              {decks.length > 1 && (
                <div className="text-[10px] text-muted-foreground uppercase mb-1">
                  Tầng {deck.deck}
                </div>
              )}
              <div className="space-y-1">
                {deck.rows.map((row) => (
                  <div key={row.row} className="flex items-center gap-1.5 justify-center">
                    <span className="text-[9px] text-muted-foreground w-3">{row.row}</span>
                    {row.seats.map((seat) => {
                      const isAvailable = seat.status === 'available'
                      const isSelected = selectedIds.has(seat.id)
                      return (
                        <button
                          key={seat.id}
                          disabled={!isAvailable}
                          onClick={() =>
                            onToggleSeat({
                              id: seat.id,
                              code: seat.code,
                              row: seat.row,
                              col: seat.col,
                              deck: seat.deck,
                              seatClass: seat.seatClass ?? '',
                              priceMultiplier: 1,
                              status: seat.status,
                              finalPrice: seat.finalPrice,
                            })
                          }
                          className={`h-7 w-7 rounded text-[9px] font-mono font-bold transition-all ${
                            !isAvailable
                              ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                              : isSelected
                              ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                              : seat.seatClass === 'vip' || seat.seatClass === 'bed_lower'
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-white border text-slate-700 hover:border-blue-400 hover:bg-blue-50'
                          }`}
                          title={`${seat.code} · ${seat.seatClass} · ${new Intl.NumberFormat('vi-VN').format(seat.finalPrice)}₫`}
                        >
                          {seat.code}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-white border" /> Còn trống
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-100" /> VIP
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-blue-600" /> Đã chọn
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-slate-200" /> Đã có người đặt
          </span>
        </div>
      </div>

      {/* Boarding / dropping points */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Điểm đón
          </Label>
          <Select value={boardingPointId} onValueChange={setBoardingPointId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Chọn điểm đón" />
            </SelectTrigger>
            <SelectContent>
              {boardingPoints.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Điểm trả
          </Label>
          <Select value={droppingPointId} onValueChange={setDroppingPointId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Chọn điểm trả" />
            </SelectTrigger>
            <SelectContent>
              {droppingPoints.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedSeats.length > 0 && (
        <div className="rounded-lg bg-blue-50/50 border border-blue-200 p-2.5">
          <div className="text-xs font-semibold text-blue-700 mb-1">
            Đã chọn {selectedSeats.length} ghế
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedSeats.map((s) => (
              <Badge key={s.id} variant="outline" className="text-[10px] font-mono bg-white">
                {s.code} · {new Intl.NumberFormat('vi-VN').format(s.finalPrice)}₫
              </Badge>
            ))}
          </div>
          <div className="text-xs mt-1.5 font-semibold text-right text-blue-700">
            Tổng: {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
          </div>
        </div>
      )}
    </div>
  )
}

// ── PassengerStep ───────────────────────────────────────────

function PassengerStep({
  passengers,
  setPassengers,
  contactName,
  contactPhone,
  contactEmail,
  setContactName,
  setContactPhone,
  setContactEmail,
  autoConfirm,
  setAutoConfirm,
}: {
  passengers: Passenger[]
  setPassengers: (updater: (prev: Passenger[]) => Passenger[]) => void
  contactName: string
  contactPhone: string
  contactEmail: string
  setContactName: (v: string) => void
  setContactPhone: (v: string) => void
  setContactEmail: (v: string) => void
  autoConfirm: boolean
  setAutoConfirm: (v: boolean) => void
}) {
  return (
    <div className="space-y-3">
      {/* Contact info */}
      <div className="rounded-lg border p-3 bg-slate-50/50">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <User className="h-3.5 w-3.5" /> Thông tin liên hệ
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase">Họ tên người đặt</Label>
            <Input
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
              placeholder="VD: Nguyễn Văn An"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground uppercase">SĐT</Label>
            <Input
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              placeholder="09xx xxx xxx"
              className="h-9"
            />
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[10px] text-muted-foreground uppercase">Email (tuỳ chọn)</Label>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="email@example.com"
              className="h-9"
            />
          </div>
        </div>
      </div>

      {/* Passengers per seat */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Armchair className="h-3.5 w-3.5" /> Hành khách theo ghế
        </div>
        {passengers.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            Chưa chọn ghế nào ở bước trước.
          </div>
        ) : (
          <div className="space-y-2">
            {passengers.map((p, i) => (
              <div key={p.seatId} className="flex items-center gap-2 rounded-md bg-slate-50 p-2">
                <Badge variant="outline" className="font-mono text-[10px] bg-white">
                  {p.seatCode}
                </Badge>
                <Input
                  value={p.name}
                  onChange={(e) =>
                    setPassengers((prev) =>
                      prev.map((x) =>
                        x.seatId === p.seatId ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="Tên hành khách"
                  className="h-8 flex-1 text-xs"
                />
                <Select
                  value={p.type}
                  onValueChange={(v) =>
                    setPassengers((prev) =>
                      prev.map((x) =>
                        x.seatId === p.seatId
                          ? { ...x, type: v as 'adult' | 'child' | 'infant' }
                          : x,
                      ),
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-25 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adult">Người lớn</SelectItem>
                    <SelectItem value="child">Trẻ em</SelectItem>
                    <SelectItem value="infant">Em bé</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-confirm */}
      <label className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 bg-emerald-50/30">
        <input
          type="checkbox"
          checked={autoConfirm}
          onChange={(e) => setAutoConfirm(e.target.checked)}
          className="h-4 w-4 rounded"
        />
        <div className="flex-1">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-emerald-600" />
            Tự động xác nhận (đã thanh toán)
          </div>
          <div className="text-[11px] text-muted-foreground">
            Đánh dấu vé là "Đã xác nhận" ngay sau khi tạo. Bỏ tick nếu chỉ giữ chỗ (chờ thanh toán).
          </div>
        </div>
      </label>
    </div>
  )
}

// ── ConfirmStep ─────────────────────────────────────────────

function ConfirmStep({
  selectedTrip,
  trip,
  selectedSeats,
  passengers,
  contactName,
  contactPhone,
  boardingPointId,
  droppingPointId,
  pickupPoints,
  totalPrice,
  autoConfirm,
}: {
  selectedTrip: TripResult
  trip: TripDetail
  selectedSeats: Seat[]
  passengers: Passenger[]
  contactName: string
  contactPhone: string
  boardingPointId: string
  droppingPointId: string
  pickupPoints: TripDetail['pickupPoints']
  totalPrice: number
  autoConfirm: boolean
}) {
  const boarding = pickupPoints.find((p) => p.id === boardingPointId)
  const dropping = pickupPoints.find((p) => p.id === droppingPointId)
  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 border-blue-200 bg-linear-to-br from-blue-50/50 to-emerald-50/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Xác nhận đặt vé
          </div>
          <Badge variant="outline" className="text-[10px] bg-white">
            {autoConfirm ? 'Sẽ tự động xác nhận' : 'Sẽ giữ chỗ 10 phút'}
          </Badge>
        </div>
        <div className="space-y-1.5 text-xs">
          <Row label="Hãng xe">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: selectedTrip.brandAccent }}
              />
              {selectedTrip.brandName}
            </span>
          </Row>
          <Row label="Tuyến">
            {selectedTrip.fromName} → {selectedTrip.toName}
          </Row>
          <Row label="Khởi hành">
            {trip.trip.departureTime} · {trip.trip.departureDate}
          </Row>
          <Row label="Số ghế">
            <div className="flex flex-wrap gap-1 justify-end">
              {selectedSeats.map((s) => (
                <Badge key={s.id} variant="outline" className="font-mono text-[10px] bg-white">
                  {s.code}
                </Badge>
              ))}
            </div>
          </Row>
          <Row label="Điểm đón">{boarding?.name ?? '—'}</Row>
          <Row label="Điểm trả">{dropping?.name ?? '—'}</Row>
          <Row label="Người đặt">
            {contactName} <span className="text-muted-foreground">· {contactPhone}</span>
          </Row>
        </div>
        <Separator className="my-2" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">Tổng tiền</span>
          <span className="text-lg font-bold text-blue-700">
            {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
          </span>
        </div>
      </div>

      {/* Passenger list */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-2">Danh sách hành khách</div>
        <div className="space-y-1">
          {passengers.map((p) => (
            <div key={p.seatId} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono text-[10px]">
                  {p.seatCode}
                </Badge>
                {p.name}
              </span>
              <span className="text-muted-foreground">
                {p.type === 'adult' ? 'Người lớn' : p.type === 'child' ? 'Trẻ em' : 'Em bé'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{children}</span>
    </div>
  )
}
