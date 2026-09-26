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
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SeatMapSkeleton } from '@/features/trips/seat-map-skeleton'
import { toast } from 'sonner'
import {
  Search,
  User,
  Armchair,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Ticket as TicketIcon,
} from 'lucide-react'
import { format } from 'date-fns'
import {
  usePlaceSearch,
  useTripSearch,
  useTripDetail,
  useAdminCreateBooking,
} from '@/lib/queries'
import type { TripResult } from '@/lib/api/types.gen'
import type { AdminChannel as Channel } from '@/features/admin/dashboard/types'
import type { Seat, Passenger, Step } from './chat-ticket-picker-types'
import { SearchStep } from './ticket-picker-search-step'
import { SeatsStep } from './ticket-picker-seats-step'
import { PassengerStep } from './ticket-picker-passenger-step'
import { ConfirmStep } from './ticket-picker-confirm-step'
import { getErrorMessage } from '@/lib/error-message'
import { useT } from '@/lib/i18n'

/**
 * Structural type of the booking object returned by the create-booking
 * mutation (union-typed in the generated SDK; the picker only reads
 * these fields).
 */

/** Stable empty default — keeps useMemo deps referentially stable when data is not loaded yet. */
const EMPTY_POINTS: never[] = []
type CreatedTicketItem = {
  id?: string
  code?: string
  status?: string
  total?: number
  currency?: string | null
}

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
  const t = useT()

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
      const timer = setTimeout(() => {
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
      return () => clearTimeout(timer)
    }
    // Pre-fill contact info from the channel's user.
    if (channel?.user) {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const pickupPoints = trip?.pickupPoints ?? EMPTY_POINTS
  const boardingPoints = useMemo(
    () => pickupPoints, // all points can be boarding
    [pickupPoints],
  )
  const droppingPoints = pickupPoints // symmetric

  // Auto-select first boarding/dropping when trip loads.
  useEffect(() => {
    if (trip && !boardingPointId && boardingPoints[0]) {
      // Intentional effect-synced state (dialog reset-on-open /
      // server-data snapshot / DOM-availability gate).
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
        toast.warning(t('adminTickets.maxSeatsPerBooking'))
        return prev
      }
      return [...prev, seat]
    })
  }, [t])

  // When selectedSeats changes, sync passengers array.
  useEffect(() => {
    // Intentional effect-synced state (dialog reset-on-open /
    // server-data snapshot / DOM-availability gate).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      toast.error(t('adminTickets.missingTripInfo'))
      return
    }
    if (!boardingPointId || !droppingPointId) {
      toast.error(t('adminTickets.chooseBoardingDropoff'))
      return
    }
    try {
      const result = await createBooking.mutateAsync({
        body: {
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
          campaignCode: undefined,
        },
      } as unknown as Parameters<typeof createBooking.mutate>[0])
      const item = (((result ?? {}) as { item?: CreatedTicketItem }).item ?? result) as
        | CreatedTicketItem
        | undefined
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
      toast.success(t('adminTickets.bookingCreated'), {
        description: t('adminTickets.bookingCodeDesc', { code: payload.bookingCode }),
      })
      onOpenChange(false)
    } catch (e) {
      toast.error(t('adminTickets.bookingCreateFailed'), {
        description: getErrorMessage(e, t('adminTickets.pleaseRetry')),
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
    autoConfirm,
    totalPrice,
    onCreated,
    onOpenChange,
    t,
  ])

  // ── Render ──
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TicketIcon className="h-5 w-5 text-blue-600" />
            {t('chat.bookForCustomer')}
          </DialogTitle>
          <DialogDescription>
            {t('adminTickets.pickerDescription')}
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
                onSelectTrip={(tr) => {
                  setSelectedTrip(tr)
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
              <SeatMapSkeleton />
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
                {t('adminTickets.seatsCount', { count: selectedSeats.length })}
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
                {t('common.back')}
              </Button>
            )}
            {step === 'seats' && (
              <Button
                size="sm"
                disabled={!canProceedSeats}
                onClick={() => setStep('passenger')}
              >
                {t('adminTickets.continue')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
            {step === 'passenger' && (
              <Button
                size="sm"
                disabled={!canProceedPassenger}
                onClick={() => setStep('confirm')}
              >
                {t('common.confirm')}
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
                    {t('adminTickets.bookingInProgress')}
                  </>
                ) : (
                  <>
                    <TicketIcon className="h-4 w-4" />
                    {t('adminTickets.bookNow')}
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
  const t = useT()
  const steps: { key: Step; label: string; icon: React.ReactNode }[] = [
    { key: 'search', label: t('nav.searchTrips'), icon: <Search className="h-3.5 w-3.5" /> },
    { key: 'seats', label: t('adminTickets.chooseSeats'), icon: <Armchair className="h-3.5 w-3.5" /> },
    { key: 'passenger', label: t('booking.passengers'), icon: <User className="h-3.5 w-3.5" /> },
    { key: 'confirm', label: t('common.confirm'), icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  ]
  const currentIdx = steps.findIndex((s) => s.key === step)
  return (
    <div className="flex items-center gap-1 px-1 pb-2">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <div
            className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${i === currentIdx
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
