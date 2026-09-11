'use client'

/**
 * Small presentational components shared across the AdminDashboard tabs:
 * KPI cards, status badges, activity icons, star ratings.
 *
 * Extracted verbatim from the original `admin-dashboard.tsx`
 * (lines 1651-1788). Pure refactor.
 */

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  Clock,
  Ban,
  Headset,
  AlertCircle,
  Ticket,
  MessageSquare,
  DollarSign,
  Star,
  Activity,
} from 'lucide-react'
import { formatNum } from '@/lib/types'

/* ─── Enhanced KPI Card ─── */

export function KpiCard({ icon, label, value, change, up, color, gradient, delay }: {
  icon: React.ReactNode
  label: string
  value: string
  change: string
  up?: boolean
  color: string
  gradient: string
  delay: number
}) {
  return (
    <div>
      <Card className="transition-all duration-300 group overflow-hidden">
        <div className={`h-1 bg-linear-to-r ${gradient.replace('/10', '').replace('/5', '')}`} style={{ background: `linear-gradient(to right, ${color}, ${color}88)` }} />
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
              <div className="text-2xl font-extrabold tracking-tight">{value}</div>
            </div>
            <div
              className="h-11 w-11 rounded-xl flex items-center justify-center transition-transform duration-300"
              style={{ background: `${color}15`, color }}
            >
              {icon}
            </div>
          </div>
          <div className={`text-xs mt-2.5 flex items-center gap-1 font-medium ${up ? 'text-blue-600' : 'text-rose-600'}`}>
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {change}
            <span className="text-muted-foreground font-normal">so với tuần trước</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

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

/* ─── Activity Feed Icon ─── */

export function ActivityIcon({ type }: { type: string }) {
  const iconMap: Record<string, React.ReactNode> = {
    ticket: <Ticket className="h-3.5 w-3.5" />,
    cancel: <Ban className="h-3.5 w-3.5" />,
    chat: <MessageSquare className="h-3.5 w-3.5" />,
    payment: <DollarSign className="h-3.5 w-3.5" />,
    alert: <AlertCircle className="h-3.5 w-3.5" />,
    refund: <ArrowDownRight className="h-3.5 w-3.5" />,
    review: <Star className="h-3.5 w-3.5" />,
  }
  return <>{iconMap[type] ?? <Activity className="h-3.5 w-3.5" />}</>
}

/* ─── PriorityBadge & StatusBadge (chat queue) ─── */

export function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: 'Ưu tiên', cls: 'bg-rose-100 text-rose-700' },
    normal: { label: 'Thường', cls: 'bg-slate-100 text-slate-600' },
    low: { label: 'Thấp', cls: 'bg-slate-100 text-slate-500' },
  }
  const p = map[priority] ?? map.normal
  return <Badge variant="outline" className={`text-[10px] ${p.cls} border-0`}>{p.label}</Badge>
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
    open: { label: 'Chờ', cls: 'bg-amber-100 text-amber-700', icon: <Clock className="h-3 w-3" /> },
    assigned: { label: 'Đang xử lý', cls: 'bg-blue-100 text-blue-700', icon: <Headset className="h-3 w-3" /> },
    closed: { label: 'Đóng', cls: 'bg-slate-100 text-slate-500', icon: <CheckCircle2 className="h-3 w-3" /> },
    blocked: { label: 'Chặn', cls: 'bg-rose-100 text-rose-700', icon: <AlertCircle className="h-3 w-3" /> },
  }
  const s = map[status] ?? map.open
  return <Badge variant="outline" className={`text-[10px] ${s.cls} border-0 gap-0.5`}>{s.icon}{s.label}</Badge>
}



/* ─── Customer Segmentation Donut ─── */
/* Generic version — accepts segments with `{ label, count, color }` so it
   can be driven by real backend data (e.g. booking status breakdown)
   instead of the deleted `CUSTOMER_SEGMENTS` mock array. */

export type DonutSegment = {
  label: string
  count: number
  color: string
}

export function SegmentationDonut({
  segments,
  total,
}: {
  segments: DonutSegment[]
  total: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const radius = 60
  const cx = 80
  const cy = 80
  const circumference = 2 * Math.PI * radius
  const safeTotal = total > 0 ? total : 1

  // Pre-compute cumulative offsets without mutation (functional style)
  const pcts = segments.map((s) => s.count / safeTotal)
  const cumulativeStarts = pcts.reduce<number[]>((acc, p, i) => {
    const start = i === 0 ? 0 : acc[i - 1] + pcts[i - 1]
    return [...acc, start]
  }, [])
  const arcs = segments.map((s, i) => {
    const pct = pcts[i]
    const dash = pct * circumference
    const offset = -cumulativeStarts[i] * circumference
    return { ...s, idx: i, dash, offset, pct }
  })

  const active = hoverIdx !== null ? arcs[hoverIdx] : null

  return (
    <div className="flex items-center justify-center gap-4 my-2">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          {/* Background ring */}
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth="16" />
          {arcs.map((a) => (
            <circle
              key={a.idx}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={a.color}
              strokeWidth={hoverIdx === a.idx ? 20 : 16}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={a.offset}
              className="transition-all duration-300 cursor-pointer"
              onMouseEnter={() => setHoverIdx(a.idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ strokeLinecap: 'butt' }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {active ? (
            <>
              <div className="text-xl font-extrabold" style={{ color: active.color }}>{formatNum(active.count)}</div>
              <div className="text-[10px] text-muted-foreground">{active.label}</div>
              <div className="text-[10px] font-medium" style={{ color: active.color }}>{(active.pct * 100).toFixed(1)}%</div>
            </>
          ) : (
            <>
              <div className="text-xl font-extrabold">{formatNum(total)}</div>
              <div className="text-[10px] text-muted-foreground">Tổng</div>
            </>
          )}
        </div>
      </div>
      <div className="space-y-1.5 hidden sm:block">
        {arcs.map((a) => (
          <div
            key={a.idx}
            className="flex items-center gap-2 text-xs cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-50"
            onMouseEnter={() => setHoverIdx(a.idx)}
            onMouseLeave={() => setHoverIdx(null)}
            style={{ opacity: hoverIdx === null || hoverIdx === a.idx ? 1 : 0.5 }}
          >
            <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: a.color }} />
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-bold ml-auto">{(a.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
