'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  Ban,
  Bus,
  CalendarClock,
  CheckCircle2,
  Flag,
  Loader2,
  Lock,
  Phone,
  PhoneCall,
  Ticket as TicketIcon,
  User,
} from 'lucide-react'
import { adminBookingsGetOptions } from '@spa/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@spa/components/ui/alert-dialog'
import { Button } from '@spa/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@spa/components/ui/dialog'
import { ScrollArea } from '@spa/components/ui/scroll-area'
import { Textarea } from '@spa/components/ui/textarea'
import { PAYMENT_LABELS, hasDeparted, ticketStage } from '@spa/features/booking/history/booking-types'
import { TicketPassengers, TicketStops } from '@spa/features/booking/history/ticket-parts'
import { TicketStatusBadge } from '@spa/features/booking/history/ticket-status-badge'
import { formatDateTimeVN, formatDateVN, formatTimeVN, formatVND } from '@spa/lib/format'
import { useT } from '@spa/lib/i18n'
import { TicketDetailSkeleton } from './ticket-detail-skeleton'
import { useTicketStatus, type TicketAction } from './use-ticket-status'

/**
 * A ticket for staff: who to call, the trip, stops and seats, and the next step.
 * A placed ticket is confirmed after phoning the customer; a confirmed one is
 * completed after the trip; either can be cancelled. Completed and cancelled
 * tickets are final.
 */
