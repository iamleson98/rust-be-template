'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useCreatePriceAlert, usePriceAlerts, useRemovePriceAlert } from '@/lib/queries'
import type { PriceAlert } from '@/lib/queries/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { phoneSchema } from '@/lib/forms'
import { toast } from 'sonner'
import {
  Bell,
  ArrowRight,
  Phone,
  Mail,
  Loader2,
  CheckCircle2,
  TrendingDown,
  Clock,
  Calendar,
  Trash2,
} from 'lucide-react'
import { formatVND } from '@/lib/types'

type Frequency = 'immediate' | 'daily' | 'weekly'

const FREQUENCY_OPTIONS: { value: Frequency; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: 'immediate',
    label: 'Ngay lập tức',
    description: 'Thông báo ngay khi giá giảm',
    icon: <Clock className="h-4 w-4" />,
  },
  {
    value: 'daily',
    label: 'Hàng ngày',
    description: 'Tổng hợp mỗi sáng (8:00)',
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    value: 'weekly',
    label: 'Hàng tuần',
    description: 'Tổng hợp mỗi thứ Hai',
    icon: <Calendar className="h-4 w-4" />,
  },
]

type ExistingAlert = PriceAlert

const priceAlertSchema = z.object({
  phone: phoneSchema,
  email: z
    .string()
    .trim()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email không hợp lệ',
    ),
  targetPrice: z.coerce.number().positive('Mức giá mục tiêu phải lớn hơn 0'),
  frequency: z.enum(['immediate', 'daily', 'weekly']),
})
type PriceAlertFormValues = z.infer<typeof priceAlertSchema>

