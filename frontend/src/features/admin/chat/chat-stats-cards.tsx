'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Headset, Activity, Clock } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function ChatStatsCards({
  channelsLoading,
  openCount,
  assignedCount,
  avgResponseSecs,
}: {
  /** While the channels query loads: show structure-matched skeletons
   *  instead of empty/zero values. */
  channelsLoading?: boolean
  openCount: number
  assignedCount: number
  avgResponseSecs: number
}) {
  const t = useT()
  // Format the avg response time as "Mm Ss" (e.g. "1m 42s") or "N/A"
  // when no channels have a response yet (avgResponseSecs === 0).
  const formatResponseTime = (secs: number): string => {
    if (secs <= 0) return 'N/A'
    const mins = Math.floor(secs / 60)
    const s = Math.round(secs % 60)
    if (mins > 0) return `${mins}m ${s}s`
    return `${s}s`
  }

  // One slim strip: the conversation list is the page, the numbers are context.
  const stat = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex min-w-0 items-center gap-2 px-3 py-2">
      <span className="shrink-0 text-muted-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-base leading-tight font-semibold tabular-nums">{value}</div>
        <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  )
  return channelsLoading ? (
    <Skeleton className="h-14 w-full shrink-0 rounded-xl" />
  ) : (
    <div className="grid shrink-0 grid-cols-3 divide-x rounded-xl border bg-card">
      {stat(<Headset />, t('chat.waiting'), openCount)}
      {stat(<Activity />, t('chat.processing'), assignedCount)}
      {stat(<Clock />, t('chat.avgResponseTime'), formatResponseTime(avgResponseSecs))}
    </div>
  )
}
