'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useTripDetail } from '@/lib/queries'
import { useNavigate } from '@/router'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { formatDateTimeVN, formatDuration, normalizePhone, SEAT_CLASS_LABELS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import { fullNameSchema, phoneSchema, emailSchema } from '@/lib/forms'
import { toast } from 'sonner'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Tag,
  X,
  User,
  Phone,
  Mail,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Copy,
  Ticket,
  Calendar,
  Clock,
  Bus,
  QrCode,
  PartyPopper,
  // Group booking icons
  Plus,
  Trash2,
  Armchair,
  Baby,
  UserCheck,
  GripVertical,
  AlertTriangle,
  Sparkles,
  Users,
} from 'lucide-react'

type TripDetail = {
  trip: { id: string; departureAt: string; departureTime: string; arrivalTime: string; status: string }
  route: { name: string; durationMin: number; distanceKm: number }
  brand: { id: string; name: string; accentColor: string; logoUrl: string | null }
  from: { name: string }
  to: { name: string }
  busLayout: { name: string; vehicleTypeLabel: string }
  pricing: { basePriceAdult: number; basePriceChild: number }
  pickupPoints: { id: string; name: string; stopOrder: number; etaOffsetMin: number }[]
  seatMap: {
    decks: { deck: number; rows: { row: number; seats: any[] }[] }[]
  }
}

type PassengerType = 'adult' | 'child' | 'infant'
type Gender = 'male' | 'female' | 'other'

// ── Zod schema ──────────────────────────────────────────────
// The passenger form (step 1) and contact form (step 2) share a
// single RHF form instance — this lets validation span both steps
// and lets `form.trigger('passengers')` gate the step 1 → 2
// transition while `form.handleSubmit(onSubmit)` does the final
// submit-time validation in step 3.
//
// `age` uses `z.number()` (not `z.coerce.number()`) because the
// `<Input type="number">` onChange converts via `parseInt(... ) || 0`
// before calling `field.onChange`, so the form value is always a
// real `number` — using `z.number()` keeps RHF's input/output types
// identical so `form.watch` returns `number` (not `unknown`).
const passengerSchema = z.object({
  name: fullNameSchema,
  age: z
    .number()
    .int('Tuổi phải là số nguyên')
    .min(0, 'Tuổi không hợp lệ')
    .max(120, 'Tuổi không hợp lệ'),
  gender: z.enum(['male', 'female', 'other']),
  seatId: z.string().min(1, 'Vui lòng chọn ghế'),
})

const bookingSchema = z.object({
  passengers: z.array(passengerSchema).min(1, 'Cần ít nhất một hành khách'),
  contactName: fullNameSchema,
  contactPhone: phoneSchema,
  contactEmail: emailSchema.optional().or(z.literal('')),
})

type BookingValues = z.infer<typeof bookingSchema>
type PassengerFormValue = z.infer<typeof passengerSchema>

// Auto-detect passenger type from age
function getPassengerType(age: number): PassengerType {
  if (age < 2) return 'infant'
  if (age < 12) return 'child'
  return 'adult'
}

const PASSENGER_TYPE_META: Record<
  PassengerType,
  { label: string; gradient: string; border: string; pill: string; text: string; icon: React.ReactNode }
