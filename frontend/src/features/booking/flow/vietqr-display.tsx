'use client'

/**
 * VietQrDisplay — the `vietqr` body of the PaymentDialog: bank name, the
 * QR image (pre-rendered server-side, with a qrserver.com fallback built
 * from the payload) and the bank-transfer instruction rows with
 * copy-to-clipboard buttons.
 *
 * Extracted from the original `payment-dialog.tsx` together with the
 * private `CopyRow` it renders.
 */

import { useMemo, useState } from 'react'
import { Building2, CheckCircle2, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'
import type { PaymentOut } from '@/lib/queries/payments'

export function VietQrDisplay({
  payment,
  currency,
}: {
  payment: PaymentOut
  currency: Currency
}) {
  const inst = payment.bankTransferInstructions
  const qrSrc = useMemo(() => {
    if (payment.qrImageDataUri) return payment.qrImageDataUri
    if (payment.qrPayload) {
      // Fallback: encode the payload string with a client-side QR generator.
      // We use the public `api.qrserver.com` endpoint to avoid pulling a JS
      // QR library — but this requires network access. The pre-rendered
      // `qrImageDataUri` from the server is preferred (offline + no tracking).
      const url = new URL('https://api.qrserver.com/v1/create-qr-code/')
      url.searchParams.set('size', '300x300')
      url.searchParams.set('data', payment.qrPayload)
      return url.toString()
    }
    return null
  }, [payment.qrImageDataUri, payment.qrPayload])

  if (!inst) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        Thông tin VietQR chưa sẵn sàng.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-emerald-600" />
        <span className="font-medium text-sm">{inst.bankName}</span>
      </div>

      {/* QR image */}
      {qrSrc && (
        <div className="flex justify-center">
          <div className="rounded-lg border-2 border-slate-200 bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="VietQR" width={240} height={240} />
          </div>
        </div>
      )}

      {/* Bank-transfer instructions */}
      <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
        <CopyRow label="Ngân hàng" value={inst.bankName} />
        <CopyRow label="Số tài khoản" value={inst.accountNo} />
        <CopyRow label="Chủ tài khoản" value={inst.accountName} />
        <CopyRow
          label="Số tiền"
          value={formatCurrency(inst.amount, currency)}
          highlight
        />
        <CopyRow label="Nội dung CK" value={inst.memo} highlight />
      </div>

      <p className="text-[11px] text-muted-foreground text-center">
        Quét mã QR bằng app ngân hàng hoặc chuyển khoản theo thông tin trên. Hệ thống tự xác nhận
        sau khi nhận được tiền.
      </p>
    </div>
  )
}

function CopyRow({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success('Đã sao chép')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Không sao chép được')
    }
  }
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span
          className={`text-sm font-medium ${
            highlight ? 'text-primary font-bold' : 'text-slate-900'
          }`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={copy}
          className="text-slate-400 hover:text-primary transition-colors"
          aria-label={`Sao chép ${label}`}
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
