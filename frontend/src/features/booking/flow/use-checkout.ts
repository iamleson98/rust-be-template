import { useEffect, useEffectEvent, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseFormReturn } from 'react-hook-form'
import { toast } from 'sonner'
import {
  bookingsConfirmMutation,
  bookingsHoldMutation,
  cancelPaymentMutation,
  createPaymentMutation,
  type BookingHoldResponse,
} from '@/api'
import { invalidateResources } from '@/api/query-client'
import { trackConversion } from '@/lib/analytics'
import { getErrorMessage } from '@/lib/error-message'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'
import type { PaymentProvider } from '@/lib/payment'
import { normalizePhone } from '@/lib/text'
import { useBookingFlow, type BookingContext } from '@/stores/booking-flow'
import { useGuest } from '@/stores/guest'
import { usePayment } from '../api'
import type { BookingValues } from './booking-form'
import type { PaymentMethodKey } from './payment-method'

/** Online methods and the provider the payment API expects for each. */
const PROVIDER: Partial<Record<PaymentMethodKey, PaymentProvider>> = {
  momo: 'momo',
  vnpay: 'vnpay',
  bank: 'vietqr',
}

/** API error kinds the customer can act on, and what to tell them. */
const KNOWN_FAILURES: Record<string, string> = {
  conflict: 'bookingFlow.seatsTaken',
  gone: 'bookingFlow.holdExpired',
  unauthorized: 'bookingFlow.signInAgain',
}

/**
 * Runs `work`; a failure becomes an Error whose message is what the customer should
 * read, in their language: a known cause when the API names one, else `fallback`.
 */
async function orFail<T>(work: Promise<T>, fallback: string, t: (key: string) => string) {
  try {
    return await work
  } catch (error) {
    const kind = (error as { error?: unknown } | null)?.error
    const known = typeof kind === 'string' ? KNOWN_FAILURES[kind] : undefined
    throw new Error(known ? t(known) : fallback)
  }
}

type Options = {
  form: UseFormReturn<BookingValues>
  context: BookingContext | null
  method: PaymentMethodKey
  /** A promo code the server already accepted. */
  promoCode: string | undefined
}

/**
 * Turns the filled-in form into a booking. The seats are held first, then
 *  - cash on the bus: the booking is confirmed at once;
 *  - online: a payment is created and polled. The booking stays pending until the
 *    provider's webhook confirms it (confirming up front would block later attempts).
 */
export function useCheckout({ form, context, method, promoCode }: Options) {
  const t = useT()
  const money = useMoney()
  const queryClient = useQueryClient()
  const step = useBookingFlow((s) => s.step)
  const setStep = useBookingFlow((s) => s.setStep)
  const setLastBooking = useBookingFlow((s) => s.setLastBooking)
  const setGuestName = useGuest((s) => s.setGuestName)
  const setGuestPhone = useGuest((s) => s.setGuestPhone)

  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [hold, setHold] = useState<BookingHoldResponse | null>(null)
  const [paymentId, setPaymentId] = useState<string | null>(null)

  const holdSeats = useMutation(bookingsHoldMutation())
  const confirm = useMutation(bookingsConfirmMutation())
  const createPayment = useMutation(createPaymentMutation())
  const cancelPayment = useMutation(cancelPaymentMutation())
  const payment = usePayment(paymentId ?? undefined, step === 'pay').data

  /** The booking is final: remember the customer, report the conversion, refresh what it changed. */
  const complete = (held: BookingHoldResponse) => {
    if (useBookingFlow.getState().step === 'success') return
    const { contactName, contactPhone } = form.getValues()
    setLastBooking({ id: held.bookingId, code: held.code, total: held.total })
    setGuestPhone(normalizePhone(contactPhone))
    if (contactName) setGuestName(contactName)
    setStep('success')
    trackConversion('booking', { value: held.total, currency: 'VND', transactionId: held.code })
    toast.success(t('booking.success'), {
      description: t('bookingFlow.successToastDesc', { code: held.code, total: money(held.total) }),
      duration: 5000,
    })
    // The booked seats must show as taken, and points and booking lists are stale.
    void invalidateResources(queryClient, 'bookings', 'trips', 'loyalty')
    toast.success(t('bookingFlow.loyaltyEarned'), {
      description: t('bookingFlow.loyaltyEarnedDesc'),
      duration: 4000,
    })
  }

  const startPayment = async (held: BookingHoldResponse) => {
    const { payment: created } = await orFail(
      createPayment.mutateAsync({
        body: { bookingId: held.bookingId, provider: PROVIDER[method] ?? 'vnpay' },
      }),
      t('payment.createFailed'),
      t,
    )
    if (!created?.id) throw new Error(t('payment.createFailed'))
    setPaymentId(created.id)
    setStep('pay')
  }

  const submit = async (values: BookingValues) => {
    if (!context) return
    setError('')
    setSubmitting(true)
    try {
      const held = await orFail(
        holdSeats.mutateAsync({
          body: {
            tripId: context.tripId,
            seatIds: context.seatIds,
            // The server prices each seat by its class and the passenger's age.
            passengers: values.passengers.map((p) => ({
              name: p.name,
              age: p.age,
              seatId: p.seatId,
            })),
            boardingPointId: context.boardingPointId,
            droppingPointId: context.droppingPointId,
            contactName: values.contactName,
            contactPhone: normalizePhone(values.contactPhone),
            contactEmail: values.contactEmail || undefined,
            campaignCode: promoCode,
          },
        }),
        t('bookingFlow.holdFailed'),
        t,
      )
      if (!held.bookingId) throw new Error(t('bookingFlow.holdFailed'))
      setHold(held)
      if (method === 'cod') {
        await orFail(
          confirm.mutateAsync({ path: { id: held.bookingId }, body: { paymentMethod: 'cod' } }),
          t('payment.failed'),
          t,
        )
        complete(held)
      } else {
        await startPayment(held)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  /** A fresh payment for the still-pending booking, e.g. after a failed attempt. */
  const retryPayment = async () => {
    if (!hold) return
    setSubmitting(true)
    try {
      await startPayment(hold)
      setError('')
    } catch (e) {
      setError((e as Error).message)
      setStep('payment')
    } finally {
      setSubmitting(false)
    }
  }

  /** Drops the pending payment and returns to the method picker. */
  const cancel = () => {
    if (!paymentId) return
    cancelPayment.mutate(
      { path: { id: paymentId }, body: {} },
      {
        onSuccess: () => {
          toast.success(t('bookingFlow.paymentCancelled'))
          setPaymentId(null)
          setStep('payment')
        },
        onError: (e) =>
          toast.error(t('bookingFlow.cancelFailed'), { description: getErrorMessage(e) }),
      },
    )
  }

  // The provider's webhook confirms the booking; the poll sees the payment complete.
  const onPaid = useEffectEvent((paid: NonNullable<typeof payment>, held: BookingHoldResponse) => {
    trackConversion('purchase', {
      value: paid.amount,
      currency: paid.currency,
      transactionId: held.code,
    })
    complete(held)
  })
  useEffect(() => {
    if (step === 'pay' && payment?.status === 'completed' && hold) onPaid(payment, hold)
  }, [step, payment, hold])

  return {
    error,
    setError,
    submitting,
    hold,
    payment,
    submit,
    retryPayment,
    cancelPayment: cancel,
    cancelling: cancelPayment.isPending,
    reset: () => {
      setError('')
      setHold(null)
      setPaymentId(null)
    },
  }
}
