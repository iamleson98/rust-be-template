import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { validateCampaign, type CampaignValidateResponse } from '@/api'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'

/** A promo code typed at checkout, checked against the subtotal. */
export function usePromoCode(subtotal: number) {
  const t = useT()
  const money = useMoney()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<CampaignValidateResponse | null>(null)

  const validate = useMutation({
    mutationFn: async (query: { code: string; subtotal: number }) =>
      (await validateCampaign({ query, throwOnError: true })).data,
    onSuccess: (data) => {
      setResult(data)
      if (data.valid) {
        toast.success(t('bookingFlow.promoValid'), {
          description: t('bookingFlow.discountAmount', { amount: money(data.discount) }),
          duration: 3000,
        })
      } else {
        toast.error(t('bookingFlow.promoInvalidTitle'), {
          description: t('bookingFlow.promoInvalidDesc'),
          duration: 3000,
        })
      }
    },
    onError: () => setResult({ valid: false, discount: 0 }),
  })

  return {
    code,
    /** Editing the code discards the previous verdict. */
    setCode: (value: string) => {
      setCode(value)
      setResult(null)
    },
    result,
    checking: validate.isPending,
    apply: () => {
      const trimmed = code.trim()
      if (!trimmed) return
      setResult(null)
      validate.mutate({ code: trimmed, subtotal })
    },
    discount: result?.valid ? result.discount : 0,
    /** The code to send with the booking, once the server accepted it. */
    appliedCode: result?.valid ? code.trim().toUpperCase() : undefined,
  }
}

export type PromoCode = ReturnType<typeof usePromoCode>
