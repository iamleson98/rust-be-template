'use client'

/**
 * Activity feed icon — maps an activity `type` to its lucide icon.
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import {
  Ticket,
  Ban,
  MessageSquare,
  DollarSign,
  AlertCircle,
  ArrowDownRight,
  Star,
  Activity,
} from 'lucide-react'

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
