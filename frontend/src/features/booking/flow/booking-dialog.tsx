'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useForm, useFieldArray, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { trackConversion } from '@/lib/analytics'
import {
  useTripDetail,
  useValidateCampaign,
  useHoldBooking,
  useConfirmBooking,
} from '@/lib/queries'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { normalizePhone } from '@/lib/types'
import type { CampaignValidateResponse } from '@/lib/api/types.gen'
import { formatCurrency } from '@/lib/currency'
import { toast } from 'sonner'
import {
  type TripDetail,
  type BookingValues,
  type PassengerFormValue,
  type SelectedSeat,
  bookingSchema,
  getPassengerType,
} from './booking-form'
import { PaymentMethodStep, type PaymentMethodKey } from './payment-method'
import { BookingSuccess, type LastBooking } from './booking-success'
import { BookingStepHeader } from './booking-step-header'
import { BookingPassengerStep } from './booking-passenger-step'
import { BookingContactStep } from './booking-contact-step'

/**
 * Structural type for the hold-booking result this dialog consumes.
 * The generated SDK models this as a union (HoldResponses); the dialog
 * only needs the success shape's fields.
 */
type HoldBookingData = {
  bookingId: string
  code: string
  total: number
}

export function BookingDialog() {
  const t = useT()
  const qc = useQueryClient()
  const {
    bookingStep,
    setBookingStep,
    bookingContext,
    setBookingContext,
    searchParams,
    lastBooking,
    setLastBooking,
    setGuestPhone,
    setGuestName,
    currency,
  } = useApp()

  // Fetch trip detail via the centralized TanStack Query hook — the
  // BookingContext carries the tripId the user picked in TripDetailDialog.
  // We use `as unknown as TripDetail` because the centralized type in
  // `@/lib/queries/types` is out of sync with the actual backend response
  // (missing `seatMap.decks` wrapper, `pricing.basePriceAdult`, etc.).
  const { data: rawTripDetail } = useTripDetail(bookingContext?.tripId)
  const trip = rawTripDetail as unknown as TripDetail | null | undefined

  const [campaignCode, setCampaignCode] = useState('')
  const [campaignResult, setCampaignResult] = useState<CampaignValidateResponse | null>(null)
  const [checkingCampaign, setCheckingCampaign] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodKey>('momo')

  const { guestName } = useApp()

  const open = bookingStep !== 'idle'

  // ── RHF form (passengers + contact) ─────────────────────
  const form = useForm<BookingValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      passengers: [],
      contactName: '',
      contactPhone: '',
      contactEmail: '',
    },
    mode: 'onBlur',
    reValidateMode: 'onChange',
  })

  const {
    fields: passengerFields,
    append,
    remove,
    update,
    replace,
  } = useFieldArray({ control: form.control, name: 'passengers' })

  // Seats picked in the trip dialog — DERIVED (not state): it resets by
  // itself when bookingContext/trip change, so no setState-in-effect and
  // no manual clearing in close().
  const selectedSeatCodes: SelectedSeat[] = useMemo(() => {
    if (!bookingContext || !trip) return []
    return trip.seatMap.decks
      .flatMap((dk) => dk.rows.flatMap((r) => r.seats))
      .filter((s) => bookingContext.seatIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        code: s.code,
        price: s.finalPrice,
        class: s.seatClass ?? 'standard',
      }))
  }, [bookingContext, trip])

  // `useWatch` gives us the latest passenger values for derived UI state
  // (counts, unassigned, duplicate-seats) — `passengerFields` alone is
  // structural and can lag behind value edits. NOTE: useWatch (not
  // form.watch) — in RHF 7.89 form.watch('passengers') does NOT
  // re-render on nested passengers.N.name edits, which left the
  // "Tiếp tục" gate stuck on stale values.
  const watchedPassengers = useWatch({ control: form.control, name: 'passengers' }) ?? []
  const passengers: PassengerFormValue[] = watchedPassengers as PassengerFormValue[]

  // When trip detail arrives (or booking context changes), map the
  // selected seat ids to seat codes/prices and initialise the passenger
  // form. Replaces the old manual `fetch + setTrip + setSeats` effect.
  useEffect(() => {
    if (!bookingContext || !trip) return
    // map seat ids to codes/prices
    const seats: SelectedSeat[] = trip.seatMap.decks
      .flatMap((dk) => dk.rows.flatMap((r) => r.seats))
      .filter((s) => bookingContext.seatIds.includes(s.id))
      .map((s) => ({
        id: s.id,
        code: s.code,
        price: s.finalPrice,
        class: s.seatClass ?? 'standard',
      }))

    // init passengers — auto-assign seats sequentially
    const initPassengers: PassengerFormValue[] = []
    let seatIdx = 0
    for (let i = 0; i < searchParams.adults; i++) {
      initPassengers.push({
        name: '',
        age: 30,
        gender: 'male',
        seatId: seats[seatIdx]?.id ?? '',
      })
      seatIdx++
    }
    for (let i = 0; i < searchParams.children; i++) {
      initPassengers.push({
        name: '',
        age: 5,
        gender: 'male',
        seatId: seats[seatIdx]?.id ?? '',
      })
      seatIdx++
    }
    form.reset({
      passengers: initPassengers,
      contactName: '',
      contactPhone: '',
      contactEmail: '',
    })
  }, [bookingContext, trip, form, searchParams.adults, searchParams.children])

  // Passenger helpers — index-based now (RHF field array)
  const addPassenger = useCallback(() => {
    if (passengerFields.length >= selectedSeatCodes.length) return
    append({ name: '', age: 30, gender: 'male', seatId: '' })
  }, [passengerFields.length, selectedSeatCodes.length, append])

  const removePassenger = useCallback(
    (index: number) => {
      if (passengerFields.length <= 1) return
      remove(index)
    },
    [passengerFields.length, remove],
  )

  const autoAssignSeats = useCallback(() => {
    const assigned = new Set(passengerFields.map((p) => p.seatId).filter(Boolean))
    const free = selectedSeatCodes.filter((s) => !assigned.has(s.id))
    let idx = 0
    const next = passengerFields.map((p) => {
      if (!p.seatId && idx < free.length) {
        const seat = free[idx++]
        return { ...(p as PassengerFormValue), seatId: seat.id }
      }
      return p as PassengerFormValue
    })
    replace(next)
    toast.success(t('booking.autoAssignSuccess'))
  }, [passengerFields, selectedSeatCodes, replace, t])

  const copyContactToFirst = useCallback(() => {
    const contactName = form.getValues('contactName')
    const source = contactName || guestName
    if (!source) {
      toast.error(t('booking.missingContact'), {
        description: t('bookingFlow.missingContactNameDesc'),
      })
      return
    }
    const idx = passengerFields.findIndex((p) => !p.name.trim())
    const targetIdx = idx >= 0 ? idx : 0
    if (passengerFields[targetIdx]) {
      update(targetIdx, {
        ...(passengerFields[targetIdx] as PassengerFormValue),
        name: source,
      })
    }
    toast.success(t('bookingFlow.copiedContactName'))
  }, [passengerFields, form, guestName, update, t])

  // Derived: unassigned passengers + duplicate seat check
  const unassignedCount = useMemo(() => passengers.filter((p) => !p.seatId).length, [passengers])
  const hasDuplicateSeats = useMemo(() => {
    const ids = passengers.map((p) => p.seatId).filter(Boolean)
    return new Set(ids).size !== ids.length
  }, [passengers])

  const allNamesFilled = useMemo(
    () => passengers.length > 0 && passengers.every((p) => p.name.trim()),
    [passengers],
  )

  const canContinueStep1 =
    allNamesFilled && unassignedCount === 0 && !hasDuplicateSeats && passengers.length > 0

  // No insurance add-on: the backend `HoldReq` has no insurance field —
  // a client-side-only fee would make the displayed total diverge from
  // the real booking total returned by the server.

  const subtotal = selectedSeatCodes.reduce((s, x) => s + x.price, 0)
  const discount = campaignResult?.valid ? (campaignResult.discount ?? 0) : 0
  const fees = 0
  const total = Math.max(0, subtotal - discount + fees)

  const validateCampaignMut = useValidateCampaign<CampaignValidateResponse>({
    onSuccess: (data) => {
      setCampaignResult(data)
      if (data?.valid) {
        toast.success(t('bookingFlow.promoValid'), {
          description: t('bookingFlow.discountAmount', {
            amount: formatCurrency(data.discount ?? 0, currency),
          }),
          duration: 3000,
        })
      } else {
        toast.error(t('bookingFlow.promoInvalidTitle'), {
          description: t('bookingFlow.promoInvalidDesc'),
          duration: 3000,
        })
      }
    },
    onError: () => {
      setCampaignResult({ valid: false, discount: 0 })
    },
    onSettled: () => {
      setCheckingCampaign(false)
    },
  })

  const checkCampaign = () => {
    if (!campaignCode.trim() || !trip) return
    setCheckingCampaign(true)
    setCampaignResult(null)
    validateCampaignMut.mutate({ code: campaignCode.trim(), subtotal })
  }

  // Final submit — called by `form.handleSubmit(onSubmit)` after the
  // entire schema (passengers + contact) has validated.
  //
  // Two-step mutation chain: hold → confirm. Each mutation defines its
  // own onSuccess/onError/onSettled at HOOK CREATION time. The hold's
  // onSuccess kicks off the confirm mutation by calling mutate() with
  // only the variables.
  const confirmMut = useConfirmBooking({
    onSuccess: (_data, vars) => {
      const v = (vars ?? {}) as { path?: { id?: string } }
      const holdData = (holdResultRef.current ?? {}) as HoldBookingData
      const holdBookingId = v.path?.id ?? holdData.bookingId
      setLastBooking({ id: holdBookingId, code: holdData.code, total: holdData.total })
      setGuestPhone(normalizePhone(contactPhoneRef.current))
      if (contactNameRef.current) setGuestName(contactNameRef.current)
      setBookingStep('success')
      // Google Ads conversion — the booking moment (lead). Payment
      // completion fires the 'purchase' conversion separately (see
      // routes/booking-detail.tsx). No-op unless Ads is configured.
      trackConversion('booking', {
        value: holdData.total,
        currency: 'VND',
        transactionId: holdData.code,
      })
      toast.success(t('booking.success'), {
        description: t('bookingFlow.successToastDesc', {
          code: holdData.code,
          total: formatCurrency(holdData.total, currency),
        }),
        duration: 5000,
      })
      // Refresh the real loyalty summary + booking lists — points are
      // earned per COMPLETED trip and are always computed by the
      // backend (1 point / 10,000 VND), never incremented client-side.
      qc.invalidateQueries({ queryKey: ['loyalty'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success(t('bookingFlow.loyaltyEarned'), {
        description: t('bookingFlow.loyaltyEarnedDesc'),
        duration: 4000,
      })
    },
    onError: () => {
      setError(t('payment.failed'))
    },
    onSettled: () => {
      setSubmitting(false)
    },
  })

  // Refs to share hold-time data + form values with confirm's onSuccess
  // without re-creating the mutation hooks each render.
  const holdResultRef = useRef<HoldBookingData | null>(null)
  const contactPhoneRef = useRef('')
  const contactNameRef = useRef('')
  const paymentMethodRef = useRef<string>('cod')

  const holdMut = useHoldBooking({
    onSuccess: (holdResult: unknown) => {
      const holdData =
        ((holdResult ?? {}) as { data?: HoldBookingData }).data ??
        (holdResult as HoldBookingData | undefined)
      if (!holdData?.bookingId) {
        setError(t('bookingFlow.holdFailed'))
        setSubmitting(false)
        return
      }
      holdResultRef.current = holdData
      confirmMut.mutate({
        path: { id: holdData.bookingId },
        body: { paymentMethod: paymentMethodRef.current },
      } as unknown as Parameters<typeof confirmMut.mutate>[0])
    },
    onError: () => {
      setError(t('bookingFlow.holdFailed'))
      setSubmitting(false)
    },
  })

  // Keep paymentMethodRef in sync with state
  useEffect(() => {
    paymentMethodRef.current = paymentMethod
  }, [paymentMethod])

  const onSubmit = (values: BookingValues) => {
    setError('')
    if (!bookingContext || !trip) return
    if (hasDuplicateSeats) {
      setError(t('bookingFlow.duplicateSeatsError'))
      return
    }
    contactPhoneRef.current = normalizePhone(values.contactPhone)
    contactNameRef.current = values.contactName
    setSubmitting(true)
    // SDK mutation hooks require { body: <payload> } — passing the raw
    // payload makes `opts.body === undefined`, which causes the openapi-ts
    // client to delete `Content-Type: application/json` before sending,
    // and axum's `Json<HoldReq>` extractor then returns 415 Unsupported
    // Media Type. This is the customer-facing booking flow — the bug
    // blocked all seat-hold submissions from the search results page.
    holdMut.mutate({
      body: {
        tripId: bookingContext.tripId,
        seatIds: bookingContext.seatIds,
        passengers: values.passengers.map((p) => ({
          name: p.name,
          type: getPassengerType(p.age),
          age: p.age,
        })),
        boardingPointId: bookingContext.boardingPointId,
        droppingPointId: bookingContext.droppingPointId,
        contactName: values.contactName,
        contactPhone: normalizePhone(values.contactPhone),
        contactEmail: values.contactEmail || undefined,
        campaignCode: campaignResult?.valid ? campaignCode.trim().toUpperCase() : undefined,
      },
    } as unknown as Parameters<typeof holdMut.mutate>[0])
  }

  const close = () => {
    setBookingStep('idle')
    setBookingContext(null)
    // Note: `trip` is now derived from useTripDetail(bookingContext?.tripId),
    // so it auto-clears when bookingContext is set to null above (the hook
    // becomes disabled). selectedSeatCodes is likewise derived and resets
    // on its own. No need to manually reset local state.
    form.reset({ passengers: [], contactName: '', contactPhone: '', contactEmail: '' })
    setCampaignCode('')
    setCampaignResult(null)
    setError('')
  }

  // Step transitions use `form.trigger` to validate just the relevant
  // sub-tree before advancing.
  const gotoContact = async () => {
    const valid = await form.trigger('passengers')
    if (!valid) {
      setError(t('bookingFlow.checkPassengerInfo'))
      return
    }
    if (hasDuplicateSeats) {
      setError(t('bookingFlow.duplicateSeatsError'))
      return
    }
    setError('')
    setBookingStep('contact')
  }

  const gotoPayment = async () => {
    const valid = await form.trigger(['contactName', 'contactPhone', 'contactEmail'])
    if (!valid) {
      return
    }
    setError('')
    setBookingStep('payment')
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[92dvh] p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <BookingStepHeader
          bookingStep={bookingStep}
          trip={trip}
          selectedSeatCodes={selectedSeatCodes}
        />

        {/* Body scrolls under the fixed header — no magic header-height
            arithmetic; the flex column + min-h-0 chain sizes it for any
            viewport (and dvh tracks the iOS dynamic toolbar). */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          <Form {...form}>
            {/* Step: passengers */}
            {bookingStep === 'passengers' && (
              <BookingPassengerStep
                form={form}
                passengers={passengers}
                passengerFields={passengerFields}
                selectedSeatCodes={selectedSeatCodes}
                currency={currency}
                guestName={guestName}
                subtotal={subtotal}
                unassignedCount={unassignedCount}
                hasDuplicateSeats={hasDuplicateSeats}
                canContinueStep1={canContinueStep1}
                error={error}
                addPassenger={addPassenger}
                removePassenger={removePassenger}
                autoAssignSeats={autoAssignSeats}
                copyContactToFirst={copyContactToFirst}
                gotoContact={gotoContact}
              />
            )}

            {/* Step: contact + campaign */}
            {bookingStep === 'contact' && (
              <BookingContactStep
                form={form}
                setBookingStep={setBookingStep}
                currency={currency}
                campaignCode={campaignCode}
                setCampaignCode={setCampaignCode}
                setCampaignResult={setCampaignResult}
                checkingCampaign={checkingCampaign}
                checkCampaign={checkCampaign}
                campaignResult={campaignResult}
                discount={discount}
                error={error}
                gotoPayment={gotoPayment}
              />
            )}

            {/* Step: payment */}
            {bookingStep === 'payment' && (
              <PaymentMethodStep
                paymentMethod={paymentMethod}
                onSetPaymentMethod={setPaymentMethod}
                seatCount={selectedSeatCodes.length}
                subtotal={subtotal}
                campaignCode={campaignCode}
                discount={discount}
                fees={fees}
                total={total}
                currency={currency}
                error={error}
                submitting={submitting}
                onGoBack={() => setBookingStep('contact')}
                onSubmit={() => form.handleSubmit(onSubmit)()}
              />
            )}
          </Form>

          {/* Step: success — outside the Form (no inputs) */}
          {bookingStep === 'success' && lastBooking && (
            <BookingSuccess
              trip={trip}
              lastBooking={lastBooking as LastBooking}
              selectedSeats={selectedSeatCodes}
              currency={currency}
              onClose={close}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
