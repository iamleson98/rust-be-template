'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useApp } from '@/lib/store'
import { queryKeys } from '@/lib/query-client'
import { useT } from '@/lib/i18n'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Separator } from '@/components/ui/separator'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ArrowRight,
  ArrowLeft,
  FileText,
  ShieldCheck,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'

const CANCEL_REASONS = [
  { key: 'change', labelKey: 'cancel.reason.change' },
  { key: 'cheaper', labelKey: 'cancel.reason.cheaper' },
  { key: 'tripCancel', labelKey: 'cancel.reason.tripCancel' },
  { key: 'other', labelKey: 'cancel.reason.other' },
] as const

type Step = 1 | 2 | 3

/**
 * Zod schema for the cancel-dialog form.
 *   - selectedReason: required (one of CANCEL_REASONS keys)
 *   - otherReason:    optional, max 500 chars; required (min 10) when reason==='other'
 *   - agreed:         required true (only validated on step 2)
 *
 * Step-aware validation is handled manually with form.trigger + setError,
 * so step-1 submission doesn't surface the "agreed" error from step 2.
 */
const cancelSchema = z.object({
  selectedReason: z.string().min(1, 'Vui lòng chọn lý do huỷ vé'),
  otherReason: z.string().trim().max(500, 'Lý do huỷ vé tối đa 500 ký tự'),
  agreed: z.boolean(),
})

type CancelValues = z.infer<typeof cancelSchema>

type CancelResponse = {
  success: boolean
  refundPercent?: number
  refundAmount?: number
  refCode?: string
  error?: string
}

