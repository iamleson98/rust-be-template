'use client'

/**
 * StatusBadge (chat queue).
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { Badge } from '@/components/ui/badge'
import { useT } from '@/lib/i18n'
import {
  CheckCircle2,
  Clock,
  Headset,
  AlertCircle,
} from 'lucide-react'

export function StatusBadge({ status }: { status: string }) {
  const t = useT()
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    open: { label: t('adminDash.queueOpen'), cls: 'bg-amber-100 text-amber-700', icon: <Clock className="h-3 w-3" /> },
    assigned: { label: t('admin.stats.assignedCount'), cls: 'bg-blue-100 text-blue-700', icon: <Headset className="h-3 w-3" /> },
    closed: { label: t('common.close'), cls: 'bg-slate-100 text-slate-500', icon: <CheckCircle2 className="h-3 w-3" /> },
    blocked: { label: t('adminDash.queueBlocked'), cls: 'bg-rose-100 text-rose-700', icon: <AlertCircle className="h-3 w-3" /> },
  }
  const s = map[status] ?? map.open
  return <Badge variant="outline" className={`text-[10px] ${s.cls} border-0 gap-0.5`}>{s.icon}{s.label}</Badge>
}
