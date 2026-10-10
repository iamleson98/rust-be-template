'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Ban, CreditCard, MessageSquare, Star, QrCode, Search } from 'lucide-react'
import { useBookingPayments } from '@/features/booking/api'
import { PaymentDialog } from '@/features/booking/flow/payment-dialog'
import { trackConversion } from '@/lib/analytics'
import { useT } from '@/lib/i18n'
import { TicketQrDialog } from './ticket-qr-dialog'

/** Finish paying an online booking: resumes its payment, or starts one. */
function PayButton({ bookingId, code, total }: { bookingId: string; code: string; total: number }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const payments = useBookingPayments(bookingId, open)
  return (
    <>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <CreditCard className="size-3.5" />
        {t('booking.payment')}
      </Button>
      {open && (
        <PaymentDialog
          paymentId={payments.data?.items?.[0]?.id}
          bookingId={bookingId}
          bookingTotal={total}
          open
          onClose={() => setOpen(false)}
          onPaid={(payment) => {
            setOpen(false)
            trackConversion('purchase', {
              value: payment.amount,
              currency: payment.currency,
              transactionId: code,
            })
          }}
        />
      )}
    </>
  )
}

/** A ticket card's actions: pay, QR (shown in place), cancel, review, book again. The details are the expanded card itself. */
export function BookingCardActions({
  bookingId,
  bookingCode,
  total,
  payable,
  hasQr,
  canCancel,
  cancelling,
  onCancelClick,
  canReview,
  onLeaveFeedback,
  feedbackOpen,
  hasReview,
  extraActions,
  onExploreOther,
}: {
  bookingId: string
  bookingCode: string
  total: number
  /** An online payment is still to be made. */
  payable: boolean
  /** The ticket is open, so it has a boarding QR. */
  hasQr: boolean
  canCancel: boolean
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
  const [qrOpen, setQrOpen] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-2 pt-2">
      {payable && <PayButton bookingId={bookingId} code={bookingCode} total={total} />}
      {hasQr && !payable && (
        <Button size="sm" className="gap-1.5" onClick={() => setQrOpen(true)}>
          <QrCode className="size-3.5" />
          {t('bookingHistory.qrCode')}
        </Button>
      )}

      {canCancel && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
          onClick={onCancelClick}
          disabled={cancelling}
        >
          {cancelling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Ban className="h-3.5 w-3.5" />
          )}
          {t('cancel.title')}
        </Button>
      )}

      {canReview && onLeaveFeedback && !hasReview && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
          onClick={onLeaveFeedback}
          aria-expanded={feedbackOpen}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {feedbackOpen ? t('bookingHistory.hideReviewForm') : t('bookingHistory.writeReview')}
        </Button>
      )}

      {canReview && hasReview && (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 border-amber-200"
          onClick={onLeaveFeedback}
          aria-expanded={feedbackOpen}
        >
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {feedbackOpen ? t('bookingHistory.hideReview') : t('bookingHistory.viewReview')}
        </Button>
      )}

      {extraActions}

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground hover:text-foreground"
        onClick={onExploreOther}
      >
        <Search className="h-3.5 w-3.5" />
        {t('bookingHistory.bookAnotherTrip')}
      </Button>

      <TicketQrDialog code={qrOpen ? bookingCode : null} onOpenChange={setQrOpen} />
    </div>
  )
}