export function BookingDetailDialog({
  bookingId,
  onClose,
}: {
  bookingId: string | null
  onClose: () => void
}) {
  const t = useT()
  const { data, isLoading, isError, refetch } = useQuery({
    ...adminBookingsGetOptions({ path: { id: bookingId ?? '' } }),
    enabled: !!bookingId,
  })
  const status = useTicketStatus()
  const [reason, setReason] = useState('')
  // Cancelling is final (the seats go back on sale): it asks first.
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const ticket = data?.item
  const stage = ticket ? ticketStage(ticket) : null
  const final = ticket?.status === 'completed' || ticket?.status === 'cancelled'

  const act = async (action: TicketAction) => {
    if (!ticket) return
    if (await status.set(ticket, action, reason)) {
      setReason('')
      return true
    }
    return false
  }

  return (
    <Dialog open={!!bookingId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-2xl flex-col overflow-clip">
        <DialogHeader icon={<TicketIcon />}>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {ticket
              ? t('adminTickets.ticketCode', { code: ticket.code })
              : t('adminTickets.detailTitle')}
            {ticket && <TicketStatusBadge booking={ticket} />}
          </DialogTitle>
          <DialogDescription>{t('adminTickets.detailDescription')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <TicketDetailSkeleton />
        ) : isError || !ticket ? (
          <div className="p-4 text-center">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
            <p className="text-sm text-muted-foreground">{t('adminTickets.detailLoadFailed')}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>
              {t('payment.retry')}
            </Button>
          </div>
        ) : (
          <ScrollArea className="-mx-6 flex-1 px-6">
            <div className="space-y-4 pb-4">
              {/* Who to call */}
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-slate-50/60 p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {ticket.contactName ?? '—'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 font-mono text-sm">
                    <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                    {ticket.contactPhone ?? '—'}
                  </div>
                  {ticket.contactEmail && (
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {ticket.contactEmail}
                    </div>
                  )}
                </div>
                {ticket.contactPhone && (
                  <Button asChild size="sm" variant="outline" className="gap-1.5">
                    <a href={`tel:${ticket.contactPhone}`}>
                      <PhoneCall className="h-4 w-4" />
                      {t('adminTickets.callCustomer')}
                    </a>
                  </Button>
                )}
              </section>

              {/* Trip */}
              {ticket.trip && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Bus className="h-4 w-4 text-blue-600" />
                      {ticket.trip.fromName ?? '—'}
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      {ticket.trip.toName ?? '—'}
                    </span>
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <CalendarClock className="h-4 w-4" />
                      {formatDateVN(ticket.trip.departureAt ?? ticket.trip.departureDate)}{' '}
                      {ticket.trip.departureAt
                        ? formatTimeVN(ticket.trip.departureAt)
                        : ticket.trip.departureTime}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {ticket.trip.brandName}
                    {ticket.trip.busLayoutName && ` · ${ticket.trip.busLayoutName}`} ·{' '}
                    {ticket.trip.routeName}
                  </div>
                  <TicketStops pickup={ticket.pickup} dropoff={ticket.dropoff} />
                </section>
              )}

              {/* Passengers and seats */}
              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('adminTickets.seatsAndPassengers')}
                </h3>
                <TicketPassengers seats={ticket.seats} />
              </section>

              {/* Money */}
              <section className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('payment.method')}</span>
                  <span className="font-medium">
                    {ticket.paymentMethod
                      ? t(PAYMENT_LABELS[ticket.paymentMethod] ?? ticket.paymentMethod)
                      : '—'}
                  </span>
                </div>
                {ticket.discount > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>{t('adminTickets.discounted')}</span>
                    <span>-{formatVND(ticket.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1.5 font-bold">
                  <span>{t('booking.totalAmount')}</span>
                  <span className="text-blue-700">{formatVND(ticket.total)}</span>
                </div>
                <div className="pt-1 text-[11px] text-muted-foreground">
                  {t('adminTickets.bookedAt')}: {formatDateTimeVN(ticket.createdAt)}
                </div>
              </section>

              {/* Next step */}
              {final ? (
                <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                  <Lock className="h-4 w-4 shrink-0" />
                  {t('adminTickets.finalNotice')}
                </p>
              ) : (
                <section className="space-y-2.5 rounded-lg border border-dashed bg-slate-50/50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('adminTickets.nextStep')}
                  </div>
                  {stage === 'awaiting' && (
                    <p className="text-xs text-amber-800">{t('adminTickets.awaitingHint')}</p>
                  )}
                  {stage === 'paying' && (
                    <p className="text-xs text-muted-foreground">{t('adminTickets.payingHint')}</p>
                  )}
                  {ticket.status === 'confirmed' && !hasDeparted(ticket) && (
                    <p className="text-xs text-muted-foreground">
                      {t('adminTickets.completeAfterDeparture')}
                    </p>
                  )}
                  <Textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t('adminTickets.reasonPlaceholder')}
                    className="min-h-10 resize-none text-base md:text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    {ticket.status === 'pending' && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={status.pending}
                        onClick={() => act('confirmed')}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {t('adminTickets.confirmAfterCall')}
                      </Button>
                    )}
                    {ticket.status === 'confirmed' && hasDeparted(ticket) && (
                      <Button
                        size="sm"
                        className="gap-1.5"
                        disabled={status.pending}
                        onClick={() => act('completed')}
                      >
                        <Flag className="h-4 w-4" />
                        {t('adminTickets.markCompleted')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                      disabled={status.pending}
                      onClick={() => setConfirmingCancel(true)}
                    >
                      <Ban className="h-4 w-4" />
                      {t('adminTickets.cancelTicket')}
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>

      <AlertDialog
        open={confirmingCancel}
        onOpenChange={(open) => {
          if (!status.pending) setConfirmingCancel(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('adminTickets.cancelTitle', { code: ticket?.code ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('adminTickets.cancelBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          {reason.trim() && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">{t('adminTickets.cancelReasonLabel')}: </span>
              {reason.trim()}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={status.pending}>
              {t('adminTickets.keepTicket')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={status.pending}
              onClick={async (e) => {
                // Stay open until the server answers; a failure keeps it open to retry.
                e.preventDefault()
                if (await act('cancelled')) setConfirmingCancel(false)
              }}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {status.pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Ban className="size-4" />
              )}
              {t('adminTickets.cancelTicket')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
