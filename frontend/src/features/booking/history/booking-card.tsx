'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { VEHICLE_TYPE_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import {
  Bus,
  User,
  Clock,
  XCircle,
  CheckCircle2,
  Tag,
  Sparkles,
  Hash,
  Timer,
  ArrowRightLeft,
  Landmark,
  AlertCircle,
  Star,
} from 'lucide-react'
import {
  BookingItem,
  STATUS_CONFIG,
  isBookingReviewable,
} from '@/features/booking/history/booking-types'
import { BookingCardDetails } from './booking-card-details'

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
  /** Optional extra action buttons (rendered in the action row). Used by
   *  Subagent A (ROUTE-1) for the "Đường đi đến điểm đón" button. */
  extraActions?: React.ReactNode
}

function StatusIcon({ name }: { name: 'check' | 'clock' | 'xcircle' | 'alert' | 'landmark' }) {
  if (name === 'check') return <CheckCircle2 className="h-3.5 w-3.5" />
  if (name === 'clock') return <Clock className="h-3.5 w-3.5" />
  if (name === 'xcircle') return <XCircle className="h-3.5 w-3.5" />
  if (name === 'landmark') return <Landmark className="h-3.5 w-3.5" />
  return <AlertCircle className="h-3.5 w-3.5" />
}

/**
 * BookingCard — single booking item. Memoized so re-renders of the parent
 * list (e.g. when filtering tabs) don't re-render cards whose props are
 * unchanged.
 *
 * The action row at the bottom of the expanded details supports arbitrary
 * `extraActions` so other subagents (ROUTE-1 directions-to-pickup button)
 * can plug in without modifying this component.
 */
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
  const sc = STATUS_CONFIG[b.status] ?? STATUS_CONFIG.pending
  const canCancel = b.status === 'held' || b.status === 'pending' || b.status === 'confirmed'
  const canReview = isBookingReviewable(b)
  const depTime = b.trip ? new Date(b.trip.departureAt) : null
  const isUpcoming = depTime ? depTime.getTime() > Date.now() : false
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
                    <Badge className={`text-[11px] gap-1 px-2.5 py-0.5 ${sc.cls} border-0 font-semibold`}>
                      <StatusIcon name={sc.icon} /> {sc.label}
                    </Badge>
                    {isUpcoming && b.status !== 'cancelled' && (
                      <Badge className="text-[10px] gap-1 bg-blue-100 text-blue-700 border-0 font-semibold">
                        <Sparkles className="h-3 w-3" /> Sắp đi
                      </Badge>
                    )}
                    {hasReview && (
                      <Badge className="text-[10px] gap-1 bg-amber-100 text-amber-700 border-0 font-semibold">
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> Đã đánh giá
                      </Badge>
                    )}
                  </div>
                  {/* QR placeholder */}
                  <div className="h-10 w-10 rounded-lg bg-slate-100 ring-1 ring-black/5 flex items-center justify-center shrink-0 group-hover:bg-blue-50 transition-colors">
                    <span className="text-[9px] font-bold text-slate-400 group-hover:text-blue-500 transition-colors">
                      QR
                    </span>
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
                          <span className="text-muted-foreground/60">•</span>
                          <span>{VEHICLE_TYPE_LABELS[b.trip.vehicleType] ?? b.trip.vehicleType}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Row 3: Date/time + seats + price */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
                  {/* Date/time */}
                  {b.trip && depTime && (
                    <div className="flex items-center gap-2.5">
                      <div className="flex flex-col items-center bg-blue-50/80 rounded-lg px-3 py-2 ring-1 ring-blue-100/50">
                        <span className="text-[10px] uppercase font-bold text-blue-600 tracking-wide">
                          {new Date(b.trip.departureAt).toLocaleDateString('vi-VN', {
                            weekday: 'short',
                            timeZone: 'Asia/Ho_Chi_Minh',
                          })}
                        </span>
                        <span className="text-lg font-extrabold text-blue-800 leading-tight">
                          {new Date(b.trip.departureAt).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            timeZone: 'Asia/Ho_Chi_Minh',
                          })}
                        </span>
                        <span className="text-[10px] text-blue-600">
                          {new Date(b.trip.departureAt).toLocaleDateString('vi-VN', {
                            month: '2-digit',
                            year: 'numeric',
                            timeZone: 'Asia/Ho_Chi_Minh',
                          })}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <Timer className="h-3.5 w-3.5 text-blue-500" />
                          <span className="text-sm font-bold">
                            {new Date(b.trip.departureAt).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'Asia/Ho_Chi_Minh',
                            })}
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
                        <span className="font-mono font-bold">{s.code}</span>
                      </span>
                    ))}
                    {b.seats.length > 0 && (
                      <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0">
                        <Hash className="h-2.5 w-2.5" />
                        {b.seats.length} ghế
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
                        Giảm {formatCurrency(b.discount, currency)}
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
              canCancel={canCancel}
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
