'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Lock,
  ShieldCheck,
  Smartphone,
  QrCode,
  Landmark,
  Banknote,
  Tag,
  X,
} from 'lucide-react'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { PriceSummary } from './price-summary'
import { PaymentTrustBadges } from '@/components/seo/trust-signals'
import type { PromoCode } from './use-promo-code'

export type PaymentMethodKey = 'momo' | 'vnpay' | 'bank' | 'cod'

type PaymentOption = {
  key: PaymentMethodKey
  label: string
  sub: string
  icon: React.ReactNode
  /** Tailwind classes for the icon tile — brand-adjacent hues. */
  tile: string
}

const getPaymentOptions = (t: ReturnType<typeof useT>): PaymentOption[] => [
  {
    key: 'momo',
    label: t('payment.momo'),
    sub: t('payment.momoDesc'),
    icon: <Smartphone className="h-5 w-5" />,
    tile: 'bg-fuchsia-100 text-fuchsia-600 ring-fuchsia-200',
  },
  {
    key: 'vnpay',
    label: t('payment.vnpay'),
    sub: t('payment.vnpayDesc'),
    icon: <QrCode className="h-5 w-5" />,
    tile: 'bg-blue-100 text-blue-600 ring-blue-200',
  },
  {
    key: 'bank',
    label: t('payment.vietqr'),
    sub: t('payment.vietqrDesc'),
    icon: <Landmark className="h-5 w-5" />,
    tile: 'bg-indigo-100 text-indigo-600 ring-indigo-200',
  },
  {
    key: 'cod',
    label: t('bookingFlow.payCod'),
    sub: t('bookingFlow.cash'),
    icon: <Banknote className="h-5 w-5" />,
    tile: 'bg-emerald-100 text-emerald-600 ring-emerald-200',
  },
]

/**
 * Step 3, checkout: how to pay, the promo code (next to the price it discounts),
 * the price breakdown and the pay button. Methods use solid icon tiles rather
 * than emoji, which render differently on every platform.
 */
export function PaymentMethodStep({
  method,
  onMethodChange,
  promo,
  seatCount,
  subtotal,
  total,
  error,
  submitting,
  onBack,
  onSubmit,
}: {
  method: PaymentMethodKey
  onMethodChange: (method: PaymentMethodKey) => void
  promo: PromoCode
  seatCount: number
  subtotal: number
  total: number
  error: string
  submitting: boolean
  onBack: () => void
  onSubmit: () => void
}) {
  const t = useT()
  const money = useMoney()
  const paymentOptions = getPaymentOptions(t)
  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-sm mb-3">{t('payment.method')}</h3>
        <div
          role="radiogroup"
          aria-label={t('payment.method')}
          className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
        >
          {paymentOptions.map((m) => {
            const selected = method === m.key
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onMethodChange(m.key)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all',
                  selected
                    ? 'border-primary bg-primary/5 ring-2 ring-primary/15'
                    : 'border-slate-200 hover:border-primary/40 hover:bg-slate-50',
                )}
              >
                <span
                  className={cn(
                    'h-10 w-10 shrink-0 rounded-lg ring-1 flex items-center justify-center',
                    m.tile,
                  )}
                >
                  {m.icon}
                </span>
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

      <div className="rounded-lg border bg-amber-50/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-4 w-4 text-amber-600" />
          <span className="font-medium text-sm">{t('bookingFlow.promoCode')}</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={promo.code}
            onChange={(e) => promo.setCode(e.target.value)}
            placeholder={t('bookingFlow.promoCodePh')}
            className="bg-white"
            aria-label={t('bookingFlow.promoCode')}
          />
          <Button
            variant="outline"
            onClick={promo.apply}
            disabled={promo.checking || !promo.code.trim()}
          >
            {promo.checking ? <Loader2 className="h-4 w-4 animate-spin" /> : t('bookingFlow.apply')}
          </Button>
        </div>
        {promo.result?.valid && promo.discount > 0 && (
          <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <div>
                <div className="font-medium text-blue-800">
                  {t('bookingFlow.promoApplied', { code: promo.appliedCode ?? '' })}
                </div>
                <div className="text-xs text-blue-600">{t('bookingFlow.promoAppliedDesc')}</div>
              </div>
            </div>
            <div className="font-bold text-blue-700">-{money(promo.discount)}</div>
          </div>
        )}
        {promo.result?.valid === false && (
          <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
            <X className="h-4 w-4" />
            {t('bookingFlow.promoInvalid')}
          </div>
        )}
      </div>

      <PriceSummary
        seatCount={seatCount}
        subtotal={subtotal}
        promoCode={promo.appliedCode}
        discount={promo.discount}
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

      <PaymentTrustBadges className="mb-1" />

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onBack} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t('common.back')}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={submitting}
          className="gap-2 bg-primary hover:bg-primary/90"
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
      </div>
    </div>
  )
}
