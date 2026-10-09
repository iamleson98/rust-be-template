'use client'

import { Separator } from '@/components/ui/separator'
import {
  AlertCircle,
  Calendar,
  ChevronDown,
  CreditCard,
  FileText,
  Mail,
  Phone,
  PhoneCall,
  User,
  XCircle,
} from 'lucide-react'
import { formatDateTimeVN, formatCurrency, type Currency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { PAYMENT_LABELS, ticketStage, type BookingItem } from './booking-types'
import { InfoTile, PriceRow, TimelineItem } from './booking-card-parts'
import { BookingCardActions } from './booking-card-actions'
import { TicketPassengers, TicketStops } from './ticket-parts'

/** The expandable part of a ticket card: stops, passengers, contact, price and history. */
export function BookingCardDetails({
  b,
  currency,
  isExpanded,
  onToggleExpand,
  cancelling,
  onCancelClick,
  canReview,
  onLeaveFeedback,
  feedbackOpen,
  hasReview,
  extraActions,
  onExploreOther,
}: {
  b: BookingItem
  currency: Currency
  isExpanded: boolean
  onToggleExpand: () => void
  cancelling?: boolean
  onCancelClick?: () => void
  canReview: boolean
  onLeaveFeedback?: () => void
  feedbackOpen?: boolean
  hasReview?: boolean
  extraActions?: React.ReactNode
  onExploreOther?: () => void
}) {
  const t = useT()
  const stage = ticketStage(b)
  return (
    <div className="border-t bg-slate-50/70">
      <button
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          {t('bookingHistory.bookingDetails')}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded && (
        <div className="space-y-4 px-4 pb-5">
          <TicketStops pickup={b.pickup} dropoff={b.dropoff} />

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              {t('bookingHistory.passengersAndSeats', { count: b.seats.length })}
            </div>
            <TicketPassengers seats={b.seats} />
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <InfoTile
              icon={<User className="h-3.5 w-3.5 text-muted-foreground" />}
              label={t('bookingHistory.contactPerson')}
              value={b.contactName ?? '—'}
            />
            <InfoTile
              icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
              label={t('bookingHistory.phone')}
              value={b.contactPhone ?? '—'}
            />
            <InfoTile
              icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
              label={t('booking.contactEmail')}
              value={b.contactEmail ?? '—'}
            />
          </div>

          <Separator />

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              {t('bookingHistory.priceDetails')}
            </div>
            <div className="space-y-1.5 rounded-lg bg-white p-3 text-sm ring-1 ring-black/5">
              <PriceRow
                label={t('bookingHistory.subtotalSeats', { count: b.seats.length })}
                value={formatCurrency(b.subtotal, currency)}
              />
              {b.discount > 0 && (
                <PriceRow
                  label={t('bookingHistory.discount')}
                  value={`- ${formatCurrency(b.discount, currency)}`}
                  valueClass="text-blue-600 font-semibold"
                />
              )}
              {b.paymentMethod && (
                <PriceRow
                  label={t('payment.method')}
                  value={t(PAYMENT_LABELS[b.paymentMethod] ?? b.paymentMethod)}
                />
              )}
              <div className="mt-1.5 flex items-center justify-between border-t pt-1.5">
                <span className="font-bold">{t('bookingHistory.grandTotal')}</span>
                <span className="text-lg font-extrabold text-blue-700">
                  {formatCurrency(b.total, currency)}
                </span>
              </div>
            </div>
          </div>

          <Separator />

          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground">
              <Calendar className="h-3.5 w-3.5" />
              {t('common.status')}
            </div>
            <div className="space-y-2">
              <TimelineItem
                icon={<FileText className="h-3.5 w-3.5" />}
                label={t('bookingHistory.timelineBooked')}
                time={b.createdAt}
                active
              />
              {stage === 'awaiting' && (
                <TimelineItem
                  icon={<PhoneCall className="h-3.5 w-3.5" />}
                  label={t('bookingHistory.timelineAwaiting')}
                  time={b.updatedAt}
                />
              )}
              {stage === 'cancelled' && (
                <TimelineItem
                  icon={<XCircle className="h-3.5 w-3.5" />}
                  label={t('bookingHistory.statusCancelled')}
                  time={b.updatedAt}
                  active
                  destructive
                />
              )}
              {stage === 'paying' && b.expiresAt && (
                <TimelineItem
                  icon={<AlertCircle className="h-3.5 w-3.5" />}
                  label={t('bookingHistory.holdExpiresAt', {
                    time: formatDateTimeVN(b.expiresAt),
                  })}
                  time={b.expiresAt}
                />
              )}
            </div>
          </div>

          <BookingCardActions
            bookingCode={b.code}
            hasQr={stage !== 'cancelled' && stage !== 'completed'}
            canCancel={b.canCancel}
            cancelling={cancelling}
            onCancelClick={onCancelClick}
            canReview={canReview}
            onLeaveFeedback={onLeaveFeedback}
            feedbackOpen={feedbackOpen}
            hasReview={hasReview}
            extraActions={extraActions}
            onExploreOther={onExploreOther}
          />
        </div>
      )}
    </div>
  )
}
