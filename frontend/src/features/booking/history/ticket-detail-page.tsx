import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Ban,
  Bus,
  CalendarClock,
  CreditCard,
  PhoneCall,
  QrCode,
  Users,
} from 'lucide-react'
import { bookingsDetailOptions, type PaymentOut } from '@/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useBookingPayments } from '@/features/booking/api'
import { PaymentDialog } from '@/features/booking/flow/payment-dialog'
import { trackConversion } from '@/lib/analytics'
import { formatDateVN, formatTimeVN, useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { useUi } from '@/stores/ui'
import { PAYMENT_LABELS, ticketStage } from './booking-types'
import { TicketPassengers, TicketStops } from './ticket-parts'
import { TicketQrDialog } from './ticket-qr-dialog'
import { TicketStatusBadge } from './ticket-status-badge'

/** One ticket in the customer's console: trip, stops, passengers, payment, QR and actions. */
export function TicketDetailPage() {
  const t = useT()
  const money = useMoney()
  const { code } = useParams({ from: '/account/trips/$code' })
  const openCancel = useUi((s) => s.openCancel)
  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery(bookingsDetailOptions({ path: { id: code } }))
  const [qrOpen, setQrOpen] = useState(false)
  const [paying, setPaying] = useState(false)
  const stage = ticket ? ticketStage(ticket) : null
  const payments = useBookingPayments(ticket?.id, stage === 'paying')

  const back = (
    <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
      <Link to="/account/trips">
        <ArrowLeft className="mr-1 h-4 w-4" /> {t('layout.account.tripHistory')}
      </Link>
    </Button>
  )

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-6">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }
  if (isError || !ticket) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
        {back}
        <div className="flex flex-col items-center py-16 text-center">
          <AlertCircle className="mb-3 h-12 w-12 text-rose-400" />
          <h2 className="text-lg font-semibold">{t('bookingDetail.notFoundTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bookingDetail.invalidCode', { code })}
          </p>
        </div>
      </div>
    )
  }

  const trip = ticket.trip
  const onPaid = (payment: PaymentOut) => {
    setPaying(false)
    trackConversion('purchase', {
      value: payment.amount,
      currency: payment.currency,
      transactionId: ticket.code,
    })
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-6">
      <div>
        {back}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-2xl font-extrabold tracking-tight text-blue-700">
              {ticket.code}
            </h1>
            <TicketStatusBadge booking={ticket} />
          </div>
          {ticket.ticketQr && (
            <Button variant="outline" className="gap-1.5" onClick={() => setQrOpen(true)}>
              <QrCode className="h-4 w-4" />
              {t('bookingHistory.qrCode')}
            </Button>
          )}
        </div>
      </div>

      {stage === 'awaiting' && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <PhoneCall className="mt-0.5 h-4 w-4 shrink-0" />
          {t('bookingHistory.awaitingNotice', { phone: ticket.contactPhone ?? '' })}
        </p>
      )}

      {trip && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bus className="h-4 w-4" />
              <span className="font-medium text-foreground">{trip.brandName ?? '—'}</span>
              {trip.busLayoutName && <span>· {trip.busLayoutName}</span>}
            </div>
            <div className="flex items-center gap-2 text-lg font-bold">
              {trip.fromName ?? '—'}
              <ArrowRight className="h-4 w-4 text-blue-600" />
              {trip.toName ?? '—'}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <CalendarClock className="h-4 w-4 text-blue-600" />
              <span className="font-semibold">
                {formatDateVN(trip.departureAt ?? trip.departureDate, {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </span>
              <span className="font-mono font-semibold">
                {trip.departureAt ? formatTimeVN(trip.departureAt) : trip.departureTime}
              </span>
            </div>
            <TicketStops pickup={ticket.pickup} dropoff={ticket.dropoff} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4 text-blue-600" />
            {t('bookingHistory.passengersAndSeats', { count: ticket.seats.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TicketPassengers seats={ticket.seats} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-5 text-sm">
          {ticket.paymentMethod && (
            <Row
              label={t('payment.method')}
              value={t(PAYMENT_LABELS[ticket.paymentMethod] ?? ticket.paymentMethod)}
            />
          )}
          <Row
            label={t('bookingHistory.subtotalSeats', { count: ticket.seats.length })}
            value={money(ticket.subtotal)}
          />
          {ticket.discount > 0 && (
            <Row label={t('bookingHistory.discount')} value={`- ${money(ticket.discount)}`} />
          )}
          <div className="flex items-center justify-between border-t pt-2">
            <span className="font-bold">{t('bookingHistory.grandTotal')}</span>
            <span className="text-xl font-extrabold text-blue-700">{money(ticket.total)}</span>
          </div>
        </CardContent>
      </Card>

      {(ticket.canCancel || stage === 'paying') && (
        <div className="flex flex-wrap justify-end gap-2">
          {ticket.canCancel && (
            <Button
              variant="outline"
              className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              onClick={() => openCancel(ticket.id)}
            >
              <Ban className="h-4 w-4" />
              {t('cancel.title')}
            </Button>
          )}
          {stage === 'paying' && (
            <Button className="gap-1.5" onClick={() => setPaying(true)}>
              <CreditCard className="h-4 w-4" />
              {t('booking.payment')}
            </Button>
          )}
        </div>
      )}

      <TicketQrDialog code={qrOpen ? ticket.code : null} onOpenChange={setQrOpen} />
      <PaymentDialog
        paymentId={payments.data?.items?.[0]?.id}
        bookingId={ticket.id}
        bookingTotal={ticket.total}
        open={paying}
        onClose={() => setPaying(false)}
        onPaid={onPaid}
      />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
