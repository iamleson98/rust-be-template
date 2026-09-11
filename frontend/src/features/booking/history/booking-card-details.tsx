'use client'

// Extracted from the original 'booking-card.tsx'.

import { Separator } from '@/components/ui/separator'
import {
  User,
  Phone,
  Mail,
  Clock,
  Calendar,
  XCircle,
  CheckCircle2,
  FileText,
  ChevronDown,
  AlertCircle,
  CreditCard,
  MapPin,
} from 'lucide-react'
import { formatDateTimeVN, SEAT_CLASS_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import {
  BookingItem,
  PAYMENT_LABELS,
} from '@/features/booking/history/booking-types'
import { InfoTile, PriceRow, TimelineItem } from './booking-card-parts'
import { BookingCardActions } from './booking-card-actions'

export function BookingCardDetails({
  b,
  currency,
  isExpanded,
  onToggleExpand,
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
  b: BookingItem
  currency: Currency
  isExpanded: boolean
  onToggleExpand: () => void
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
  return (
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

            <BookingCardActions
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
          </div>
        </div>
      )}
    </div>
  )
}
