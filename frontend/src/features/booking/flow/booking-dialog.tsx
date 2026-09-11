'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useTripDetail, useValidateCampaign, useHoldBooking, useConfirmBooking } from '@/lib/queries'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Form } from '@/components/ui/form'
import { normalizePhone } from '@/lib/types'
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
import {
  type InsuranceLevel,
} from './price-summary'
import {
  PaymentMethodStep,
  type PaymentMethodKey,
} from './payment-method'
import { BookingSuccess, type LastBooking } from './booking-success'
import { BookingStepHeader } from './booking-step-header'
import { BookingPassengerStep } from './booking-passenger-step'
import { BookingContactStep } from './booking-contact-step'

export function BookingDialog() {
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
    insuranceLevel,
    setInsuranceLevel,
    setLoyaltyPoints,
    currency,
  } = useApp()

  // Fetch trip detail via the centralized TanStack Query hook — the
  // BookingContext carries the tripId the user picked in TripDetailDialog.
  // We use `as unknown as TripDetail` because the centralized type in
  // `@/lib/queries/types` is out of sync with the actual backend response
  // (missing `seatMap.decks` wrapper, `pricing.basePriceAdult`, etc.).
  const { data: rawTripDetail } = useTripDetail(bookingContext?.tripId)
  const trip = rawTripDetail as unknown as TripDetail | null | undefined

  const [selectedSeatCodes, setSelectedSeatCodes] = useState<SelectedSeat[]>([])
  const [campaignCode, setCampaignCode] = useState('')
  const [campaignResult, setCampaignResult] = useState<{ valid: boolean; campaign?: any; error?: string } | null>(null)
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

  // `watch` gives us the latest passenger values for derived UI state
  // (counts, unassigned, duplicate-seats) — `passengerFields` alone is
  // structural and can lag behind value edits.
  const watchedPassengers = form.watch('passengers') ?? []
  const passengers: PassengerFormValue[] = watchedPassengers as PassengerFormValue[]

  // When trip detail arrives (or booking context changes), map the
  // selected seat ids to seat codes/prices and initialise the passenger
  // form. Replaces the old manual `fetch + setTrip + setSeats` effect.
  useEffect(() => {
    if (!bookingContext || !trip) return
    // map seat ids to codes/prices
    const seats = trip.seatMap.decks
      .flatMap((dk) => dk.rows.flatMap((r) => r.seats.filter(Boolean) as any[]))
      .filter((s: any) => bookingContext.seatIds.includes(s.id))
      .map((s: any) => ({ id: s.id, code: s.code, price: s.finalPrice, class: s.seatClass }))
    setSelectedSeatCodes(seats)

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
    const assigned = new Set(
      passengerFields.map((p) => p.seatId).filter(Boolean),
    )
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
    toast.success('Đã tự động ghép ghế cho các hành khách!')
  }, [passengerFields, selectedSeatCodes, replace])

  const copyContactToFirst = useCallback(() => {
    const contactName = form.getValues('contactName')
    const source = contactName || guestName
    if (!source) {
      toast.error('Chưa có thông tin người liên hệ', {
        description: 'Vui lòng nhập tên người liên hệ ở bước tiếp theo.',
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
    toast.success('Đã sao chép tên người liên hệ!')
  }, [passengerFields, form, guestName, update])

  // Derived: unassigned passengers + duplicate seat check
  const unassignedCount = useMemo(
    () => passengers.filter((p) => !p.seatId).length,
    [passengers],
  )
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

  // Insurance cost calculation
  const insuranceCostMap = { none: 0, basic: 5000, comprehensive: 15000 } as const
  const insuranceCost = insuranceCostMap[insuranceLevel]

  const subtotal = selectedSeatCodes.reduce((s, x) => s + x.price, 0)
  const discount = campaignResult?.valid && campaignResult.campaign ? campaignResult.campaign.discount ?? 0 : 0
  const fees = 0
  const total = Math.max(0, subtotal - discount + fees + insuranceCost)

  const validateCampaignMut = useValidateCampaign({
    onSuccess: (data: any) => {
      setCampaignResult(data)
      if (data?.valid) {
        toast.success('Mã khuyến mãi hợp lệ!', {
          description: `Giảm ${formatCurrency(data.discount ?? 0, currency)}`,
          duration: 3000,
        })
      } else {
        toast.error('Mã không hợp lệ', {
          description: 'Kiểm tra lại mã khuyến mãi',
          duration: 3000,
        })
      }
    },
    onError: () => {
      setCampaignResult({ valid: false, error: 'Không thể kiểm tra mã' })
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
    onSuccess: (_data, vars: any) => {
      const holdData = (holdResultRef.current ?? {}) as any
      const holdBookingId = vars?.path?.id ?? holdData.bookingId
      setLastBooking({ id: holdBookingId, code: holdData.code, total: holdData.total })
      setGuestPhone(normalizePhone(contactPhoneRef.current))
      if (contactNameRef.current) setGuestName(contactNameRef.current)
      setBookingStep('success')
      toast.success('Đặt vé thành công!', {
        description: `Mã vé: ${holdData.code} — ${formatCurrency(holdData.total, currency)}`,
        duration: 5000,
      })
      const earnedPoints = Math.max(10, Math.floor(holdData.total / 1000))
      setLoyaltyPoints((prev) => prev + earnedPoints)
      toast.success(`Bạn nhận được +${earnedPoints} điểm thưởng!`, {
        description: 'Xem chi tiết tại mục Điểm thưởng',
        duration: 4000,
      })
    },
    onError: () => {
      setError('Thanh toán thất bại')
    },
    onSettled: () => {
      setSubmitting(false)
    },
  })

  // Refs to share hold-time data + form values with confirm's onSuccess
  // without re-creating the mutation hooks each render.
  const holdResultRef = useRef<any>(null)
  const contactPhoneRef = useRef('')
  const contactNameRef = useRef('')
  const paymentMethodRef = useRef<string>('cod')

  const holdMut = useHoldBooking({
    onSuccess: (holdResult: any) => {
      const holdData = holdResult?.data ?? holdResult
      if (!holdData?.bookingId) {
        setError('Không thể đặt chỗ')
        setSubmitting(false)
        return
      }
      holdResultRef.current = holdData
      confirmMut.mutate({
        path: { id: holdData.bookingId },
        body: { paymentMethod: paymentMethodRef.current },
      } as any)
    },
    onError: () => {
      setError('Không thể đặt chỗ')
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
      setError('Có ghế bị trùng — mỗi hành khách phải ngồi một ghế khác nhau')
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
    } as any)
  }

  const close = () => {
    setBookingStep('idle')
    setBookingContext(null)
    // Note: `trip` is now derived from useTripDetail(bookingContext?.tripId),
    // so it auto-clears when bookingContext is set to null above (the hook
    // becomes disabled). No need to manually reset local state.
    setSelectedSeatCodes([])
    form.reset({ passengers: [], contactName: '', contactPhone: '', contactEmail: '' })
    setCampaignCode('')
    setCampaignResult(null)
    setInsuranceLevel('none')
    setError('')
  }

  // Step transitions use `form.trigger` to validate just the relevant
  // sub-tree before advancing.
  const gotoContact = async () => {
    const valid = await form.trigger('passengers')
    if (!valid) {
      setError('Vui lòng kiểm tra thông tin hành khách')
      return
    }
    if (hasDuplicateSeats) {
      setError('Có ghế bị trùng — mỗi hành khách phải ngồi một ghế khác nhau')
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
      <DialogContent className="max-w-3xl w-[95vw] max-h-[92vh] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <BookingStepHeader
          bookingStep={bookingStep}
          trip={trip}
          selectedSeatCodes={selectedSeatCodes}
        />

        <div className="overflow-y-auto max-h-[calc(92vh-220px)]">
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
                insuranceLevel={insuranceLevel}
                setInsuranceLevel={setInsuranceLevel}
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
                insuranceLevel={insuranceLevel as unknown as InsuranceLevel}
                insuranceCost={insuranceCost}
                campaignCode={campaignCode}
                discount={discount}
                fees={fees}
                total={total}
                currency={currency}
                error={error}
                submitting={submitting}
                onGoBack={() => setBookingStep('contact')}
                onSubmit={form.handleSubmit(onSubmit)}
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
              insuranceLevel={insuranceLevel as unknown as InsuranceLevel}
              insuranceCost={insuranceCost}
              onClose={close}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
