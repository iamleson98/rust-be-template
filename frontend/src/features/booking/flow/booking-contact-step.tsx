'use client'

/**
 * BookingContactStep — step 2 (contact + campaign) of the BookingDialog:
 * the privacy trust signal, the contact-info form section (name / phone /
 * email), the travel-insurance picker, the campaign (promo code) box and
 * the back / continue CTAs.
 *
 * Extracted from the original `booking-dialog.tsx` — the parent owns the
 * RHF form (`form` is passed down), the campaign state and the store
 * setters for the insurance level.
 */

import type { UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  FormField,
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { PrivacyNotice } from '@/components/seo/trust-signals'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import { useT } from '@/lib/i18n'
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Tag, X, User, Phone, Mail, Shield, ShieldCheck, ShieldAlert } from 'lucide-react'
import { type BookingValues } from './booking-form'
import type { CampaignValidateResponse } from '@/lib/api/types.gen'

export function BookingContactStep({
  form,
  setBookingStep,
  insuranceLevel,
  setInsuranceLevel,
  currency,
  campaignCode,
  setCampaignCode,
  setCampaignResult,
  checkingCampaign,
  checkCampaign,
  campaignResult,
  discount,
  error,
  gotoPayment,
}: {
  form: UseFormReturn<BookingValues>
  setBookingStep: (step: 'idle' | 'passengers' | 'contact' | 'payment' | 'success') => void
  insuranceLevel: 'none' | 'basic' | 'comprehensive'
  setInsuranceLevel: (level: 'none' | 'basic' | 'comprehensive') => void
  currency: Currency
  campaignCode: string
  setCampaignCode: (code: string) => void
  setCampaignResult: (result: CampaignValidateResponse | null) => void
  checkingCampaign: boolean
  checkCampaign: () => void
  campaignResult: CampaignValidateResponse | null
  discount: number
  error: string
  gotoPayment: () => void
}) {
  const t = useT()
  return (
    <div className="p-5 space-y-5">
      {/* Privacy trust signal — affirms data protection */}
      <PrivacyNotice />

      <div>
        <h3 className="font-semibold text-sm mb-3">{t('booking.contactInfo')}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="contactName"
            render={({ field }) => (
              <FormItem className="space-y-1.5 sm:col-span-2">
                <FormLabel>
                  {t('bookingFlow.contactPersonName')}{' '}
                  <span className="text-destructive" aria-hidden="true">*</span>
                </FormLabel>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <FormControl>
                    <Input {...field} placeholder={t('bookingFlow.contactNamePh')} className="pl-8" />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactPhone"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>
                  {t('booking.contactPhone')}{' '}
                  <span className="text-destructive" aria-hidden="true">*</span>
                </FormLabel>
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="09xx xxx xxx"
                      className="pl-8"
                      inputMode="tel"
                      autoComplete="tel"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactEmail"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>{t('bookingFlow.contactEmailOptional')}</FormLabel>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      placeholder="email@example.com"
                      className="pl-8"
                      autoComplete="email"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {/* Travel Insurance */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="h-4 w-4 text-blue-600" />
          <span className="font-semibold text-sm">{t('bookingFlow.insuranceTitle')}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            {
              key: 'none' as const,
              label: t('bookingFlow.insuranceNone'),
              cost: 0,
              desc: t('bookingFlow.insuranceNoneDesc'),
              icon: <Shield className="h-5 w-5" />,
            },
            {
              key: 'basic' as const,
              label: t('bookingFlow.insuranceBasic'),
              cost: 5000,
              desc: t('bookingFlow.insuranceBasicDesc'),
              icon: <ShieldCheck className="h-5 w-5" />,
            },
            {
              key: 'comprehensive' as const,
              label: t('bookingFlow.insuranceComprehensive'),
              cost: 15000,
              desc: t('bookingFlow.insuranceComprehensiveDesc'),
              icon: <ShieldAlert className="h-5 w-5" />,
            },
          ]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setInsuranceLevel(opt.key)}
              className={`rounded-lg border p-3 text-left transition-all ${insuranceLevel === opt.key
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100'
                  : 'border-slate-200 hover:border-blue-300 bg-white'
                }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={insuranceLevel === opt.key ? 'text-blue-600' : 'text-slate-400'}>{opt.icon}</span>
                <span className="font-medium text-xs">{opt.label}</span>
              </div>
              <div className="text-[11px] text-muted-foreground">{opt.desc}</div>
              <div className="mt-1.5 font-bold text-sm text-blue-700">{opt.cost === 0 ? formatCurrency(0, currency) : `${formatCurrency(opt.cost, currency)}${t('bookingFlow.perTrip')}`}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Campaign */}
      <div className="rounded-lg border bg-amber-50/50 p-3">
        <div className="flex items-center gap-2 mb-2">
          <Tag className="h-4 w-4 text-amber-600" />
          <span className="font-medium text-sm">{t('bookingFlow.promoCode')}</span>
        </div>
        <div className="flex gap-2">
          <Input
            value={campaignCode}
            onChange={(e) => { setCampaignCode(e.target.value); setCampaignResult(null) }}
            placeholder={t('bookingFlow.promoCodePh')}
            className="bg-white"
          />
          <Button variant="outline" onClick={checkCampaign} disabled={checkingCampaign || !campaignCode.trim()}>
            {checkingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : t('bookingFlow.apply')}
          </Button>
        </div>
        {campaignResult?.valid && discount > 0 && (
          <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <div>
                <div className="font-medium text-blue-800">{t('bookingFlow.promoApplied', { code: campaignCode.trim().toUpperCase() })}</div>
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

      {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setBookingStep('passengers')} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t('common.back')}
        </Button>
        <Button onClick={gotoPayment} className="gap-1">
          {t('bookingFlow.continue')} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