export function PriceAlertDialog() {
  const {
    priceAlertOpen,
    setPriceAlertOpen,
    priceAlertContext,
    setPriceAlertContext,
    guestPhone,
    setGuestPhone,
    guestName,
    searchParams,
  } = useApp()

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState<{ targetPrice: number } | null>(null)

  // Create-alert mutation — wraps POST /api/price-alerts and invalidates
  // the price-alerts cache on success so the existing-alerts list refreshes.
  const createAlertMut = useCreatePriceAlert()
  // Guest lookup of existing alerts by phone (public endpoint).
  const phoneQuery = usePriceAlerts(phone)
  // Cancel (soft-delete) an existing alert.
  const removeAlertMut = useRemovePriceAlert()

  // Resolve from/to + min price
  const fromName = priceAlertContext?.fromName || searchParams.from || ''
  const toName = priceAlertContext?.toName || searchParams.to || ''
  const minPrice = priceAlertContext?.minPrice ?? 0

  const form = useForm<z.input<typeof priceAlertSchema>, unknown, z.output<typeof priceAlertSchema>>({
    resolver: zodResolver(priceAlertSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      phone: '',
      email: '',
      targetPrice: 0,
      frequency: 'immediate',
    },
  })
  const { watch, setValue, control } = form
  const phone = watch('phone')
  const targetPrice = watch('targetPrice')
  const frequency = watch('frequency')

  // Pre-fill phone from guest profile when it becomes available
  useEffect(() => {
    if (guestPhone) {
      setValue('phone', guestPhone, { shouldValidate: false })
    }
  }, [guestPhone, setValue])

  // When opening, recompute suggested target price + reset frequency.
  // (Phone and email are intentionally preserved across opens — matches
  //  original behavior where the guestPhone effect pre-populates once.)
  useEffect(() => {
    if (priceAlertOpen) {
      setSuccess(null)
      // Suggest -10% by default
      const suggested = minPrice > 0 ? Math.round((minPrice * 0.9) / 1000) * 1000 : 0
      setValue('targetPrice', suggested)
      setValue('frequency', 'immediate')
    }
  }, [priceAlertOpen, minPrice, setValue])

  // Existing alerts for the current phone — sourced from the
  // centralized `usePriceAlerts(phone)` query (cached, deduped, and
  // auto-invalidated by the create/remove mutations). Only fetched
  // when the dialog is open and the phone is long enough.
  const existingAlerts: ExistingAlert[] =
    priceAlertOpen && phone && phone.length >= 9
      ? (phoneQuery.data?.items ?? [])
      : []

  const handleDeleteAlert = async (id: string) => {
    try {
      await removeAlertMut.mutateAsync(id)
      toast.success('Đã huỷ theo dõi giá')
    } catch {
      toast.error('Không thể xoá cảnh báo')
    }
  }

  const onSubmit = async (values: PriceAlertFormValues) => {
    if (!fromName || !toName) {
      toast.error('Vui lòng chọn điểm đi và điểm đến trước')
      return
    }

    setSubmitting(true)
    try {
      const cleanPhone = values.phone.replace(/\s/g, '')
      // Use the centralized mutation — it invalidates the price-alerts
      // cache on success and (via the extended payload type) forwards
      // all the dialog's fields to the backend.
      const data: any = await createAlertMut.mutateAsync({
        phone: cleanPhone,
        email: values.email || null,
        fromName,
        toName,
        maxPrice: values.targetPrice,
        targetPrice: values.targetPrice,
        frequency: values.frequency,
      })

      // Persist phone for future use
      setGuestPhone(cleanPhone)

      setSuccess({ targetPrice: values.targetPrice })
      // The create mutation already invalidated the price-alerts cache,
      // so the `usePriceAlerts(phone)` query will refetch automatically.
      toast.success(
        data?.duplicate
          ? 'Cảnh báo giá đã tồn tại — không tạo mới'
          : 'Đã tạo cảnh báo giá thành công',
      )
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể tạo cảnh báo giá')
    } finally {
      setSubmitting(false)
    }
  }

  const suggestedPrices = minPrice > 0
    ? [
      { pct: 10, label: '-10%', value: Math.round((minPrice * 0.9) / 1000) * 1000 },
      { pct: 20, label: '-20%', value: Math.round((minPrice * 0.8) / 1000) * 1000 },
      { pct: 30, label: '-30%', value: Math.round((minPrice * 0.7) / 1000) * 1000 },
    ]
    : []

  return (
    <Dialog open={priceAlertOpen} onOpenChange={(o) => setPriceAlertOpen(o)}>
      <DialogContent className="max-w-lg w-[95vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-linear-to-br from-blue-500 to-blue-500 text-white flex items-center justify-center shrink-0">
              <Bell className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold">Theo dõi giảm giá vé</DialogTitle>
              <DialogDescription className="text-xs">
                Nhận thông báo khi giá vé giảm dưới mức bạn mong muốn
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {success ? (
          <div key="success" className="py-6 text-center space-y-3">
            <div className="inline-flex h-16 w-16 rounded-full bg-blue-100 items-center justify-center mx-auto">
              <CheckCircle2 className="h-9 w-9 text-blue-600" />
            </div>
            <div>
              <h3 className="font-bold text-base">Đã thiết lập cảnh báo giá!</h3>
              <p className="text-sm text-muted-foreground mt-1.5 max-w-sm mx-auto">
                Bạn sẽ được thông báo khi giá vé tuyến{' '}
                <span className="font-semibold text-foreground">
                  {fromName} → {toName}
                </span>{' '}
                giảm dưới{' '}
                <span className="font-semibold text-blue-700">
                  {formatVND(success.targetPrice)}
                </span>
                .
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setSuccess(null)}>
                Tạo cảnh báo khác
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => setPriceAlertOpen(false)}
              >
                Xong
              </Button>
            </div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
              {/* Route (read-only display) */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Tuyến đường
                </Label>
                <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{fromName || 'Chưa chọn'}</div>
                    <div className="text-[10px] text-muted-foreground">Điểm đi</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-blue-600 shrink-0" />
                  <div className="flex-1 min-w-0 text-right">
                    <div className="text-sm font-semibold truncate">{toName || 'Chưa chọn'}</div>
                    <div className="text-[10px] text-muted-foreground">Điểm đến</div>
                  </div>
                </div>
                {minPrice > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Giá thấp nhất hiện tại:{' '}
                    <span className="font-semibold text-blue-700">{formatVND(minPrice)}</span>
                  </p>
                )}
              </div>

              {/* Target price */}
              <FormField
                control={control}
                name="targetPrice"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel htmlFor="target-price" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Mức giá mục tiêu (VND) <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="relative">
                      <TrendingDown className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-blue-500 z-10" />
                      <FormControl>
                        <Input
                          id="target-price"
                          type="number"
                          inputMode="numeric"
                          min={1000}
                          step={1000}
                          value={typeof field.value === 'number' && Number.isFinite(field.value) && field.value > 0 ? field.value : ''}
                          onChange={(e) => field.onChange(Math.max(0, Math.floor(Number(e.target.value))))}
                          onBlur={field.onBlur}
                          placeholder="VD: 250000"
                          className="pl-9"
                        />
                      </FormControl>
                    </div>
                    {suggestedPrices.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1">
                        <span className="text-[11px] text-muted-foreground mr-1">Gợi ý:</span>
                        {suggestedPrices.map((s) => (
                          <button
                            key={s.pct}
                            type="button"
                            onClick={() => setValue('targetPrice', s.value, { shouldValidate: true })}
                            className={`text-[11px] px-2 py-0.5 rounded-full border transition-all ${targetPrice === s.value
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'border-slate-200 text-slate-600 hover:border-blue-400 hover:text-blue-700'
                              }`}
                          >
                            {s.label} ({formatVND(s.value)})
                          </button>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Phone (required) */}
              <FormField
                control={control}
                name="phone"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel htmlFor="alert-phone" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Số điện thoại <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
                      <FormControl>
                        <Input
                          id="alert-phone"
                          type="tel"
                          {...field}
                          placeholder="0912345678"
                          className="pl-9"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Email (optional) */}
              <FormField
                control={control}
                name="email"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel htmlFor="alert-email" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Email <span className="text-muted-foreground/60 normal-case font-normal">(không bắt buộc)</span>
                    </FormLabel>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 z-10" />
                      <FormControl>
                        <Input
                          id="alert-email"
                          type="email"
                          {...field}
                          placeholder="email@example.com"
                          className="pl-9"
                        />
                      </FormControl>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Frequency */}
              <FormField
                control={control}
                name="frequency"
                render={({ field }) => (
                  <FormItem className="space-y-1.5">
                    <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Tần suất thông báo
                    </FormLabel>
                    <FormControl>
                      <RadioGroup
                        value={field.value}
                        onValueChange={field.onChange}
                        className="grid grid-cols-1 gap-2"
                      >
                        {FREQUENCY_OPTIONS.map((opt) => (
                          <label
                            key={opt.value}
                            htmlFor={`freq-${opt.value}`}
                            className={`flex items-start gap-3 rounded-lg border p-2.5 cursor-pointer transition-all ${frequency === opt.value
                                ? 'border-blue-500 bg-blue-50/50 ring-1 ring-blue-500/30'
                                : 'border-slate-200 hover:border-blue-300'
                              }`}
                          >
                            <RadioGroupItem
                              id={`freq-${opt.value}`}
                              value={opt.value}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className={`text-blue-600 ${frequency === opt.value ? '' : 'text-slate-400'}`}>
                                  {opt.icon}
                                </span>
                                <span className="text-sm font-medium">{opt.label}</span>
                              </div>
                              <div className="text-[11px] text-muted-foreground mt-0.5">
                                {opt.description}
                              </div>
                            </div>
                          </label>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Existing alerts (if any) */}
              {existingAlerts.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cảnh báo đã tạo ({existingAlerts.length})
                  </Label>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {existingAlerts.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5"
                      >
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${a.status === 'active'
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                        >
                          {a.status === 'active' ? 'Đang theo dõi' : 'Đã kích hoạt'}
                        </Badge>
                        <div className="text-xs flex-1 min-w-0 truncate">
                          <span className="font-medium">{a.fromName} → {a.toName}</span>
                          <span className="text-muted-foreground"> ≤ {formatVND(a.targetPrice)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteAlert(a.id)}
                          className="text-rose-500 hover:text-rose-700 p-1 rounded"
                          aria-label="Xoá"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter className="pt-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPriceAlertOpen(false)}
                  disabled={submitting}
                >
                  Huỷ
                </Button>
                <Button
                  type="submit"
                  disabled={submitting || !fromName || !toName}
                  className="bg-blue-600 hover:bg-blue-700 text-white gap-2 min-w-35"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Đang tạo...
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4" />
                      Bật theo dõi giá
                    </>
                  )}
                </Button>
              </DialogFooter>

              {guestName && (
                <p className="text-[10px] text-muted-foreground text-center -mt-2">
                  Đang dùng thông tin từ đặt vé gần nhất ({guestName})
                </p>
              )}
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