> = {
  adult: {
    label: 'Người lớn',
    gradient: 'from-blue-50 to-blue-50',
    border: 'border-blue-200',
    pill: 'bg-blue-100 text-blue-700',
    text: 'text-blue-700',
    icon: <User className="h-3 w-3" />,
  },
  child: {
    label: 'Trẻ em',
    gradient: 'from-amber-50 to-orange-50',
    border: 'border-amber-200',
    pill: 'bg-amber-100 text-amber-700',
    text: 'text-amber-700',
    icon: <UserCheck className="h-3 w-3" />,
  },
  infant: {
    label: 'Em bé',
    gradient: 'from-pink-50 to-rose-50',
    border: 'border-rose-200',
    pill: 'bg-pink-100 text-pink-700',
    text: 'text-pink-700',
    icon: <Baby className="h-3 w-3" />,
  },
}

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
    loyaltyPoints,
    setLoyaltyPoints,
    currency,
  } = useApp()
  const navigate = useNavigate()

  // Fetch trip detail via the centralized TanStack Query hook — the
  // BookingContext carries the tripId the user picked in TripDetailDialog.
  // We use `as unknown as TripDetail` because the centralized type in
  // `@/lib/queries/types` is out of sync with the actual backend response
  // (missing `seatMap.decks` wrapper, `pricing.basePriceAdult`, etc.).
  const { data: rawTripDetail } = useTripDetail(bookingContext?.tripId)
  const trip = rawTripDetail as unknown as TripDetail | null | undefined

  const [selectedSeatCodes, setSelectedSeatCodes] = useState<{ id: string; code: string; price: number; class: string }[]>([])
  const [campaignCode, setCampaignCode] = useState('')
  const [campaignResult, setCampaignResult] = useState<{ valid: boolean; campaign?: any; error?: string } | null>(null)
  const [checkingCampaign, setCheckingCampaign] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'momo' | 'vnpay' | 'bank' | 'cod'>('momo')
  const [copied, setCopied] = useState(false)

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
  const updatePassenger = useCallback(
    (index: number, updates: Partial<PassengerFormValue>) => {
      const current = passengerFields[index]
      if (!current) return
      update(index, { ...(current as PassengerFormValue), ...updates })
    },
    [passengerFields, update],
  )

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

  // Derived: passenger type counts
  const passengerCounts = useMemo(() => {
    const c = { adult: 0, child: 0, infant: 0 }
    for (const p of passengers) {
      c[getPassengerType(p.age)]++
    }
    return c
  }, [passengers])

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
  const insuranceLabelMap = {
    none: 'Không bảo hiểm',
    basic: 'Bảo hiểm cơ bản',
    comprehensive: 'Bảo hiểm toàn diện',
  } as const

  const subtotal = selectedSeatCodes.reduce((s, x) => s + x.price, 0)
  const discount = campaignResult?.valid && campaignResult.campaign ? campaignResult.campaign.discount ?? 0 : 0
  const fees = 0
  const total = Math.max(0, subtotal - discount + fees + insuranceCost)

  const checkCampaign = async () => {
    if (!campaignCode.trim() || !trip) return
    setCheckingCampaign(true)
    setCampaignResult(null)
    try {
      // Backend route: `GET /api/campaigns/validate?code=&subtotal=` (i64).
      // The backend `CampaignValidateQuery` only accepts `code` + `subtotal`;
      // `brandId` and `childCount` are ignored, so we don't send them.
      const params = new URLSearchParams({
        code: campaignCode.trim(),
        subtotal: String(subtotal),
      })
      const res = await fetch(`/api/campaigns/validate?${params}`, { credentials: 'include' })
      const data = await res.json()
      setCampaignResult(data)
      if (data.valid) {
        toast.success('Mã khuyến mãi hợp lệ!', {
          description: data.campaign?.name ?? `Giảm ${formatCurrency(data.discount ?? 0, currency)}`,
          duration: 3000,
        })
      } else {
        toast.error('Mã không hợp lệ', {
          description: data.error ?? 'Kiểm tra lại mã khuyến mãi',
          duration: 3000,
        })
      }
    } catch {
      setCampaignResult({ valid: false, error: 'Không thể kiểm tra mã' })
    } finally {
      setCheckingCampaign(false)
    }
  }

  // Final submit — called by `form.handleSubmit(onSubmit)` after the
  // entire schema (passengers + contact) has validated.
  const onSubmit = async (values: BookingValues) => {
    setError('')
    if (!bookingContext || !trip) return
    // Duplicate-seat check is a cross-field business rule that can't
    // be expressed per-field in zod, so we enforce it here.
    if (hasDuplicateSeats) {
      setError('Có ghế bị trùng — mỗi hành khách phải ngồi một ghế khác nhau')
      return
    }
    setSubmitting(true)
    try {
      // Backend route: `POST /api/bookings/hold` (alias of `POST /api/bookings`).
      // Body is `HoldReq` — snake_case. `passengers[].type` matches
      // `#[serde(rename = "type")]`; extra fields like `gender`/`seatId`
      // are ignored by serde. Send `credentials: 'include'` so the booking
      // is attached to the logged-in user (or treated as guest).
      const res = await fetch('/api/bookings/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          trip_id: bookingContext.tripId,
          seat_ids: bookingContext.seatIds,
          passengers: values.passengers.map((p) => ({
            name: p.name,
            type: getPassengerType(p.age),
            age: p.age,
          })),
          boarding_point_id: bookingContext.boardingPointId,
          dropping_point_id: bookingContext.droppingPointId,
          contact_name: values.contactName,
          contact_phone: normalizePhone(values.contactPhone),
          contact_email: values.contactEmail || undefined,
          campaign_code: campaignResult?.valid ? campaignCode.trim().toUpperCase() : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error?.message ?? data.error ?? 'Không thể đặt chỗ')
        return
      }
      // Backend returns `{ bookingId, code, total, ... }` (camelCase) from `hold()`.
      // Confirm the booking via `POST /api/bookings/{id}/confirm` with
      // body `{ payment_method }` (snake_case — matches `ConfirmReq`).
      const confirmRes = await fetch(`/api/bookings/${data.bookingId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ payment_method: paymentMethod }),
      })
      const confirmData = await confirmRes.json()
      if (!confirmRes.ok) {
        setError(confirmData.error?.message ?? confirmData.error ?? 'Thanh toán thất bại')
        return
      }
      setLastBooking({ id: data.bookingId, code: data.code, total: data.total })
      // Persist guest phone/name so notifications & wishlist work afterwards
      setGuestPhone(normalizePhone(values.contactPhone))
      if (values.contactName) setGuestName(values.contactName)
      setBookingStep('success')
      toast.success('Đặt vé thành công!', {
        description: `Mã vé: ${data.code} — ${formatCurrency(data.total, currency)}`,
        duration: 5000,
      })
      // Award loyalty points
      const earnedPoints = Math.max(10, Math.floor(data.total / 1000))
      setLoyaltyPoints((prev) => prev + earnedPoints)
      toast.success(`Bạn nhận được +${earnedPoints} điểm thưởng!`, {
        description: 'Xem chi tiết tại mục Điểm thưởng',
        duration: 4000,
      })
    } catch (e: any) {
      setError(e.message || 'Lỗi hệ thống')
    } finally {
      setSubmitting(false)
    }
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

  const stepIndex = ((bookingStep: string): number => {
    if (bookingStep === 'contact') return 1
    if (bookingStep === 'payment') return 2
    if (bookingStep === 'success') return 3
    return 0 // 'idle' or 'passengers'
  })(bookingStep)
  const steps = ['Hành khách', 'Liên hệ', 'Thanh toán', 'Hoàn tất']

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl w-[95vw] max-h-[92vh] p-0 gap-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50">
          <DialogTitle className="text-lg font-extrabold flex items-center gap-2">
            <Ticket className="h-5 w-5 text-blue-600" />
            {bookingStep === 'success' ? 'Đặt vé thành công!' : 'Hoàn tất đặt vé'}
          </DialogTitle>
          <DialogDescription className="text-xs mt-1">
            {trip ? `${trip.brand.name} • ${trip.from.name} → ${trip.to.name}` : 'Đang tải...'}
          </DialogDescription>

          {/* Stepper */}
          {bookingStep !== 'success' && (
            <div className="flex items-center gap-1 mt-3">
              {steps.slice(0, 3).map((s, i) => (
                <div key={s} className="flex items-center gap-1 flex-1">
                  <div
                    className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${i < stepIndex
                        ? 'bg-blue-600 text-white'
                        : i === stepIndex
                          ? 'bg-blue-600 text-white ring-4 ring-blue-100'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                  >
                    {i < stepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                  </div>
                  <span className={`text-xs ${i === stepIndex ? 'font-semibold text-blue-700' : 'text-muted-foreground'}`}>{s}</span>
                  {i < 2 && <div className={`h-px flex-1 mx-1 ${i < stepIndex ? 'bg-blue-400' : 'bg-slate-200'}`} />}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Trip summary bar */}
        {trip && bookingStep !== 'success' && (
          <div className="px-5 py-2.5 bg-slate-50 border-b flex items-center gap-3 text-xs">
            <Bus className="h-4 w-4 text-blue-600" />
            <span className="font-medium">{trip.from.name} → {trip.to.name}</span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDateTimeVN(trip.trip.departureAt)}
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(trip.route.durationMin)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {selectedSeatCodes.map((s) => (
                <Badge key={s.id} variant="outline" className="font-mono text-[10px]">
                  {s.code}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-y-auto max-h-[calc(92vh-220px)]">
          <Form {...form}>
            {/* Step: passengers */}
            {bookingStep === 'passengers' && (
              <div className="p-5 space-y-4">
                {/* Header + actions */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-1.5">
                      <Users className="h-4 w-4 text-blue-600" />
                      Thông tin hành khách
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {passengers.length}/{selectedSeatCodes.length} hành khách • {selectedSeatCodes.length} ghế đã chọn
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyContactToFirst}
                      disabled={!form.getValues('contactName') && !guestName}
                      className="gap-1.5 h-8 text-xs"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Sao chép từ liên hệ
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={autoAssignSeats}
                      disabled={unassignedCount === 0}
                      className="gap-1.5 h-8 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Tự ghép ghế
                    </Button>
                  </div>
                </div>

                {/* Mini seat preview — color-coded by passenger */}
                {selectedSeatCodes.length > 0 && (
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
                      <Armchair className="h-3 w-3" />
                      Sơ đồ ghép ghế
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedSeatCodes.map((s) => {
                        const passengerIdx = passengers.findIndex((p) => p.seatId === s.id)
                        const isAssigned = passengerIdx >= 0
                        const passenger = isAssigned ? passengers[passengerIdx] : null
                        const typeMeta = passenger ? PASSENGER_TYPE_META[getPassengerType(passenger.age)] : null
                        return (
                          <div
                            key={s.id}
                            className={`relative rounded-lg border-2 px-2.5 py-1.5 min-w-16 text-center transition-all ${isAssigned && typeMeta
                                ? `${typeMeta.border} bg-linear-to-br ${typeMeta.gradient}`
                                : 'border-dashed border-slate-300 bg-white'
                              }`}
                            title={isAssigned && passenger ? `Ghế ${s.code} — ${passenger.name || 'Hành khách ' + (passengerIdx + 1)}` : `Ghế ${s.code} — chưa gắn`}
                          >
                            <div className="font-mono font-bold text-xs">{s.code}</div>
                            {isAssigned && typeMeta ? (
                              <div className={`text-[10px] font-medium ${typeMeta.text} flex items-center justify-center gap-0.5`}>
                                {typeMeta.icon}
                                HP{passengerIdx + 1}
                              </div>
                            ) : (
                              <div className="text-[10px] text-slate-400">chưa gắn</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Passenger cards */}
                <div className="space-y-3">
                  {passengerFields.map((p, i) => {
                    const passenger = passengers[i] ?? (p as PassengerFormValue)
                    const typeMeta = PASSENGER_TYPE_META[getPassengerType(passenger.age)]
                    const assignedSeat = selectedSeatCodes.find((s) => s.id === passenger.seatId)
                    return (
                      <div
                        key={p.id}
                        className={`rounded-xl border-2 bg-linear-to-br ${typeMeta.gradient} ${typeMeta.border} p-3 space-y-2.5`}
                      >
                        {/* Card header */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <GripVertical className="h-4 w-4 text-muted-foreground/40 cursor-grab shrink-0" aria-hidden />
                            <div className={`h-7 w-7 rounded-full ${typeMeta.pill} inline-flex items-center justify-center text-xs font-bold shrink-0`}>
                              {i + 1}
                            </div>
                            <span className="text-xs font-medium text-slate-700 shrink-0 hidden sm:inline">
                              Hành khách {i + 1}
                            </span>
                            <Badge className={`${typeMeta.pill} border-0 text-[10px] gap-1 shrink-0`}>
                              {typeMeta.icon}
                              {typeMeta.label}
                              {getPassengerType(passenger.age) === 'infant' && <span className="opacity-70">(miễn phí)</span>}
                            </Badge>
                          </div>
                          {passengerFields.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-600 hover:bg-rose-50 shrink-0"
                              onClick={() => removePassenger(i)}
                              aria-label="Xoá hành khách"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>

                        {/* Inputs: name + age + gender */}
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_90px_120px] gap-2">
                          <FormField
                            control={form.control}
                            name={`passengers.${i}.name`}
                            render={({ field }) => (
                              <FormItem className="relative space-y-0">
                                <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                                <FormControl>
                                  <Input
                                    {...field}
                                    placeholder="Họ và tên (như CCCD)"
                                    className="pl-8 bg-white"
                                  />
                                </FormControl>
                                <FormMessage className="mt-1" />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`passengers.${i}.age`}
                            render={({ field }) => (
                              <FormItem className="space-y-0">
                                <FormControl>
                                  <Input
                                    type="number"
                                    min={0}
                                    max={120}
                                    value={field.value ?? 0}
                                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                                    onBlur={field.onBlur}
                                    name={field.name}
                                    ref={field.ref}
                                    placeholder="Tuổi"
                                    className="bg-white"
                                  />
                                </FormControl>
                                <FormMessage className="mt-1" />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`passengers.${i}.gender`}
                            render={({ field }) => (
                              <FormItem className="space-y-0">
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger className="bg-white">
                                      <SelectValue placeholder="Giới tính" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="male">Nam</SelectItem>
                                    <SelectItem value="female">Nữ</SelectItem>
                                    <SelectItem value="other">Khác</SelectItem>
                                  </SelectContent>
                                </Select>
                                <FormMessage className="mt-1" />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Seat assignment dropdown */}
                        <div className="flex items-center gap-2">
                          <Armchair className="h-4 w-4 text-muted-foreground shrink-0" />
                          <FormField
                            control={form.control}
                            name={`passengers.${i}.seatId`}
                            render={({ field }) => (
                              <FormItem className="flex-1 space-y-0">
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl>
                                    <SelectTrigger className="bg-white">
                                      <SelectValue placeholder="Chọn ghế cho hành khách này" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {selectedSeatCodes.map((s) => {
                                      const assignedTo = passengers.find((pp, j) => pp.seatId === s.id && j !== i)
                                      const assignedToIdx = assignedTo ? passengers.indexOf(assignedTo) + 1 : null
                                      return (
                                        <SelectItem
                                          key={s.id}
                                          value={s.id}
                                          disabled={!!assignedTo}
                                          textValue={`${s.code} • ${SEAT_CLASS_LABELS[s.class] ?? s.class} • ${formatCurrency(s.price, currency)}${assignedTo ? ` • đã ghép HP${assignedToIdx}` : ''}`}
                                        >
                                          <div className="flex items-center gap-2 w-full">
                                            <span className="font-mono font-bold text-xs">{s.code}</span>
                                            <span className="text-[10px] text-muted-foreground">
                                              {SEAT_CLASS_LABELS[s.class] ?? s.class}
                                            </span>
                                            <span className="text-[10px] text-muted-foreground ml-auto">
                                              {formatCurrency(s.price, currency)}
                                            </span>
                                            {assignedTo && (
                                              <span className="text-[10px] text-rose-500 ml-1 shrink-0">
                                                • HP{assignedToIdx}
                                              </span>
                                            )}
                                          </div>
                                        </SelectItem>
                                      )
                                    })}
                                  </SelectContent>
                                </Select>
                                <FormMessage className="mt-1" />
                              </FormItem>
                            )}
                          />
                          {assignedSeat && (
                            <Badge variant="outline" className="font-mono text-[10px] shrink-0 gap-1">
                              {formatCurrency(assignedSeat.price, currency)}
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Add passenger button */}
                {passengerFields.length < selectedSeatCodes.length && (
                  <Button
                    variant="outline"
                    onClick={addPassenger}
                    className="w-full gap-1.5 border-dashed"
                  >
                    <Plus className="h-4 w-4" />
                    Thêm hành khách (còn {selectedSeatCodes.length - passengerFields.length} ghế)
                  </Button>
                )}

                {/* Summary section */}
                <div className="rounded-lg border bg-white p-3 space-y-2">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-blue-600" />
                    Tóm tắt
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge className="bg-blue-100 text-blue-700 border-0 gap-1">
                      <User className="h-3 w-3" />
                      {passengerCounts.adult} người lớn
                    </Badge>
                    <Badge className="bg-amber-100 text-amber-700 border-0 gap-1">
                      <UserCheck className="h-3 w-3" />
                      {passengerCounts.child} trẻ em
                    </Badge>
                    {passengerCounts.infant > 0 && (
                      <Badge className="bg-pink-100 text-pink-700 border-0 gap-1">
                        <Baby className="h-3 w-3" />
                        {passengerCounts.infant} em bé
                      </Badge>
                    )}
                    <Separator orientation="vertical" className="h-4" />
                    <span className="text-muted-foreground">
                      Tổng chi phí ghế:
                    </span>
                    <span className="font-bold text-blue-700">
                      {formatCurrency(subtotal, currency)}
                    </span>
                  </div>
                  {unassignedCount > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        Còn {unassignedCount} hành khách chưa ghép ghế. Nhấn "Tự ghép ghế" để tự động gắn ghế trống.
                      </span>
                    </div>
                  )}
                  {hasDuplicateSeats && (
                    <div className="flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      <span>Có ghế bị trùng — mỗi hành khách phải ngồi một ghế khác nhau.</span>
                    </div>
                  )}
                  {unassignedCount === 0 && !hasDuplicateSeats && passengers.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>Tất cả hành khách đã được ghép ghế.</span>
                    </div>
                  )}
                </div>

                {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

                <div className="flex justify-end">
                  <Button
                    onClick={gotoContact}
                    disabled={!canContinueStep1}
                    className="gap-1 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
                  >
                    Tiếp tục <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step: contact + campaign */}
            {bookingStep === 'contact' && (
              <div className="p-5 space-y-5">
                <div>
                  <h3 className="font-semibold text-sm mb-3">Thông tin liên hệ</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormField
                      control={form.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5 sm:col-span-2">
                          <FormLabel>
                            Họ tên người liên hệ{' '}
                            <span className="text-destructive" aria-hidden="true">*</span>
                          </FormLabel>
                          <div className="relative">
                            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none z-10" />
                            <FormControl>
                              <Input {...field} placeholder="Nguyễn Văn A" className="pl-8" />
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
                            Số điện thoại{' '}
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
                          <FormLabel>Email (tùy chọn)</FormLabel>
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
                    <span className="font-semibold text-sm">Bảo hiểm chuyến đi</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {([
                      {
                        key: 'none' as const,
                        label: 'Không bảo hiểm',
                        cost: 0,
                        desc: 'Không bao gồm bảo hiểm',
                        icon: <Shield className="h-5 w-5" />,
                      },
                      {
                        key: 'basic' as const,
                        label: 'Bảo hiểm cơ bản',
                        cost: 5000,
                        desc: 'Hoàn hủy lên tới 50%',
                        icon: <ShieldCheck className="h-5 w-5" />,
                      },
                      {
                        key: 'comprehensive' as const,
                        label: 'Bảo hiểm toàn diện',
                        cost: 15000,
                        desc: 'Hoàn 100%, trễ 2h+, mất hành lý',
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
                        <div className="mt-1.5 font-bold text-sm text-blue-700">{opt.cost === 0 ? formatCurrency(0, currency) : `${formatCurrency(opt.cost, currency)}/chuyến`}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Campaign */}
                <div className="rounded-lg border bg-amber-50/50 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-sm">Mã khuyến mãi</span>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={campaignCode}
                      onChange={(e) => { setCampaignCode(e.target.value); setCampaignResult(null) }}
                      placeholder="VD: TET2025, LIMO20, PT50K..."
                      className="bg-white"
                    />
                    <Button variant="outline" onClick={checkCampaign} disabled={checkingCampaign || !campaignCode.trim()}>
                      {checkingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Áp dụng'}
                    </Button>
                  </div>
                  {campaignResult?.valid && campaignResult.campaign && (
                    <div className="mt-2 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-sm flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-blue-600" />
                        <div>
                          <div className="font-medium text-blue-800">{campaignResult.campaign.name}</div>
                          <div className="text-xs text-blue-600">{campaignResult.campaign.message}</div>
                        </div>
                      </div>
                      <div className="font-bold text-blue-700">-{formatCurrency(discount, currency)}</div>
                    </div>
                  )}
                  {campaignResult?.valid === false && campaignResult.error && (
                    <div className="mt-2 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700 flex items-center gap-2">
                      <X className="h-4 w-4" />
                      {campaignResult.error}
                    </div>
                  )}
                </div>

                {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setBookingStep('passengers')} className="gap-1">
                    <ChevronLeft className="h-4 w-4" /> Quay lại
                  </Button>
                  <Button onClick={gotoPayment} className="gap-1">
                    Tiếp tục <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step: payment */}
            {bookingStep === 'payment' && (
              <div className="p-5 space-y-4">
                <div>
                  <h3 className="font-semibold text-sm mb-3">Phương thức thanh toán</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { key: 'momo', label: 'Ví MoMo', icon: '🟣', sub: 'Quét mã QR' },
                      { key: 'vnpay', label: 'VNPay QR', icon: '🔵', sub: 'Ngân hàng' },
                      { key: 'bank', label: 'Chuyển khoản', icon: '🏦', sub: 'Internet Banking' },
                      { key: 'cod', label: 'Thanh toán tại xe', icon: '💵', sub: 'Tiền mặt' },
                    ].map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => setPaymentMethod(m.key as any)}
                        className={`rounded-lg border p-3 text-left transition-colors ${paymentMethod === m.key ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 hover:border-blue-300'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{m.icon}</span>
                          <div>
                            <div className="font-medium text-sm">{m.label}</div>
                            <div className="text-[11px] text-muted-foreground">{m.sub}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Summary */}
                <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
                  <h4 className="font-semibold text-sm mb-2">Chi tiết giá</h4>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tạm tính ({selectedSeatCodes.length} ghế)</span>
                    <span>{formatCurrency(subtotal, currency)}</span>
                  </div>
                  {insuranceCost > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                        {insuranceLabelMap[insuranceLevel]}
                      </span>
                      <span>{formatCurrency(insuranceCost, currency)}</span>
                    </div>
                  )}
                  {discount > 0 && (
                    <div className="flex justify-between text-sm text-blue-700">
                      <span>Giảm giá ({campaignCode})</span>
                      <span>-{formatCurrency(discount, currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Phí dịch vụ</span>
                    <span>{formatCurrency(fees, currency)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between font-bold text-base">
                    <span>Tổng cộng</span>
                    <span className="text-blue-700">{formatCurrency(total, currency)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-slate-50 rounded-lg p-3">
                  <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
                  Thông tin của bạn được mã hoá SSL 256-bit. Vé điện tử sẽ gửi qua SMS & email sau khi thanh toán.
                </div>

                {error && <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

                <div className="flex justify-between">
                  <Button variant="outline" onClick={() => setBookingStep('contact')} className="gap-1">
                    <ChevronLeft className="h-4 w-4" /> Quay lại
                  </Button>
                  <Button
                    onClick={form.handleSubmit(onSubmit)}
                    disabled={submitting}
                    className="gap-2 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Đang xử lý...
                      </>
                    ) : (
                      <>
                        <Lock className="h-4 w-4" /> Thanh toán {formatCurrency(total, currency)}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </Form>

          {/* Step: success — outside the Form (no inputs) */}
          {bookingStep === 'success' && lastBooking && (
            <div className="p-5">
              <div className="text-center py-6">
                <div
                  className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 mb-4"
                >
                  <PartyPopper className="h-8 w-8 text-blue-600" />
                </div>
                <h3
                  className="text-xl font-extrabold text-blue-700"
                >
                  Đặt vé thành công!
                </h3>
                <p
                  className="text-sm text-muted-foreground mt-1"
                >
                  Vé điện tử đã được gửi đến số điện thoại & email của bạn
                </p>

                <div
                  className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2"
                >
                  <span className="text-xs text-muted-foreground">Mã vé</span>
                  <code className="font-mono font-bold text-lg text-blue-700">{lastBooking.code}</code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(lastBooking.code)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                    className="ml-1 p-1 rounded hover:bg-white"
                  >
                    {copied ? <CheckCircle2 className="h-4 w-4 text-blue-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* QR placeholder */}
              <div className="flex justify-center my-4">
                <div className="rounded-xl border-2 border-dashed border-slate-300 p-4 bg-white">
                  <div className="h-32 w-32 bg-linear-to-br from-slate-900 to-slate-700 rounded-lg flex items-center justify-center relative overflow-hidden">
                    <QrCode className="h-20 w-20 text-white" />
                    <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 gap-px opacity-30">
                      {Array.from({ length: 64 }).map((_, i) => (
                        <div key={i} className={Math.random() > 0.5 ? 'bg-white' : ''} />
                      ))}
                    </div>
                  </div>
                  <div className="text-center text-xs text-muted-foreground mt-2">Quét mã để lên xe</div>
                </div>
              </div>

              {/* Booking summary */}
              {trip && (
                <div className="rounded-lg border bg-white p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Tuyến</span>
                    <span className="font-medium">{trip.from.name} → {trip.to.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Khởi hành</span>
                    <span className="font-medium">{formatDateTimeVN(trip.trip.departureAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ghế</span>
                    <span className="font-medium font-mono">{selectedSeatCodes.map((s) => s.code).join(', ')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Hãng xe</span>
                    <span className="font-medium">{trip.brand.name}</span>
                  </div>
                  {insuranceLevel !== 'none' && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
                        Bảo hiểm
                      </span>
                      <span className="font-medium text-blue-700">{insuranceLabelMap[insuranceLevel]} ({formatCurrency(insuranceCost, currency)})</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2 font-bold text-base">
                    <span>Tổng thanh toán</span>
                    <span className="text-blue-700">{formatCurrency(lastBooking.total, currency)}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <Button variant="outline" className="flex-1 gap-1" onClick={close}>
                  Đặt vé khác
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1"
                  onClick={() => {
                    const code = lastBooking?.code
                    close()
                    // Deep-link to the booking detail page so the user can
                    // see their new booking's QR code + pickup info.
                    if (code) {
                      navigate({ to: '/bookings/$code', params: { code } })
                    } else {
                      navigate({ to: '/bookings' })
                    }
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                >
                  <Ticket className="h-4 w-4" />
                  Xem vé của tôi
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
