import { AlertCircle, CheckCircle2, Clock, Headset } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { useT } from '@/lib/i18n'

/** The API sends no priority yet, so every channel reads "normal". */
export function PriorityBadge({ priority = 'normal' }: { priority?: string }) {
  const t = useT()
  const styles: Record<string, { label: string; cls: string }> = {
    high: { label: t('adminDash.priorityHigh'), cls: 'bg-rose-100 text-rose-700' },
    normal: { label: t('adminDash.priorityNormal'), cls: 'bg-slate-100 text-slate-600' },
    low: { label: t('adminDash.priorityLow'), cls: 'bg-slate-100 text-slate-500' },
  }
  const { label, cls } = styles[priority] ?? styles.normal
  return (
    <Badge variant="outline" className={`text-[10px] ${cls} border-0`}>
      {label}
    </Badge>
  )
}

export function ChannelStatusBadge({ status }: { status: string }) {
  const t = useT()
  const styles: Record<string, { label: string; cls: string; icon: ReactNode }> = {
    open: {
      label: t('adminDash.queueOpen'),
      cls: 'bg-amber-100 text-amber-700',
      icon: <Clock className="h-3 w-3" />,
    },
    assigned: {
      label: t('admin.stats.assignedCount'),
      cls: 'bg-blue-100 text-blue-700',
      icon: <Headset className="h-3 w-3" />,
    },
    closed: {
      label: t('common.close'),
      cls: 'bg-slate-100 text-slate-500',
      icon: <CheckCircle2 className="h-3 w-3" />,
    },
    blocked: {
      label: t('adminDash.queueBlocked'),
      cls: 'bg-rose-100 text-rose-700',
      icon: <AlertCircle className="h-3 w-3" />,
    },
  }
  const { label, cls, icon } = styles[status] ?? styles.open
  return (
    <Badge variant="outline" className={`text-[10px] ${cls} border-0 gap-0.5`}>
      {icon}
      {label}
    </Badge>
  )
}
