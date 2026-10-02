'use client'

/**
 * BookingSuccess — the success step (step 4) of the BookingDialog.
 *
 * Extracted from the original `booking-dialog.tsx`. Renders:
 *   - The "Đặt vé thành công!" hero with the booking code + copy button
 *   - A boarding-pass ticket stub (the REAL scannable QR lives on the
 *     booking-detail page — a random-noise "QR" here was misleading)
 *   - The booking summary (route, departure, seats, brand)
 *   - Two CTAs: "Đặt vé khác" (closes the dialog) + "Xem vé của tôi"
 *     (navigates to the booking detail page)
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Copy, Ticket } from 'lucide-react'
import { formatDateTimeVN } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import type { TripDetail, SelectedSeat } from './booking-form'

export type LastBooking = {
  code: string
  total: number
}

export function BookingSuccess({
  trip,
  lastBooking,
  selectedSeats,
  currency,
  onClose,
}: {
  trip: TripDetail | null | undefined
  lastBooking: LastBooking
  selectedSeats: SelectedSeat[]
  currency: Currency
  onClose: () => void
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const navigate = useNavigate()

  return (
    <div className="p-5">
      <div className="text-center py-6">
        {/* Animated success checkmark — SVG draw-on animation */}
        <div className="inline-flex items-center justify-center mb-4">
          <svg
            className="h-20 w-20"
            viewBox="0 0 52 52"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="26"
              cy="26"
              r="24"
              stroke="oklch(0.62 0.17 145)"
              strokeWidth="2"
              fill="oklch(0.62 0.17 145 / 0.1)"
              style={{
                strokeDasharray: 200,
                strokeDashoffset: 200,
                animation: 'checkmark-circle 400ms ease-out forwards',
              }}
            />
            <path
              d="M14 27 L22 35 L38 19"
              stroke="oklch(0.62 0.17 145)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
              style={{
                strokeDasharray: 100,
                strokeDashoffset: 100,
                animation: 'checkmark-draw 300ms ease-out 200ms forwards',
              }}
            />
          </svg>
        </div>
        <h3 className="text-xl font-extrabold text-primary">{t('booking.success')}</h3>
        <p className="text-sm text-muted-foreground mt-1">{t('bookingFlow.successDesc')}</p>

        <div className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2">
          <span className="text-xs text-muted-foreground">{t('booking.code')}</span>
          <code className="font-mono font-bold text-lg text-primary">{lastBooking.code}</code>
          <button
            onClick={() => {
              // Clipboard API is undefined on non-secure contexts
              // (http:// LAN deploys) — guard instead of crashing.
              try {
                navigator.clipboard?.writeText(lastBooking.code)
              } catch {
                /* non-fatal — the code is visible right above */
              }
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="ml-1 grid size-8 place-items-center rounded hover:bg-white"
            aria-label={t('bookingFlow.copyTicketCode')}
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Boarding-pass stub — a tactile "you're booked" artifact. The
          real scannable QR is one tap away (booking-detail page, via the
          CTA below), so we deliberately do NOT fake one here. */}
      <div className="flex justify-center my-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-linear-to-br from-slate-50 to-white relative overflow-hidden">
          {/* Ticket perforation — dashed cut line with side notches */}
          <div
            className="absolute left-[68%] top-0 bottom-0 border-l-2 border-dashed border-slate-200"
            aria-hidden
          />
          <div
            className="absolute -left-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white ring-1 ring-slate-200"
            aria-hidden
          />
          <div
            className="absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white ring-1 ring-slate-200 hidden sm:block"
            aria-hidden
          />
          <div className="flex items-stretch">
            {/* Left: e-ticket identity */}
            <div className="flex-1 p-4 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-2">
                <Ticket className="h-5 w-5" />
              </div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('bookingFlow.ticketStubTitle')}
              </div>
              <div className="font-mono font-extrabold text-lg text-primary mt-0.5">
                {lastBooking.code}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <Copy className="h-3 w-3" />
                {t('bookingFlow.copyTicketCode')}
              </div>
            </div>
            {/* Right: seats + total at a glance */}
            <div className="w-[32%] p-3.5 flex flex-col items-center justify-center text-center border-l-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {t('bookingFlow.seatsLabel')}
              </div>
              <div className="font-mono font-bold text-sm mt-0.5">
                {selectedSeats.map((s) => s.code).join(', ')}
              </div>
              <div className="mt-2 pt-2 border-t border-dashed border-slate-200 w-full">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t('bookingFlow.totalDue')}
                </div>
                <div className="font-bold text-sm text-primary">
                  {formatCurrency(lastBooking.total, currency)}
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-slate-100 bg-white/60 text-center text-[10px] text-muted-foreground py-1.5 px-3">
            {t('bookingFlow.ticketStubQrNote')}
          </div>
        </div>
      </div>

      {/* Booking summary */}
      {trip && (
        <div className="rounded-lg border bg-white p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bookingFlow.routeLabel')}</span>
            <span className="font-medium">
              {trip.from.name} → {trip.to.name}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('booking.departure')}</span>
            <span className="font-medium">{formatDateTimeVN(trip.trip.departureAt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bookingFlow.seatsLabel')}</span>
            <span className="font-medium font-mono">
              {selectedSeats.map((s) => s.code).join(', ')}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bookingFlow.brandLabel')}</span>
            <span className="font-medium">{trip.brand.name}</span>
          </div>
          <div className="flex justify-between border-t pt-2 font-bold text-base">
            <span>{t('bookingFlow.totalDue')}</span>
            <span className="text-primary">{formatCurrency(lastBooking.total, currency)}</span>
          </div>
        </div>
      )}

      <div className="flex gap-2 mt-5">
        <Button variant="outline" className="flex-1 gap-1" onClick={onClose}>
          {t('bookingFlow.bookAnother')}
        </Button>
        <Button
          className="flex-1 gap-1 bg-primary hover:bg-primary/90"
          onClick={() => {
            const code = lastBooking?.code
            onClose()
            // Deep-link to the booking detail page so the user can
            // see their new booking's QR code + pickup info.
            if (code) {
              navigate({ to: '/bookings/$code', params: { code } })
            } else {
              navigate({ to: '/account/trips' })
            }
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          <Ticket className="h-4 w-4" />
          {t('bookingFlow.viewMyTickets')}
        </Button>
      </div>
    </div>
  )
}
