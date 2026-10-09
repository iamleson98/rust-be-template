'use client'

import { useState } from 'react'
import { Building2, CheckCircle2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { PaymentOut } from '@/api'
import { formatVND } from '@/lib/format'
import { useT } from '@/lib/i18n'

/**
 * Bank transfer by VietQR: the server-rendered QR plus every transfer field with
 * a copy button. Amounts are always VND. The QR is never built by a third-party
 * service: that would hand the account, amount and booking memo to it.
 */
export function VietQrDisplay({ payment }: { payment: PaymentOut }) {
  const t = useT()
  const inst = payment.bankTransferInstructions

  if (!inst) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        {t('bookingFlow.vietqrNotReady')}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-emerald-600" />
        <span className="font-medium text-sm">{inst.bankName}</span>
      </div>

      {payment.qrImageDataUri && (
        <div className="flex justify-center">
          <div className="rounded-lg border-2 border-slate-200 bg-white p-3">
            <img src={payment.qrImageDataUri} alt="VietQR" width={240} height={240} />
          </div>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        <CopyRow label={t('payment.vnpayDesc')} value={inst.bankName} />
        <CopyRow label={t('bookingFlow.accountNo')} value={inst.accountNo} />
        <CopyRow label={t('bookingFlow.accountName')} value={inst.accountName} />
        <CopyRow
          label={t('bookingFlow.amount')}
          value={formatVND(inst.amount)}
          // Banking apps want the bare number.
          copyValue={String(inst.amount)}
          highlight
        />
        <CopyRow label={t('bookingFlow.memoLabel')} value={inst.memo} highlight />
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        {t('bookingFlow.vietqrInstructions')}
      </p>
    </div>
  )
}

function CopyRow({
  label,
  value,
  copyValue = value,
  highlight,
}: {
  label: string
  value: string
  copyValue?: string
  highlight?: boolean
}) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue)
      setCopied(true)
      toast.success(t('bookingFlow.copied'))
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t('bookingFlow.copyFailed'))
    }
  }
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`text-sm font-medium ${highlight ? 'text-primary font-bold' : 'text-slate-900'}`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-slate-400 hover:text-primary transition-colors"
          aria-label={t('bookingFlow.copyField', { field: label })}
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  )
}
