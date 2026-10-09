'use client'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { ComboboxField } from '@/components/ui/combobox'
import { Armchair, MapPin } from 'lucide-react'
import { SeatMap } from '@/features/seat-plan'
import { useT } from '@/lib/i18n'
import type { TripResult, TripDetail } from '@/api'
import type { Seat } from './chat-ticket-picker-types'

// ── SeatsStep ───────────────────────────────────────────────

export function SeatsStep({
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
  const t = useT()
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
            {t('adminTickets.seatsAvailable', { count: selectedTrip.availableSeats })}
          </Badge>
        </div>
      </div>

      {/* Seat map */}
      <div className="rounded-lg border p-3 bg-slate-50/50">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Armchair className="h-3.5 w-3.5" />
          {t('booking.seatSelector')}
        </div>
        <SeatMap
          compact
          decks={trip.seatMap?.decks ?? []}
          selectedSeatIds={selectedSeats.map((s) => s.id)}
          onToggleSeat={(seat) =>
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
        />
      </div>

      {/* Boarding / dropping points */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {t('adminTickets.pickupPoint')}
          </Label>
          <ComboboxField
            value={boardingPointId}
            onValueChange={setBoardingPointId}
            items={boardingPoints.map((p) => ({ value: p.id, label: p.name ?? '—' }))}
            className="h-9"
            placeholder={t('adminTickets.choosePickupPoint')}
            searchPlaceholder={t('adminTickets.searchPickupPoint')}
            aria-label={t('adminTickets.pickupPoint')}
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> {t('adminTickets.dropoffPoint')}
          </Label>
          <ComboboxField
            value={droppingPointId}
            onValueChange={setDroppingPointId}
            items={droppingPoints.map((p) => ({ value: p.id, label: p.name ?? '—' }))}
            className="h-9"
            placeholder={t('adminTickets.chooseDropoffPoint')}
            searchPlaceholder={t('adminTickets.searchDropoffPoint')}
            aria-label={t('adminTickets.dropoffPoint')}
          />
        </div>
      </div>

      {selectedSeats.length > 0 && (
        <div className="rounded-lg bg-blue-50/50 border border-blue-200 p-2.5">
          <div className="text-xs font-semibold text-blue-700 mb-1">
            {t('adminTickets.selectedSeatsCount', { count: selectedSeats.length })}
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedSeats.map((s) => (
              <Badge key={s.id} variant="outline" className="text-[10px] font-mono bg-white">
                {s.code} · {new Intl.NumberFormat('vi-VN').format(s.finalPrice)}₫
              </Badge>
            ))}
          </div>
          <div className="text-xs mt-1.5 font-semibold text-right text-blue-700">
            {t('adminTickets.totalLabel')} {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
          </div>
        </div>
      )}
    </div>
  )
}
