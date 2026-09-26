'use client'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useT } from '@/lib/i18n'
import type { TripResult, TripDetail } from '@/lib/api/types.gen'
import type { Seat, Passenger } from './chat-ticket-picker-types'

// ── ConfirmStep ─────────────────────────────────────────────

export function ConfirmStep({
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
  const t = useT()
  const boarding = pickupPoints.find((p) => p.id === boardingPointId)
  const dropping = pickupPoints.find((p) => p.id === droppingPointId)
  return (
    <div className="space-y-3">
      <div className="rounded-lg border-2 border-blue-200 bg-linear-to-br from-blue-50/50 to-emerald-50/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            {t('booking.confirm')}
          </div>
          <Badge variant="outline" className="text-[10px] bg-white">
            {autoConfirm ? t('adminTickets.willAutoConfirm') : t('adminTickets.willHoldSeat')}
          </Badge>
        </div>
        <div className="space-y-1.5 text-xs">
          <Row label={t('admin.brands')}>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: selectedTrip.brandAccent }}
              />
              {selectedTrip.brandName}
            </span>
          </Row>
          <Row label={t('adminTickets.route')}>
            {selectedTrip.fromName} → {selectedTrip.toName}
          </Row>
          <Row label={t('booking.departure')}>
            {trip.trip.departureTime} · {trip.trip.departureDate}
          </Row>
          <Row label={t('adminTickets.seatNumbers')}>
            <div className="flex flex-wrap gap-1 justify-end">
              {selectedSeats.map((s) => (
                <Badge key={s.id} variant="outline" className="font-mono text-[10px] bg-white">
                  {s.code}
                </Badge>
              ))}
            </div>
          </Row>
          <Row label={t('adminTickets.pickupPoint')}>{boarding?.name ?? '—'}</Row>
          <Row label={t('adminTickets.dropoffPoint')}>{dropping?.name ?? '—'}</Row>
          <Row label={t('adminTickets.bookedBy')}>
            {contactName} <span className="text-muted-foreground">· {contactPhone}</span>
          </Row>
        </div>
        <Separator className="my-2" />
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold">{t('booking.totalAmount')}</span>
          <span className="text-lg font-bold text-blue-700">
            {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
          </span>
        </div>
      </div>

      {/* Passenger list */}
      <div className="rounded-lg border p-3">
        <div className="text-xs font-semibold mb-2">{t('adminTickets.passengerList')}</div>
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
                {p.type === 'adult' ? t('booking.passengerType.adult') : p.type === 'child' ? t('booking.passengerType.child') : t('booking.passengerType.infant')}
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
