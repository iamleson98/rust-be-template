'use client'

// Extracted from the original 'booking-card.tsx'.

import { Button } from '@/components/ui/button'
import {
  Eye,
  Loader2,
  Ban,
  MessageSquare,
  Star,
  QrCode,
  Search,
} from 'lucide-react'
import { useT } from '@/lib/i18n'

/* ─── Action row ─────────────────────────────────────
    Both the feedback button (completed bookings) and the
    directions-to-pickup button (upcoming bookings, added
    by Subagent A / ROUTE-1) live here. `extraActions`
    lets other subagents plug in without modifying this
    component.
*/
export function BookingCardActions({
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
  return (
    <div className="flex items-center gap-2 pt-2 flex-wrap">
      <Button
        size="sm"
        className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
        onClick={() => {
          // Could open a detail modal in future
        }}
      >
        <Eye className="h-3.5 w-3.5" />
        {t('bookingHistory.viewDetails')}
      </Button>

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

      <Button variant="outline" size="sm" className="gap-1.5">
        <QrCode className="h-3.5 w-3.5" />
        {t('bookingHistory.qrCode')}
      </Button>

      {/* Extensible slot — Subagent A's directions button goes here. */}
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
    </div>
  )
}
