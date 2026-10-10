'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { CheckCircle2, Copy, Ticket } from 'lucide-react'
import type { TripDetail } from '@/api'
import { formatDateTimeVN, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import type { SelectedSeat } from './booking-form'

export type LastBooking = {
  code: string
  total: number
  /** Pay on board: the operator still has to phone to confirm. */
  awaitingCall: boolean
}

/**
 * The end of the checkout: one ticket card with the booking code (copyable)
 * and the trip. The scannable QR lives on the booking page the main button opens.
 */
export function BookingSuccess({
  trip,
  booking: lastBooking,
  seats: selectedSeats,
  onClose,
}: {
  trip: TripDetail | undefined
  booking: LastBooking
  seats: SelectedSeat[]
  onClose: () => void
}) {
  const t = useT()
  const money = useMoney()
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
        <h3 className="text-xl font-bold text-slate-900">
          {lastBooking.awaitingCall ? t('bookingFlow.placedTitle') : t('booking.success')}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {lastBooking.awaitingCall ? t('bookingFlow.placedDesc') : t('bookingFlow.successDesc')}
        </p>
      </div>

      {/* One ticket: the code to quote (copyable), then the trip. The scannable
          QR is on the booking page the main button opens, so none is faked here. */}
      <div className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80">
        <div className="flex items-center justify-between gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <div className="min-w-0">
            <div className="text-xs opacity-80">{t('booking.code')}</div>
            <code className="font-mono text-xl font-bold tracking-wider">{lastBooking.code}</code>
          </div>
          <button
            onClick={() => {
              // Clipboard API is undefined on non-secure contexts (http:// LAN deploys).
              try {
                void navigator.clipboard?.writeText(lastBooking.code)
              } catch {
                /* non-fatal — the code is on screen */
              }
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/25"
          >
            {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
            {t('bookingFlow.copyTicketCode')}
          </button>
        </div>
        <div className="relative border-t border-dashed border-slate-200" aria-hidden>
          <span className="absolute -top-2 -left-2 size-4 rounded-full bg-white ring-1 ring-slate-200" />
          <span className="absolute -top-2 -right-2 size-4 rounded-full bg-white ring-1 ring-slate-200" />
        </div>
        <dl className="space-y-2.5 px-5 py-4 text-sm">
          {trip && (
            <>
              <Row label={t('bookingFlow.routeLabel')}>
                {trip.from.name} → {trip.to.name}
              </Row>
              <Row label={t('booking.departure')}>{formatDateTimeVN(trip.trip.departureAt)}</Row>
              <Row label={t('bookingFlow.brandLabel')}>{trip.brand.name}</Row>
            </>
          )}
          <Row label={t('bookingFlow.seatsLabel')}>
            <span className="font-mono">{selectedSeats.map((s) => s.code).join(', ')}</span>
          </Row>
          <div className="flex items-baseline justify-between gap-4 border-t border-slate-100 pt-3">
            <dt className="font-semibold text-slate-900">{t('bookingFlow.totalDue')}</dt>
            <dd className="text-lg font-extrabold text-slate-900 tabular-nums">
              {money(lastBooking.total)}
            </dd>
          </div>
        </dl>
        <p className="border-t border-slate-100 bg-slate-50 px-5 py-2.5 text-center text-xs text-slate-500">
          {t('bookingFlow.ticketStubQrNote')}
        </p>
      </div>

      <div className="mx-auto mt-5 flex max-w-md gap-2">
        <Button variant="outline" className="h-11 flex-1 gap-1 rounded-xl" onClick={onClose}>
          {t('bookingFlow.bookAnother')}
        </Button>
        <Button
          className="h-11 flex-1 gap-1 rounded-xl"
          onClick={() => {
            const code = lastBooking?.code
            onClose()
            if (code) {
              navigate({ to: '/account/trips/$code', params: { code } })
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{children}</dd>
    </div>
  )
}
