'use client'

/**
 * PriorityBadge (chat queue).
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { Badge } from '@/components/ui/badge'
import { useT } from '@/lib/i18n'

export function PriorityBadge({ priority }: { priority: string }) {
  const t = useT()
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: t('adminDash.priorityHigh'), cls: 'bg-rose-100 text-rose-700' },
    normal: { label: t('adminDash.priorityNormal'), cls: 'bg-slate-100 text-slate-600' },
    low: { label: t('adminDash.priorityLow'), cls: 'bg-slate-100 text-slate-500' },
  }
  const p = map[priority] ?? map.normal
  return <Badge variant="outline" className={`text-[10px] ${p.cls} border-0`}>{p.label}</Badge>
}
