'use client'

/**
 * BookingContactStep — step 2 (contact info) of the booking flow:
 * the privacy trust signal and the contact-info form (name / phone /
 * email) plus the back / continue CTAs.
 *
 * The campaign (promo code) box moved to the CHECKOUT step
 * (PaymentMethodStep) — a coupon belongs next to the price it
 * discounts, not on the contact form.
 *
 * Extracted from the original `booking-dialog.tsx` — the parent owns the
 * RHF form (`form` is passed down).
 */

import type { UseFormReturn } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormField, FormControl, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { PrivacyNotice } from '@/components/seo/trust-signals'
import { useT } from '@/lib/i18n'
import { ChevronLeft, ChevronRight, User, Phone, Mail } from 'lucide-react'
import { type BookingValues } from './booking-form'

export function BookingContactStep({
  form,
  setBookingStep,
  error,
  gotoPayment,
}: {
  form: UseFormReturn<BookingValues>
  setBookingStep: (step: 'idle' | 'passengers' | 'contact' | 'payment' | 'pay' | 'success') => void
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
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
          <FormField
            control={form.control}
            name="contactName"
            render={({ field }) => (
              <FormItem className="space-y-1.5 sm:col-span-2">
                <FormLabel>
                  {t('bookingFlow.contactPersonName')}{' '}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </FormLabel>
                <div className="relative">
                  <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t('bookingFlow.contactNamePh')}
                      className="pl-8"
                    />
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
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
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

      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setBookingStep('passengers')} className="gap-1">
          <ChevronLeft className="h-4 w-4" /> {t('common.back')}
        </Button>
        <Button onClick={gotoPayment} className="gap-1 bg-primary hover:bg-primary/90">
          {t('bookingFlow.continue')} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
