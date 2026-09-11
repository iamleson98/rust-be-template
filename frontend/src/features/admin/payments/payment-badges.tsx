'use client'

/**
 * Provider + status badges with semantic colors for the admin payments
 * panel, plus the provider option list shared by the badges and the
 * filter bar.
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import { Badge } from '@/components/ui/badge'
import {
  Filter,
  Banknote,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
  ArrowLeftRight,
} from 'lucide-react'
import type {
  PaymentProvider,
  PaymentStatus,
} from '@/lib/queries/payments'

export const PROVIDER_OPTIONS: { value: string; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'all', label: 'Tất cả', icon: <Filter className="h-3.5 w-3.5" />, color: 'text-muted-foreground' },
  { value: 'vnpay', label: 'VNPay', icon: <span className="text-blue-500 font-bold text-xs">VNP</span>, color: 'text-blue-600' },
  { value: 'momo', label: 'MoMo', icon: <span className="text-fuchsia-500 font-bold text-xs">MM</span>, color: 'text-fuchsia-600' },
  { value: 'zalopay', label: 'ZaloPay', icon: <span className="text-emerald-500 font-bold text-xs">ZLP</span>, color: 'text-emerald-600' },
  { value: 'vietqr', label: 'VietQR', icon: <span className="text-amber-500 font-bold text-xs">QR</span>, color: 'text-amber-600' },
  { value: 'cod', label: 'Tiền mặt', icon: <Banknote className="h-3.5 w-3.5" />, color: 'text-amber-600' },
]

export function ProviderBadge({ provider }: { provider: PaymentProvider | string }) {
  const meta = PROVIDER_OPTIONS.find((p) => p.value === provider)
  if (!meta) return <Badge variant="outline" className="text-xs">{provider}</Badge>
  return (
    <Badge variant="outline" className={`gap-1.5 text-xs ${meta.color} border-current/20`}>
      {meta.icon}
      {meta.label}
    </Badge>
  )
}

export function StatusBadge({ status }: { status: PaymentStatus | string }) {
  const map: Record<PaymentStatus, { label: string; cls: string; icon: React.ReactNode }> = {
    pending: { label: 'Đang chờ', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900', icon: <Clock className="h-3 w-3" /> },
    completed: { label: 'Hoàn tất', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900', icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { label: 'Thất bại', cls: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-400 dark:border-rose-900', icon: <XCircle className="h-3 w-3" /> },
    cancelled: { label: 'Đã huỷ', cls: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/50 dark:text-slate-400 dark:border-slate-800', icon: <Ban className="h-3 w-3" /> },
    refunded: { label: 'Hoàn tiền', cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-900', icon: <ArrowLeftRight className="h-3 w-3" /> },
  }
  const m = map[status as PaymentStatus] ?? map.pending
  return (
    <Badge variant="outline" className={`gap-1 text-xs font-medium ${m.cls}`}>
      {m.icon}
      {m.label}
    </Badge>
  )
}
