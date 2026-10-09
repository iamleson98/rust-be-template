'use client'

/**
 * PaymentMethodStep — the checkout step (step 3) of the booking flow:
 * the payment-method picker (MoMo / VNPay / bank transfer / cash-on-bus),
 * the coupon (promo code) box — coupons belong HERE, at checkout, not on
 * the contact step — the price summary, the SSL trust note and the
 * submit button.
 *
 * The method picker uses brand-colored icon tiles instead of emoji —
 * emoji render differently on every platform and read as cheap; solid
 * color chips with lucide icons keep the step visually consistent with
 * the rest of the redesigned funnel.
 *
 * The parent owns the form (`onSubmit` is `form.handleSubmit(...)`) and
 * the campaign state (code / result / validate callback) so this
 * component stays purely presentational.
 */

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
import { formatCurrency } from '@/lib/format'
import type { Currency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import type { CampaignValidateResponse } from '@/api'
import { PriceSummary } from './price-summary'
import { PaymentTrustBadges } from '@/components/seo/trust-signals'

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

export function PaymentMethodStep({
  paymentMethod,
  onSetPaymentMethod,
  seatCount,
  subtotal,
  campaignCode,
  setCampaignCode,
  setCampaignResult,
  checkingCampaign,
  checkCampaign,
  campaignResult,
  discount,
  fees,
  total,
  currency,
  error,
  submitting,
  onGoBack,
  onSubmit,
}: {
  paymentMethod: PaymentMethodKey
  onSetPaymentMethod: (m: PaymentMethodKey) => void
  seatCount: number
  subtotal: number
  /** Campaign (promo code) state — owned by the parent BookingFlow. */
  campaignCode: string
  setCampaignCode: (code: string) => void
  setCampaignResult: (result: CampaignValidateResponse | null) => void
  checkingCampaign: boolean
  checkCampaign: () => void
  campaignResult: CampaignValidateResponse | null
  discount: number
  fees: number
  total: number
  currency: Currency
  error: string
  submitting: boolean
  onGoBack: () => void
  onSubmit: () => void
}) {
  const t = useT()
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
            const selected = paymentMethod === m.key
            return (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onSetPaymentMethod(m.key)}
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

      {/* Coupon (promo code) — checkout is where it belongs: right
          next to the price it discounts. */}
      <div className="rounded-lg border bg-amber-50/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-4 w-4 text-amber-600" />
          <span className="font-medium text-sm">{t('bookingFlow.promoCode')}</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={campaignCode}
            onChange={(e) => {
              setCampaignCode(e.target.value)
              setCampaignResult(null)
            }}
            placeholder={t('bookingFlow.promoCodePh')}
            className="bg-white"
            aria-label={t('bookingFlow.promoCode')}
          />
          <Button
            variant="outline"
            onClick={checkCampaign}
            disabled={checkingCampaign || !campaignCode.trim()}
          >
            {checkingCampaign ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('bookingFlow.apply')
            )}
          </Button>
        </div>
        {campaignResult?.valid && discount > 0 && (
          <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <div>
                <div className="font-medium text-blue-800">
                  {t('bookingFlow.promoApplied', { code: campaignCode.trim().toUpperCase() })}
                </div>
                <div className="text-xs text-blue-600">{t('bookingFlow.promoAppliedDesc')}</div>
              </div>
            </div>
            <div className="font-bold text-blue-700">-{formatCurrency(discount, currency)}</div>
          </div>
        )}
        {campaignResult?.valid === false && (
          <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
            <X className="h-4 w-4" />
            {t('bookingFlow.promoInvalid')}
          </div>
        )}
      </div>

      <PriceSummary
        seatCount={seatCount}
        subtotal={subtotal}
        campaignCode={campaignCode}
        discount={discount}
        fees={fees}
        total={total}
        currency={currency}
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

      {/* Payment trust badges — SSL + PCI DSS + refund guarantee */}
      <PaymentTrustBadges className="mb-1" />

      <div className="flex justify-between gap-3">
        <Button variant="outline" onClick={onGoBack} className="gap-1">
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
              <Lock className="h-4 w-4" />{' '}
              {t('bookingFlow.payButton', { amount: formatCurrency(total, currency) })}
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
