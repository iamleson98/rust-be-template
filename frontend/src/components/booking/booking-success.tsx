'use client'

/**
 * BookingSuccess — the success step (step 4) of the BookingDialog.
 *
 * Extracted from the original `booking-dialog.tsx`. Renders:
 *   - The "Đặt vé thành công!" hero with the booking code + copy button
 *   - A QR-code placeholder
 *   - The booking summary (route, departure, seats, brand, insurance)
 *   - Two CTAs: "Đặt vé khác" (closes the dialog) + "Xem vé của tôi"
 *     (navigates to the booking detail page)
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  Copy,
  PartyPopper,
  QrCode,
  ShieldCheck,
  Ticket,
} from 'lucide-react'
import { formatDateTimeVN } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useNavigate } from '@/router'
import type { TripDetail, SelectedSeat } from './booking-form'
import { INSURANCE_LABEL_MAP, type InsuranceLevel } from './price-summary'

export type LastBooking = {
  code: string
  total: number
}

export function BookingSuccess({
  trip,
  lastBooking,
  selectedSeats,
  currency,
  insuranceLevel,
  insuranceCost,
  onClose,
}: {
  trip: TripDetail | null | undefined
  lastBooking: LastBooking
  selectedSeats: SelectedSeat[]
  currency: Currency
  insuranceLevel: InsuranceLevel
  insuranceCost: number
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="p-5">
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-4">
          <PartyPopper className="h-8 w-8 text-blue-600" />
        </div>
        <h3 className="text-xl font-extrabold text-blue-700">Đặt vé thành công!</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Vé điện tử đã được gửi đến số điện thoại &amp; email của bạn
        </p>

        <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2">
          <span className="text-xs text-muted-foreground">Mã vé</span>
          <code className="font-mono font-bold text-lg text-blue-700">{lastBooking.code}</code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(lastBooking.code)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="ml-1 p-1 rounded hover:bg-white"
            aria-label="Sao chép mã vé"
          >
            {copied ? <CheckCircle2 className="h-4 w-4 text-blue-600" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* QR placeholder */}
      <div className="flex justify-center my-4">
        <div className="rounded-xl border-2 border-dashed border-slate-300 p-4 bg-white">
          <div className="h-32 w-32 bg-linear-to-br from-slate-900 to-slate-700 rounded-lg flex items-center justify-center relative overflow-hidden">
            <QrCode className="h-20 w-20 text-white" />
            <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 gap-px opacity-30">
              {Array.from({ length: 64 }).map((_, i) => (
                <div key={i} className={Math.random() > 0.5 ? 'bg-white' : ''} />
              ))}
            </div>
          </div>
          <div className="text-center text-xs text-muted-foreground mt-2">Quét mã để lên xe</div>
        </div>
      </div>

      {/* Booking summary */}
      {trip && (
        <div className="rounded-lg border bg-white p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tuyến</span>
            <span className="font-medium">
              {trip.from.name} → {trip.to.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Khởi hành</span>
            <span className="font-medium">{formatDateTimeVN(trip.trip.departureAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ghế</span>
            <span className="font-medium font-mono">
              {selectedSeats.map((s) => s.code).join(', ')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Hãng xe</span>
            <span className="font-medium">{trip.brand.name}</span>
          </div>
          {insuranceLevel !== 'none' && (
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                Bảo hiểm
              </span>
              <span className="font-medium text-blue-700">
                {INSURANCE_LABEL_MAP[insuranceLevel]} ({formatCurrency(insuranceCost, currency)})
              </span>
            </div>
          )}
          <div className="flex justify-between border-t pt-2 font-bold text-base">
            <span>Tổng thanh toán</span>
            <span className="text-blue-700">{formatCurrency(lastBooking.total, currency)}</span>
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <Button variant="outline" className="flex-1 gap-1" onClick={onClose}>
          Đặt vé khác
        </Button>
        <Button
          variant="outline"
          className="flex-1 gap-1"
          onClick={() => {
            const code = lastBooking?.code
            onClose()
            // Deep-link to the booking detail page so the user can
            // see their new booking's QR code + pickup info.
            if (code) {
              navigate({ to: '/bookings/$code', params: { code } })
            } else {
              navigate({ to: '/bookings' })
            }
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          <Ticket className="h-4 w-4" />
          Xem vé của tôi
        </Button>
      </div>
    </div>
  )
}
