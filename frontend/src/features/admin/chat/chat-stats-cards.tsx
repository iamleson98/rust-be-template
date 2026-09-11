'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Headset, Activity, Clock } from 'lucide-react'
import { AdminStatsCardsSkeleton } from '@/features/admin/dashboard/stats-cards-skeleton'

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
  // Format the avg response time as "Mm Ss" (e.g. "1m 42s") or "N/A"
  // when no channels have a response yet (avgResponseSecs === 0).
  const formatResponseTime = (secs: number): string => {
    if (secs <= 0) return 'N/A'
    const mins = Math.floor(secs / 60)
    const s = Math.round(secs % 60)
    if (mins > 0) return `${mins}m ${s}s`
    return `${s}s`
  }

  // Stat cards — skeleton while the channels load (never zero values)
  return channelsLoading ? (
    <AdminStatsCardsSkeleton count={3} />
  ) : (
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Headset className="h-4 w-4 text-blue-600" /> Đang chờ</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold">{openCount}</div>
        <div className="text-xs text-muted-foreground mt-1">Cuộc trò chuyện chưa phân công</div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4 text-amber-600" /> Đang xử lý</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold">{assignedCount}</div>
        <div className="text-xs text-muted-foreground mt-1">Đã có nhân viên phụ trách</div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2"><Clock className="h-4 w-4 text-rose-600" /> Thời gian phản hồi TB</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-extrabold">{formatResponseTime(avgResponseSecs)}</div>
        <div className="text-xs text-muted-foreground mt-1">
          Trung bình từ tin nhắn đầu tiên đến phản hồi
        </div>
      </CardContent>
    </Card>
  </div>
  )
}
