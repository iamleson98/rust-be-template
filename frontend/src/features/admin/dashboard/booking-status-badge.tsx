'use client'

/**
 * Booking status badge (confirmed / pending / completed / cancelled /
 * refunded) used across the admin dashboard and tickets panels.
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  Clock,
  Ban,
  ArrowDownRight,
} from 'lucide-react'

/* ─── Booking Status Badge ─── */

export function BookingStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    confirmed: { label: 'Xác nhận', cls: 'bg-blue-100 text-blue-700', icon: <CheckCircle2 className="h-3 w-3" /> },
    paid: { label: 'Xác nhận', cls: 'bg-blue-100 text-blue-700', icon: <CheckCircle2 className="h-3 w-3" /> },
    pending: { label: 'Chờ xử lý', cls: 'bg-amber-100 text-amber-700', icon: <Clock className="h-3 w-3" /> },
    completed: { label: 'Hoàn thành', cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 className="h-3 w-3" /> },
    cancelled: { label: 'Đã huỷ', cls: 'bg-rose-100 text-rose-700', icon: <Ban className="h-3 w-3" /> },
    refunded: { label: 'Hoàn tiền', cls: 'bg-slate-100 text-slate-600', icon: <ArrowDownRight className="h-3 w-3" /> },
  }
  const s = map[status] ?? map.pending
  return (
    <Badge variant="outline" className={`text-[10px] ${s.cls} border-0 gap-0.5`}>
      {s.icon} {s.label}
    </Badge>
  )
}
