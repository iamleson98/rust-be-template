'use client'

import { memo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatCurrency, formatDateVN, formatTimeVN } from '@/lib/format'
import type { Currency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { Bus, User, Tag, Sparkles, Hash, Timer, ArrowRightLeft, Star } from 'lucide-react'
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
  const accentColor = b.trip?.brandAccent ?? '#2563eb'

  return (
    <Card className="overflow-hidden ring-1 ring-black/5 transition-all duration-300 group">
      {/* Brand color accent bar on left */}
      <div className="relative flex">
        <div
          className="hidden md:block w-1.5 shrink-0 self-stretch"
          style={{ background: accentColor }}
        />
        <div className="flex-1">
          {/* Top color stripe */}
          <div
            className="h-1.5"
            style={{
              background: `linear-gradient(90deg, ${accentColor}, ${accentColor}44, transparent)`,
            }}
          />
          <CardContent className="p-0">
            {/* Main row */}
            <div className="p-4 md:p-5">
              <div className="flex flex-col gap-4">
                {/* Row 1: Booking code + status */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <code className="text-xl font-mono font-extrabold text-blue-700 tracking-tight">
                      {b.code}
                    </code>
                    <TicketStatusBadge booking={b} className="px-2.5 py-0.5 text-[11px]" />
                    {isUpcoming && b.status !== 'cancelled' && (
                      <Badge className="text-[10px] gap-1 bg-blue-100 text-blue-700 border-0 font-semibold">
                        <Sparkles className="h-3 w-3" /> {t('bookingHistory.upcoming')}
                      </Badge>
                    )}
                    {hasReview && (
                      <Badge className="text-[10px] gap-1 bg-amber-100 text-amber-700 border-0 font-semibold">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />{' '}
                        {t('bookingHistory.reviewed')}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Row 2: Route prominently */}
                {b.trip && (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-600 inline-flex items-center justify-center shrink-0">
                        <Bus className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                          <span>{b.trip.fromName}</span>
                          <ArrowRightLeft className="h-4 w-4 text-blue-500" />
                          <span>{b.trip.toName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                          <span className="font-medium text-foreground/80">{b.trip.brandName}</span>
                          {b.trip.busLayoutName && (
                            <>
                              <span className="text-muted-foreground/60">•</span>
                              <span>{b.trip.busLayoutName}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 3: Date/time + seats + price */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
                  {/* Date/time */}
                  {departure && (
                    <div className="flex items-center gap-2.5">
                      <div className="flex flex-col items-center rounded-lg bg-blue-50/80 px-3 py-2 ring-1 ring-blue-100/50">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-blue-600">
                          {formatDateVN(departure, { weekday: 'short' })}
                        </span>
                        <span className="text-lg font-extrabold leading-tight text-blue-800">
                          {formatDateVN(departure, { day: '2-digit' })}
                        </span>
                        <span className="text-[10px] text-blue-600">
                          {formatDateVN(departure, { month: '2-digit', year: 'numeric' })}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Timer className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-sm font-bold">
                            {b.trip?.departureAt
                              ? formatTimeVN(b.trip.departureAt)
                              : b.trip?.departureTime}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {b.contactName}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Seats compact badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {b.seats.map((s, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium ring-1 ring-black/5"
                      >
                        <span className="font-mono font-bold">{s.seatCode ?? '—'}</span>
                      </span>
                    ))}
                    {b.seats.length > 0 && (
                      <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0">
                        <Hash className="h-2.5 w-2.5" />
                        {t('bookingHistory.seatsCount', { count: b.seats.length })}
                      </Badge>
                    )}
                  </div>

                  {/* Price prominently */}
                  <div className="sm:ml-auto text-right">
                    <div className="text-2xl font-extrabold text-blue-700">
                      {formatCurrency(b.total, currency)}
                    </div>
                    {b.discount > 0 && (
                      <div className="text-xs text-blue-600 flex items-center gap-1 justify-end font-medium">
                        <Tag className="h-3 w-3" />
                        {t('bookingHistory.discountAmount', {
                          amount: formatCurrency(b.discount, currency),
                        })}
                      </div>
                    )}
                  </div>
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
        </div>
      </div>
    </Card>
  )
}

export const BookingCard = memo(BookingCardImpl)
