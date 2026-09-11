'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useApp } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { useCancelBooking } from '@/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { XCircle, Loader2, ArrowRight, ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { cancelSchema, type CancelValues, type Step } from './cancel-dialog-schema'
import { CancelReasonStep } from './cancel-reason-step'
import { CancelPolicyStep } from './cancel-policy-step'
import { CancelSuccessStep } from './cancel-success-step'

export function CancelDialog() {
  const { cancelDialogOpen, setCancelDialogOpen, cancelBookingId, setCancelBookingId } = useApp()
  const t = useT()

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

  // Cancel booking mutation — uses the centralized useCancelBooking hook
  // (POST /api/bookings/:id/cancel). The hook auto-invalidates the
  // bookings query on success. The refund info (refundPercent,
  // refundAmount, refCode) returned by the endpoint is captured in
  // onSuccess to populate the success step.
  const cancelMutation = useCancelBooking({
    onSuccess: (data: any) => {
      const d = data?.data ?? data
      if (d?.success) {
        setRefundPercent(d.refundPercent ?? 0)
        setRefundAmount(d.refundAmount ?? 0)
        setRefCode(d.refCode || `HX-${Date.now().toString(36).toUpperCase()}`)
        setStep(3)
        toast.success(t('cancel.successTitle'))
      } else {
        toast.error(d?.error || t('common.error'))
      }
    },
    onError: () => {
      toast.error(t('common.error'))
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
      cancelMutation.mutate({
        path: { id: cancelBookingId },
        body: {
          reason: values.selectedReason,
          otherReason:
            values.selectedReason === 'other' ? values.otherReason : undefined,
        },
      } as any)
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
                <CancelReasonStep form={form} selectedReason={selectedReason} />
              )}

              {/* Step 2: Confirm with refund policy */}
              {step === 2 && (
                <CancelPolicyStep form={form} />
              )}

              {/* Step 3: Success */}
              {step === 3 && (
                <CancelSuccessStep refundPercent={refundPercent} refundAmount={refundAmount} refCode={refCode} />
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
