'use client'

/**
 * GatewayRedirect — the vnpay / momo / zalopay body of the PaymentDialog:
 * a success card once completed, a "waiting for gateway" notice while the
 * gateway URL is still missing, or the provider label + "Mở trang thanh
 * toán" button that opens the gateway URL in a new tab.
 *
 * Extracted from the original `payment-dialog.tsx` together with the
 * private `providerMeta` helper.
 */

import { Button } from '@/components/ui/button'
import { CheckCircle2, ExternalLink, Wallet, QrCode, Banknote } from 'lucide-react'
import type { PaymentOut, PaymentProvider } from '@/lib/queries/payments'

function providerMeta(provider: PaymentProvider): { label: string; icon: React.ReactNode } {
  switch (provider) {
    case 'vnpay':
      return { label: 'VNPay QR', icon: <Wallet className="h-5 w-5 text-primary" /> }
    case 'momo':
      return { label: 'Ví MoMo', icon: <Wallet className="h-5 w-5 text-fuchsia-600" /> }
    case 'zalopay':
      return { label: 'ZaloPay', icon: <Wallet className="h-5 w-5 text-primary" /> }
    case 'vietqr':
      return { label: 'VietQR / Chuyển khoản', icon: <QrCode className="h-5 w-5 text-emerald-600" /> }
    case 'cod':
      return { label: 'Thanh toán tại xe', icon: <Banknote className="h-5 w-5 text-amber-600" /> }
    default:
      return { label: provider, icon: <Wallet className="h-5 w-5" /> }
  }
}

export function GatewayRedirect({
  provider,
  gatewayUrl,
  status,
}: {
  provider: PaymentProvider
  gatewayUrl?: string | null
  status: PaymentOut['status']
}) {
  const meta = providerMeta(provider)
  if (status === 'completed') {
    return (
      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
        <CheckCircle2 className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
        <div className="text-sm font-medium text-emerald-800">
          Cảm ơn bạn! Thanh toán đã thành công.
        </div>
      </div>
    )
  }
  if (!gatewayUrl) {
    return (
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-center text-sm text-amber-800">
        Đang chờ cổng thanh toán phản hồi...
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {meta.icon}
        <span className="font-medium text-sm">{meta.label}</span>
      </div>
      <a href={gatewayUrl} target="_blank" rel="noopener noreferrer">
        <Button
          className="w-full gap-2 bg-linear-to-r from-primary to-primary hover:from-primary/90 hover:to-primary/90"
        >
          <ExternalLink className="h-4 w-4" />
          Mở trang thanh toán
        </Button>
      </a>
      <p className="text-[11px] text-muted-foreground text-center">
        Sau khi hoàn tất trên trang của {meta.label}, hệ thống sẽ tự động xác nhận trong vài giây.
      </p>
    </div>
  )
}
