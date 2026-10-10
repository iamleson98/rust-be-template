'use client'

import { SEAT_CLASS_LABELS } from '@/lib/labels'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { PASSENGER_TYPE_META } from './booking-form'
import type { Ticket } from './use-booking-form'

/** One line per ticket, the coupon discount (when there is one) and the total to pay. */
export function PriceSummary({
  tickets,
  couponCode,
  discount,
  total,
  className,
}: {
  tickets: Ticket[]
  couponCode?: string
  discount: number
  total: number
  className?: string
}) {
  const t = useT()
  const money = useMoney()
  return (
    <div className={`rounded-lg border bg-slate-50 p-4 space-y-2 ${className ?? ''}`}>
      <h4 className="font-semibold text-sm mb-2">{t('bookingFlow.priceDetails')}</h4>
      {tickets.map(({ seat, type, price }) => (
        <div key={seat.id} className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground min-w-0 truncate">
            <span className="font-mono font-semibold text-foreground">{seat.code}</span>
            {' · '}
            {t(SEAT_CLASS_LABELS[seat.class] ?? seat.class)}
            {' · '}
            {t(PASSENGER_TYPE_META[type].label)}
          </span>
          <span className="tabular-nums">{money(price)}</span>
        </div>
      ))}
      {discount > 0 && (
        <div className="flex justify-between text-sm text-blue-700">
          <span className="text-muted-foreground">
            {t('bookingFlow.discountLabel', { code: couponCode ?? '' })}
          </span>
          <span className="tabular-nums">-{money(discount)}</span>
        </div>
      )}
      <div className="border-t pt-2 flex justify-between font-bold text-base">
        <span>{t('bookingFlow.grandTotal')}</span>
        <span className="text-blue-700 tabular-nums">{money(total)}</span>
      </div>
    </div>
  )
}
