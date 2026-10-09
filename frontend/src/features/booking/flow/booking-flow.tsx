'use client'

import { useState } from 'react'
import { Form } from '@/components/ui/form'
import { useTripDetail } from '@/features/trips/api'
import { useT } from '@/lib/i18n'
import { useBookingFlow } from '@/stores/booking-flow'
import { useSearchForm } from '@/stores/search-form'
import { BookingContactStep } from './booking-contact-step'
import { BookingPassengerStep } from './booking-passenger-step'
import { BookingStepHeader } from './booking-step-header'
import { BookingSuccess } from './booking-success'
import { PaymentMethodStep, type PaymentMethodKey } from './payment-method'
import { PaymentProcessingStep } from './payment-processing-step'
import { useBookingForm } from './use-booking-form'
import { useCheckout } from './use-checkout'
import { usePromoCode } from './use-promo-code'

const NO_SEATS: string[] = []

/**
 * The checkout wizard shown inside the trip dialog while a booking is under
 * way: passengers → contact → payment → (online payment) → success. It draws
 * no dialog chrome of its own.
 */
export function BookingFlow() {
  const t = useT()
  const step = useBookingFlow((s) => s.step)
  const setStep = useBookingFlow((s) => s.setStep)
  const context = useBookingFlow((s) => s.context)
  const setContext = useBookingFlow((s) => s.setContext)
  const lastBooking = useBookingFlow((s) => s.lastBooking)
  const adults = useSearchForm((s) => s.searchParams.adults)
  const children = useSearchForm((s) => s.searchParams.children)
  const [method, setMethod] = useState<PaymentMethodKey>('momo')

  const { data: trip } = useTripDetail(context?.tripId)
  const booking = useBookingForm({
    trip,
    seatIds: context?.seatIds ?? NO_SEATS,
    adults,
    children,
  })
  const promo = usePromoCode(booking.subtotal)
  const total = Math.max(0, booking.subtotal - promo.discount)
  const checkout = useCheckout({
    form: booking.form,
    context,
    method,
    promoCode: promo.appliedCode,
  })

  // Each step validates only its own fields before moving on.
  const toContact = async () => {
    if (!(await booking.form.trigger('passengers'))) {
      return checkout.setError(t('bookingFlow.checkPassengerInfo'))
    }
    if (booking.duplicateSeats) return checkout.setError(t('bookingFlow.duplicateSeatsError'))
    checkout.setError('')
    setStep('contact')
  }
  const toPayment = async () => {
    if (!(await booking.form.trigger(['contactName', 'contactPhone', 'contactEmail']))) return
    checkout.setError('')
    setStep('payment')
  }
  const close = () => {
    setStep('idle')
    setContext(null)
    booking.reset()
    checkout.reset()
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <BookingStepHeader step={step} trip={trip} seats={booking.seats} />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <Form {...booking.form}>
          {step === 'passengers' && (
            <BookingPassengerStep booking={booking} error={checkout.error} onContinue={toContact} />
          )}

          {step === 'contact' && (
            <BookingContactStep
              form={booking.form}
              error={checkout.error}
              onBack={() => setStep('passengers')}
              onContinue={toPayment}
            />
          )}

          {step === 'payment' && (
            <PaymentMethodStep
              method={method}
              onMethodChange={setMethod}
              promo={promo}
              tickets={booking.tickets}
              total={total}
              error={checkout.error}
              submitting={checkout.submitting}
              onBack={() => setStep('contact')}
              onSubmit={booking.form.handleSubmit((values) =>
                booking.duplicateSeats
                  ? checkout.setError(t('bookingFlow.duplicateSeatsError'))
                  : checkout.submit(values),
              )}
            />
          )}

          {step === 'pay' &&
            (checkout.payment && checkout.hold ? (
              <PaymentProcessingStep
                payment={checkout.payment}
                bookingCode={checkout.hold.code}
                cancelling={checkout.cancelling}
                onCancelPayment={checkout.cancelPayment}
                onRetry={checkout.retryPayment}
                onBackToMethods={() => setStep('payment')}
              />
            ) : (
              <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {t('bookingFlow.preparingPayment')}
              </div>
            ))}
        </Form>

        {step === 'success' && lastBooking && (
          <BookingSuccess trip={trip} booking={lastBooking} seats={booking.seats} onClose={close} />
        )}
      </div>
    </div>
  )
}