export function CancelDialog() {
  const { cancelDialogOpen, setCancelDialogOpen, cancelBookingId, setCancelBookingId } = useApp()
  const t = useT()
  const qc = useQueryClient()

  const [step, setStep] = useState<Step>(1)
  const [refundPercent, setRefundPercent] = useState(0)
  const [refundAmount, setRefundAmount] = useState(0)
  const [refCode, setRefCode] = useState('')

  const form = useForm<CancelValues>({
    resolver: zodResolver(cancelSchema),
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      selectedReason: '',
      otherReason: '',
      agreed: false,
    },
  })

  const selectedReason = form.watch('selectedReason')
  const agreed = form.watch('agreed')

  // Cancel booking mutation — wraps the POST /api/bookings/:id/cancel
  // endpoint. We use a local mutation (not the centralized
  // `useCancelBooking`) because the dialog needs the refund info
  // (refundPercent, refundAmount, refCode) returned by the /cancel
  // endpoint to populate the success step. The centralized hook uses
  // DELETE which doesn't return refund data.
  const cancelMutation = useMutation({
    mutationFn: async (payload: { bookingId: string; reason: string; otherReason?: string }) => {
      const res = await fetch(`/api/bookings/${payload.bookingId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          reason: payload.reason,
          otherReason: payload.otherReason,
        }),
      })
      return (await res.json()) as CancelResponse
    },
    onSuccess: () => {
      // Invalidate the bookings query so the list refreshes with the
      // cancelled status (used by my-bookings.tsx + booking-detail.tsx).
      qc.invalidateQueries({ queryKey: queryKeys.bookings.all })
    },
  })
  const loading = cancelMutation.isPending

  const handleClose = (open: boolean) => {
    if (!open) {
      setCancelDialogOpen(false)
      setCancelBookingId(null)
      setStep(1)
      cancelMutation.reset()
      form.reset({ selectedReason: '', otherReason: '', agreed: false })
    }
  }

  const handleNext = async () => {
    if (step === 1) {
      // Validate step-1 fields
      const okReason = await form.trigger('selectedReason')
      if (!okReason) return
      const values = form.getValues()
      if (values.selectedReason === 'other') {
        const trimmed = values.otherReason.trim()
        if (trimmed.length < 10) {
          form.setError('otherReason', {
            type: 'manual',
            message: 'Vui lòng nhập lý do huỷ vé (tối thiểu 10 ký tự)',
          })
          return
        }
      }
      form.clearErrors('otherReason')
      setStep(2)
      return
    }
    if (step === 2) {
      // Validate agreed
      const okAgreed = await form.trigger('agreed')
      if (!okAgreed || !form.getValues('agreed')) {
        if (!form.formState.errors.agreed) {
          form.setError('agreed', {
            type: 'manual',
            message: 'Bạn cần đồng ý với chính sách hoàn vé',
          })
        }
        return
      }
      if (!cancelBookingId) return
      // Submit cancellation via mutation. The mutation auto-invalidates
      // the bookings query on success (see `onSuccess` above).
      const values = form.getValues()
      try {
        const data = await cancelMutation.mutateAsync({
          bookingId: cancelBookingId,
          reason: values.selectedReason,
          otherReason:
            values.selectedReason === 'other' ? values.otherReason : undefined,
        })
        if (data.success) {
          setRefundPercent(data.refundPercent ?? 0)
          setRefundAmount(data.refundAmount ?? 0)
          setRefCode(data.refCode || `HX-${Date.now().toString(36).toUpperCase()}`)
          setStep(3)
          toast.success(t('cancel.successTitle'))
        } else {
          toast.error(data.error || t('common.error'))
        }
      } catch {
        toast.error(t('common.error'))
      }
    }
  }

  const handleBack = () => {
    if (step === 2) setStep(1)
  }

  // Soft "can proceed" check for button disabled state — mirrors the
  // original UX (button disabled until each step's local condition is met).
  const canProceed = () => {
    if (step === 1) {
      if (!selectedReason) return false
      if (selectedReason === 'other') {
        const other = form.getValues('otherReason')
        return other.trim().length >= 10
      }
      return true
    }
    if (step === 2) return agreed
    return false
  }

  return (
    <Dialog open={cancelDialogOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-rose-700">
            <XCircle className="h-5 w-5" />
            {t('cancel.title')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {step === 1 && t('cancel.reason')}
            {step === 2 && t('cancel.refundPolicy')}
            {step === 3 && t('cancel.successTitle')}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleNext()
            }}
          >
            <div className="min-h-50 relative overflow-hidden">
              {/* Step 1: Select reason */}
              {step === 1 && (
                <div key="step1" className="space-y-3 py-2">
                  <FormField
                    control={form.control}
                    name="selectedReason"
                    render={({ field }) => (
                      <FormItem className="space-y-3">
                        <div className="space-y-3">
                          {CANCEL_REASONS.map((reason) => (
                            <button
                              key={reason.key}
                              type="button"
                              onClick={() => {
                                field.onChange(reason.key)
                                form.clearErrors('selectedReason')
                              }}
                              className={`w-full text-left rounded-xl border-2 px-4 py-3 transition-all duration-200 flex items-center gap-3 ${
                                field.value === reason.key
                                  ? 'border-rose-400 bg-rose-50 ring-1 ring-rose-200'
                                  : 'border-slate-200 hover:border-slate-300 bg-white'
                              }`}
                            >
                              <div
                                className={`h-5 w-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                                  field.value === reason.key
                                    ? 'border-rose-500 bg-rose-500'
                                    : 'border-slate-300'
                                }`}
                              >
                                {field.value === reason.key && (
                                  <div className="h-2 w-2 rounded-full bg-white" />
                                )}
                              </div>
                              <span
                                className={`text-sm font-medium ${
                                  field.value === reason.key
                                    ? 'text-rose-700'
                                    : 'text-foreground'
                                }`}
                              >
                                {t(reason.labelKey)}
                              </span>
                            </button>
                          ))}
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {selectedReason === 'other' && (
                    <FormField
                      control={form.control}
                      name="otherReason"
                      render={({ field }) => (
                        <FormItem className="overflow-hidden">
                          <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            Lý do khác <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value ?? ''}
                              placeholder="Nhập lý do huỷ vé (tối thiểu 10 ký tự)..."
                              className="mt-2 resize-none"
                              rows={3}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
              )}

              {/* Step 2: Confirm with refund policy */}
              {step === 2 && (
                <div key="step2" className="space-y-4 py-2">
                  {/* Warning banner */}
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 flex gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-sm text-amber-800">{t('cancel.confirmWarning')}</div>
                  </div>

                  {/* Refund policy */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ShieldCheck className="h-4 w-4 text-blue-600" />
                      {t('cancel.refundPolicy')}
                    </div>
                    <Separator />
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-2.5 text-sm">
                        <Clock className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                        <span className="text-foreground">{t('cancel.refundFull')}</span>
                      </div>
                      <div className="flex items-start gap-2.5 text-sm">
                        <Clock className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                        <span className="text-foreground">{t('cancel.refundHalf')}</span>
                      </div>
                      <div className="flex items-start gap-2.5 text-sm">
                        <Clock className="h-4 w-4 text-rose-500 mt-0.5 shrink-0" />
                        <span className="text-foreground">{t('cancel.refundNone')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Agreement checkbox */}
                  <FormField
                    control={form.control}
                    name="agreed"
                    render={({ field }) => (
                      <FormItem>
                        <label className="flex items-start gap-3 cursor-pointer group">
                          <FormControl>
                            <Checkbox
                              checked={!!field.value}
                              onCheckedChange={(v) => {
                                field.onChange(!!v)
                                if (v) form.clearErrors('agreed')
                              }}
                              className="mt-0.5 data-[state=checked]:bg-rose-500 data-[state=checked]:border-rose-500"
                            />
                          </FormControl>
                          <span className="text-sm text-foreground group-hover:text-rose-700 transition-colors">
                            {t('cancel.agree')}
                          </span>
                        </label>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

              {/* Step 3: Success */}
              {step === 3 && (
                <div
                  key="step3"
                  className="py-2 flex flex-col items-center text-center"
                >
                  <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
                    <CheckCircle2 className="h-8 w-8 text-blue-600" />
                  </div>

                  <h3 className="text-lg font-bold text-foreground mb-1">
                    {t('cancel.successTitle')}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-xs">
                    {t('cancel.successDesc')}
                  </p>

                  {refundAmount > 0 && (
                    <div className="rounded-xl bg-blue-50 border border-blue-200 p-4 mb-4 w-full max-w-xs">
                      <div className="text-xs font-medium text-blue-600 mb-1">
                        {t('cancel.refundAmount')}
                      </div>
                      <div className="text-xl font-extrabold text-blue-700">
                        {refundAmount.toLocaleString('vi-VN')}đ
                        <span className="text-sm font-normal text-blue-500 ml-1">
                          ({refundPercent}%)
                        </span>
                      </div>
                    </div>
                  )}

                  {refCode && (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <FileText className="h-3.5 w-3.5" />
                      {t('cancel.refCode')}:{' '}
                      <span className="font-mono font-semibold text-foreground">{refCode}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            {step < 3 && (
              <div className="flex items-center justify-between gap-3 pt-2">
                {step > 1 ? (
                  <Button type="button" variant="ghost" onClick={handleBack} className="gap-1.5">
                    <ArrowLeft className="h-4 w-4" />
                    {t('common.back')}
                  </Button>
                ) : (
                  <div />
                )}
                <Button
                  type="submit"
                  disabled={!canProceed() || loading}
                  className={`gap-1.5 ${
                    step === 2
                      ? 'bg-rose-600 hover:bg-rose-700 text-white'
                      : 'bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white'
                  }`}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('common.loading')}
                    </>
                  ) : step === 1 ? (
                    <>
                      {t('common.next')}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4" />
                      {t('cancel.title')}
                    </>
                  )}
                </Button>
              </div>
            )}

            {step === 3 && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  onClick={() => handleClose(false)}
                  className="bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 text-white"
                >
                  {t('common.close')}
                </Button>
              </div>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
