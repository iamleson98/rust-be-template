'use client'

import { Button } from '@/components/ui/button'
import { ChevronLeft, Loader2, Lock, ShieldCheck, TicketPercent } from 'lucide-react'
import { validityText } from '@/features/campaigns/labels'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PriceSummary } from './price-summary'
import type { PaymentProvider } from '@/lib/payment'
import { ProviderTile } from './provider-tile'
import type { CheckoutCoupon } from './use-checkout-coupon'
import type { Ticket } from './use-booking-form'
import { StepActions } from './step-actions'

export type PaymentMethodKey = 'momo' | 'vnpay' | 'bank' | 'cod'

/** The checkout methods, in display order, and the provider behind each. */
const METHOD_PROVIDER: Record<PaymentMethodKey, PaymentProvider> = {
  momo: 'momo',
  vnpay: 'vnpay',
  bank: 'vietqr',
  cod: 'cod',
}

/** The methods the server can take payments with (every one until it has said). */
export function offeredMethods(enabled: PaymentProvider[] | undefined): PaymentMethodKey[] {
  return (Object.keys(METHOD_PROVIDER) as PaymentMethodKey[]).filter(
    (m) => !enabled || enabled.includes(METHOD_PROVIDER[m]),
  )
}

const methodText = (t: ReturnType<typeof useT>, m: PaymentMethodKey) =>
  ({
    momo: { label: t('payment.momo'), sub: t('payment.momoDesc') },
    vnpay: { label: t('payment.vnpay'), sub: t('payment.vnpayDesc') },
    bank: { label: t('payment.vietqr'), sub: t('payment.vietqrDesc') },
    cod: { label: t('bookingFlow.payCod'), sub: t('bookingFlow.cash') },
  })[m]

/**
 * Step 3, checkout: how to pay, the customer's coupon (next to the price it discounts),
 * the price breakdown and the pay button. Methods use solid icon tiles rather
 * than emoji, which render differently on every platform.
 */
export function PaymentMethodStep({
  methods,
  method,
  onMethodChange,
  coupon,
  tickets,
  total,
  error,
  submitting,
  onBack,
  onSubmit,
}: {
  /** What the server can take, see `offeredMethods`. */
  methods: PaymentMethodKey[]
  method: PaymentMethodKey
  onMethodChange: (method: PaymentMethodKey) => void
  coupon: CheckoutCoupon
  tickets: Ticket[]
  total: number
  error: string
  submitting: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  const t = useT()
  const money = useMoney()
  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm mb-3">{t('payment.method')}</h3>
        <div
          role="radiogroup"
          aria-label={t('payment.method')}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {methods.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('bookingFlow.noPaymentMethods')}</p>
          )}
          {methods.map((key) => {
            const m = { key, provider: METHOD_PROVIDER[key], ...methodText(t, key) }
            const selected = method === key
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onMethodChange(key)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all',
                  selected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/15'
                    : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50',
                )}
              >
                <ProviderTile provider={m.provider} />
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-sm block truncate">{m.label}</span>
                  <span className="text-[11px] text-muted-foreground block truncate">{m.sub}</span>
                </span>
                {/* Selection state — a solid dot mirrors the radio semantics */}
                <span
                  className={cn(
                    'h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                    selected ? 'border-primary bg-primary' : 'border-slate-300 bg-white',
                  )}
                  aria-hidden
                />
              </button>
            )
          })}
        </div>
      </div>

      <CouponRow coupon={coupon} />

      <PriceSummary
        tickets={tickets}
        couponCode={coupon.applied ? coupon.coupon?.code : undefined}
        discount={coupon.discount}
        total={total}
      />

      <div className="flex items-start gap-2 text-xs text-muted-foreground bg-info/5 border border-info/20 rounded-lg p-3">
        <ShieldCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{t('bookingFlow.securePayment')}</p>
          <p>{t('bookingFlow.sslDecreeNote')}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <StepActions>
        <Button variant="outline" onClick={onBack} className="gap-1 max-sm:h-11">
          <ChevronLeft className="h-4 w-4" /> {t('common.back')}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="gap-2 max-sm:h-11 max-sm:flex-1"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> {t('bookingFlow.processing')}
            </>
          ) : (
            <>
              <Lock className="h-4 w-4" /> {t('bookingFlow.payButton', { amount: money(total) })}
            </>
          )}
        </Button>
      </StepActions>
    </div>
  )
}

/**
 * The coupon the customer holds: a switch when it fits this trip (on by
 * default), else one line saying why it does not apply here.
 */
function CouponRow({ coupon: c }: { coupon: CheckoutCoupon }) {
  const t = useT()
  const money = useMoney()
  const coupon = c.coupon
  if (!coupon) return null

  if (!c.usable) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3.5 py-3 text-sm text-muted-foreground">
        <TicketPercent className="size-4 shrink-0" aria-hidden />
        {coupon.status === 'reserved' && coupon.bookingCode
          ? t('campaigns.couponOnOtherBooking', { code: coupon.bookingCode })
          : t('campaigns.notForThisOperator')}
      </p>
    )
  }

  // The whole row is the switch: one big target, one state for screen readers.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={c.applied}
      onClick={() => c.setApplied(!c.applied)}
      className={cn(
        'flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition-colors',
        c.applied ? 'border-rose-300 bg-rose-50/70' : 'border-slate-200 hover:bg-slate-50',
      )}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-linear-to-br from-rose-500 to-orange-400 text-white">
        <TicketPercent className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {t('campaigns.useCoupon', { code: coupon.code })}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">
          {coupon.campaignName} · {validityText(coupon.validUntil, t)}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-sm font-bold tabular-nums',
          c.applied ? 'text-rose-600' : 'text-muted-foreground line-through',
        )}
      >
        -{money(c.worth)}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors',
          c.applied ? 'bg-rose-600' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'size-4 rounded-full bg-white shadow-sm transition-transform',
            c.applied && 'translate-x-4',
          )}
        />
      </span>
    </button>
  )
}
