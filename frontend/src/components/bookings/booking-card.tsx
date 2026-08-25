'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { formatDateTimeVN, SEAT_CLASS_LABELS, VEHICLE_TYPE_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import {
  Bus,
  User,
  Phone,
  Mail,
  Clock,
  Calendar,
  XCircle,
  CheckCircle2,
  Loader2,
  FileText,
  QrCode,
  ChevronDown,
  AlertCircle,
  CreditCard,
  Tag,
  Sparkles,
  Hash,
  Timer,
  ArrowRightLeft,
  Ban,
  TimerReset,
  Landmark,
  MapPin,
  Eye,
  Search,
  Star,
  MessageSquare,
} from 'lucide-react'
import {
  BookingItem,
  PAYMENT_LABELS,
  STATUS_CONFIG,
  isBookingReviewable,
} from '@/components/bookings/booking-types'

type Currency = 'VND' | 'USD'

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
                          {b.trip.distanceKm > 0 && (
                            <>
                              <span className="text-muted-foreground/60">•</span>
                              <span>{b.trip.distanceKm} km</span>
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
                        {b.trip.durationMin > 0 && (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <TimerReset className="h-3 w-3" />
                            {Math.floor(b.trip.durationMin / 60)}h {b.trip.durationMin % 60}m
                          </div>
                        )}
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
            <div className="border-t bg-slate-50/70">
              <button
                onClick={onToggleExpand}
                className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                <span className="inline-flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Chi tiết đặt vé
                </span>
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                />
              </button>
              {isExpanded && (
                <div className="overflow-hidden">
                  <div className="px-4 pb-5 space-y-4">
                    {/* Pickup / dropoff */}
                    {b.trip && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <InfoTile
                          icon={<MapPin className="h-3.5 w-3.5 text-blue-600" />}
                          label="Điểm đón"
                          value={b.pickupPointName ?? 'Bến xe xuất phát'}
                        />
                        <InfoTile
                          icon={<MapPin className="h-3.5 w-3.5 text-rose-600" />}
                          label="Điểm trả"
                          value={b.droppingPointName ?? 'Bến xe đích'}
                        />
                      </div>
                    )}

                    {/* Passenger details */}
                    <div>
                      <div className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        Hành khách
                      </div>
                      <div className="space-y-1.5">
                        {b.seats.map((s, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-sm bg-white rounded-lg px-3 py-2.5 ring-1 ring-black/5"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 inline-flex items-center justify-center text-sm font-bold">
                                {(s.passengerName ?? '?').slice(0, 1).toUpperCase()}
                              </div>
                              <div>
                                <div className="font-semibold">{s.passengerName ?? 'Hành khách'}</div>
                                <div className="text-[11px] text-muted-foreground">
                                  {s.passengerType === 'child'
                                    ? `Trẻ em${s.passengerAge > 0 ? `• ${s.passengerAge} tuổi` : ''}`
                                    : 'Người lớn'}
                                  {' • '}
                                  {SEAT_CLASS_LABELS[s.seatClass] ?? s.seatClass}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono font-bold">
                                {s.code}
                              </span>
                              <span className="font-bold">{formatCurrency(s.price, currency)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    {/* Contact info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                      <InfoTile
                        icon={<User className="h-3.5 w-3.5 text-muted-foreground" />}
                        label="Người liên hệ"
                        value={b.contactName}
                      />
                      <InfoTile
                        icon={<Phone className="h-3.5 w-3.5 text-muted-foreground" />}
                        label="Điện thoại"
                        value={b.contactPhone}
                      />
                      <InfoTile
                        icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
                        label="Email"
                        value={b.contactEmail ?? '—'}
                      />
                    </div>

                    <Separator />

                    {/* Price breakdown */}
                    <div>
                      <div className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                        <CreditCard className="h-3.5 w-3.5" />
                        Chi tiết giá
                      </div>
                      <div className="bg-white rounded-lg ring-1 ring-black/5 p-3 space-y-1.5 text-sm">
                        <PriceRow
                          label={`Tạm tính (${b.seats.length} ghế)`}
                          value={formatCurrency(b.subtotal, currency)}
                        />
                        {b.discount > 0 && (
                          <PriceRow
                            label="Giảm giá"
                            value={`- ${formatCurrency(b.discount, currency)}`}
                            valueClass="text-blue-600 font-semibold"
                          />
                        )}
                        {b.fees > 0 && (
                          <PriceRow label="Phí dịch vụ" value={formatCurrency(b.fees, currency)} />
                        )}
                        {b.paymentMethod && (
                          <div className="pt-1.5 border-t mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <CreditCard className="h-3 w-3" />
                              Phương thức thanh toán
                            </span>
                            <span className="font-semibold text-foreground">
                              {PAYMENT_LABELS[b.paymentMethod] ?? b.paymentMethod}
                            </span>
                          </div>
                        )}
                        <div className="pt-1.5 border-t mt-1.5 flex items-center justify-between">
                          <span className="font-bold">Tổng cộng</span>
                          <span className="font-extrabold text-blue-700 text-lg">
                            {formatCurrency(b.total, currency)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    {/* Timeline */}
                    <div>
                      <div className="text-xs font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        Trạng thái
                      </div>
                      <div className="space-y-2">
                        <TimelineItem
                          icon={<FileText className="h-3.5 w-3.5" />}
                          label="Đặt vé thành công"
                          time={b.createdAt}
                          active
                        />
                        {b.paidAt && (
                          <TimelineItem
                            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                            label="Thanh toán thành công"
                            time={b.paidAt}
                            active
                          />
                        )}
                        {b.cancelledAt && (
                          <TimelineItem
                            icon={<XCircle className="h-3.5 w-3.5" />}
                            label="Đã hủy"
                            time={b.cancelledAt}
                            active
                            destructive
                          />
                        )}
                        {!b.paidAt && !b.cancelledAt && b.expiresAt && (
                          <TimelineItem
                            icon={<AlertCircle className="h-3.5 w-3.5" />}
                            label={`Hết hạn giữ chỗ lúc ${formatDateTimeVN(b.expiresAt)}`}
                            time={b.expiresAt}
                          />
                        )}
                      </div>
                    </div>

                    {/* ─── Action row ─────────────────────────────────────
                        Both the feedback button (completed bookings) and the
                        directions-to-pickup button (upcoming bookings, added
                        by Subagent A / ROUTE-1) live here. `extraActions`
                        lets other subagents plug in without modifying this
                        component.
                    */}
                    <div className="flex items-center gap-2 pt-2 flex-wrap">
                      <Button
                        size="sm"
                        className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
                        onClick={() => {
                          // Could open a detail modal in future
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Xem chi tiết
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
                          Huỷ vé
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
                          {feedbackOpen ? 'Ẩn form đánh giá' : 'Viết đánh giá'}
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
                          {feedbackOpen ? 'Ẩn đánh giá' : 'Xem đánh giá'}
                        </Button>
                      )}

                      <Button variant="outline" size="sm" className="gap-1.5">
                        <QrCode className="h-3.5 w-3.5" />
                        Mã QR
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
                        Đặt chuyến khác
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  )
}

export const BookingCard = memo(BookingCardImpl)

/* ───────────────────────────────────────────────────────────────────────
 * Small presentational helpers — kept in this file so the BookingCard is
 * fully self-contained and tree-shakeable.
 * ─────────────────────────────────────────────────────────────────────── */
function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg ring-1 ring-black/5 p-3">
      <div className="text-[10px] uppercase font-bold tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

function PriceRow({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass ?? 'font-medium'}>{value}</span>
    </div>
  )
}

function TimelineItem({
  icon,
  label,
  time,
  active,
  destructive,
}: {
  icon: React.ReactNode
  label: string
  time: string
  active?: boolean
  destructive?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
          destructive
            ? 'bg-rose-100 text-rose-600'
            : active
            ? 'bg-blue-100 text-blue-600'
            : 'bg-slate-100 text-slate-400'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-semibold ${destructive ? 'text-rose-700' : ''}`}>{label}</div>
        <div className="text-xs text-muted-foreground">{formatDateTimeVN(time)}</div>
      </div>
    </div>
  )
}
