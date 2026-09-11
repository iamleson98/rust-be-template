'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useApp } from '@/lib/store'
import { useCreatePriceAlert, usePriceAlerts, useRemovePriceAlert } from '@/lib/queries'
import type { PriceAlertOut as PriceAlert } from '@/lib/api/types.gen'
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
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form'
import { toast } from 'sonner'
import {
  Bell,
  ArrowRight,
  Phone,
  Mail,
  Loader2,
  CheckCircle2,
} from 'lucide-react'
import { formatVND } from '@/lib/types'
import {
  priceAlertSchema,
  type PriceAlertFormValues,
} from './price-alert-schema'
import { PriceAlertFrequencyField } from './price-alert-frequency-field'
import { PriceAlertTargetField } from './price-alert-target-field'
import { PriceAlertExistingList } from './price-alert-existing-list'

type ExistingAlert = PriceAlert

export function PriceAlertDialog() {
  const {
    priceAlertOpen,
    setPriceAlertOpen,
    priceAlertContext,
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

  // Guest lookup of existing alerts by phone (public endpoint).
  // Declared after `phone` is available — `usePriceAlerts` passes it as a
  // query param to `GET /api/price-alerts?phone=`.
  const phoneQuery = usePriceAlerts(phone)

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
      await removeAlertMut.mutateAsync({ path: { id } })
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
      const data: any = await createAlertMut.mutateAsync({ body: {
        phone: cleanPhone,
        email: values.email || null,
        fromName,
        toName,
        targetPrice: values.targetPrice,
        frequency: values.frequency,
      } })

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
              <PriceAlertTargetField
                form={form}
                minPrice={minPrice}
                targetPrice={targetPrice}
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
              <PriceAlertFrequencyField form={form} frequency={frequency} />

              {/* Existing alerts (if any) */}
              {existingAlerts.length > 0 && (
                <PriceAlertExistingList
                  existingAlerts={existingAlerts}
                  handleDeleteAlert={handleDeleteAlert}
                />
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
