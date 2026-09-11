'use client'

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
