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
import { ConsolePage, PageHeader } from '@/components/console/page'
import { Panel } from '@/components/console/panel'
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
    <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 text-muted-foreground">
      <Link to="/account/trips">
        <ArrowLeft className="size-4" /> {t('layout.account.tripHistory')}
      </Link>
    </Button>
  )

  if (isLoading) {
    return (
      <ConsolePage width="narrow">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </ConsolePage>
    )
  }
  if (isError || !ticket) {
    return (
      <ConsolePage width="narrow">
        {back}
        <div className="flex flex-col items-center py-16 text-center">
          <AlertCircle className="mb-3 size-10 text-muted-foreground" />
          <h2 className="text-lg font-semibold">{t('bookingDetail.notFoundTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('bookingDetail.invalidCode', { code })}
          </p>
        </div>
      </ConsolePage>
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
    <ConsolePage width="narrow">
      <PageHeader
        before={back}
        title={
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="font-mono">{ticket.code}</span>
            <TicketStatusBadge booking={ticket} />
          </span>
        }
        actions={
          ticket.ticketQr && (
            <Button variant="outline" className="gap-1.5" onClick={() => setQrOpen(true)}>
              <QrCode className="size-4" />
              {t('bookingHistory.qrCode')}
            </Button>
          )
        }
      />

      {stage === 'awaiting' && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <PhoneCall className="mt-0.5 size-4 shrink-0" />
          {t('bookingHistory.awaitingNotice', { phone: ticket.contactPhone ?? '' })}
        </p>
      )}

      {trip && (
        <Panel>
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bus className="size-4" />
              <span className="font-medium text-foreground">{trip.brandName ?? '—'}</span>
              {trip.busLayoutName && <span>· {trip.busLayoutName}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {trip.fromName ?? '—'}
              <ArrowRight className="size-4 text-muted-foreground" />
              {trip.toName ?? '—'}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-sm">
              <CalendarClock className="size-4 text-primary" />
              <span className="font-medium">
                {formatDateVN(trip.departureAt ?? trip.departureDate, {
                  weekday: 'long',
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                })}
              </span>
              <span className="font-semibold tabular-nums">
                {trip.departureAt ? formatTimeVN(trip.departureAt) : trip.departureTime}
              </span>
            </div>
            <TicketStops pickup={ticket.pickup} dropoff={ticket.dropoff} />
          </div>
        </Panel>
      )}

      <Panel
        icon={<Users />}
        title={t('bookingHistory.passengersAndSeats', { count: ticket.seats.length })}
      >
        <TicketPassengers seats={ticket.seats} />
      </Panel>

      <Panel>
        <div className="space-y-1.5 text-sm">
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
            <span className="font-semibold">{t('bookingHistory.grandTotal')}</span>
            <span className="text-xl font-semibold tabular-nums">{money(ticket.total)}</span>
          </div>
        </div>
      </Panel>

      {(ticket.canCancel || stage === 'paying') && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {ticket.canCancel && (
            <Button
              variant="outline"
              className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-500/30 dark:hover:bg-rose-500/10"
              onClick={() => openCancel(ticket.id)}
            >
              <Ban className="size-4" />
              {t('cancel.title')}
            </Button>
          )}
          {stage === 'paying' && (
            <Button className="gap-1.5" onClick={() => setPaying(true)}>
              <CreditCard className="size-4" />
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
    </ConsolePage>
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
