'use client'

import { memo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDateVN, formatTimeVN } from '@/lib/format'
import type { Currency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ArrowRight, CalendarClock, Star, Tag, User } from 'lucide-react'
import { BusTile } from '@/components/bus-tile'
import { cn } from '@/lib/utils'
import {
  BookingItem,
  effectiveDeparture,
  isBookingReviewable,
} from '@/features/booking/history/booking-types'
import { BookingCardDetails } from './booking-card-details'
import { TicketStatusBadge } from './ticket-status-badge'

type Props = {
  b: BookingItem
  currency: Currency
  isExpanded: boolean
  onToggleExpand: () => void
  onCancelClick?: () => void
  cancelling?: boolean
  onExploreOther?: () => void
  /** Called when user clicks "Viết đánh giá" on a completed booking. */
  onLeaveFeedback?: () => void
  /** True iff this booking is currently showing its inline feedback form. */
  feedbackOpen?: boolean
  /** Whether the user has already submitted a review for this booking. */
  hasReview?: boolean
  /** Extra action buttons for the action row. */
  extraActions?: React.ReactNode
}

/** One ticket in the history list; memoized so tab switches re-render only what changed. */
function BookingCardImpl({
  b,
  currency,
  isExpanded,
  onToggleExpand,
  onCancelClick,
  cancelling,
  onExploreOther,
  onLeaveFeedback,
  feedbackOpen,
  hasReview,
  extraActions,
}: Props) {
  const canReview = isBookingReviewable(b)
  const t = useT()
  const departs = effectiveDeparture(b)
  const departure = b.trip?.departureAt ?? b.trip?.departureDate
  // Snapshot of 'now' taken once per mount — Date.now() in the render body is impure.
  const [now] = useState(Date.now)
  const isUpcoming = departs > now

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        <div className="space-y-3 p-4">
          {/* Code, status, review mark */}
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-base font-semibold tracking-tight">{b.code}</code>
            <TicketStatusBadge booking={b} className="px-2 py-0.5 text-[11px]" />
            {hasReview && (
              <Badge className="gap-1 border-0 bg-amber-50 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
                {t('bookingHistory.reviewed')}
              </Badge>
            )}
          </div>

          {/* Route, operator and when */}
          {b.trip && (
            <div className="flex items-start gap-3">
              <BusTile accent={b.trip.brandAccent} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-1.5 text-sm font-semibold">
                  <span>{b.trip.fromName}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  <span>{b.trip.toName}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[b.trip.brandName, b.trip.busLayoutName].filter(Boolean).join(' · ')}
                </div>
                {departure && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 font-medium',
                        isUpcoming && 'text-primary',
                      )}
                    >
                      <CalendarClock className="size-3.5" aria-hidden />
                      {formatDateVN(departure)}
                      {' · '}
                      {b.trip.departureAt ? formatTimeVN(b.trip.departureAt) : b.trip.departureTime}
                    </span>
                    {b.contactName && (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <User className="size-3.5" aria-hidden />
                        {b.contactName}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Seats and price */}
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {b.seats.map((s, i) => (
                <span
                  key={i}
                  className="inline-flex h-6 items-center rounded-md bg-muted px-2 font-mono text-xs font-semibold"
                >
                  {s.seatCode ?? '—'}
                </span>
              ))}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-lg font-semibold tabular-nums">
                {formatCurrency(b.total, currency)}
              </div>
              {b.discount > 0 && (
                <div className="flex items-center justify-end gap-1 text-xs font-medium text-emerald-600">
                  <Tag className="size-3" aria-hidden />
                  {t('bookingHistory.discountAmount', {
                    amount: formatCurrency(b.discount, currency),
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Expandable details */}
        <BookingCardDetails
          b={b}
          currency={currency}
          isExpanded={isExpanded}
          onToggleExpand={onToggleExpand}
          cancelling={cancelling}
          onCancelClick={onCancelClick}
          canReview={canReview}
          onLeaveFeedback={onLeaveFeedback}
          feedbackOpen={feedbackOpen}
          hasReview={hasReview}
          extraActions={extraActions}
          onExploreOther={onExploreOther}
        />
      </CardContent>
    </Card>
  )
}

export const BookingCard = memo(BookingCardImpl)
