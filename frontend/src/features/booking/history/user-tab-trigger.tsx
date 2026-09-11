'use client'

// Extracted from the original 'booking-stats.tsx'.

import { memo } from 'react'
import { Badge } from '@/components/ui/badge'
import { TabsTrigger } from '@/components/ui/tabs'

/* ───────────────────────────────────────────────────────────────────────
 * UserTabTrigger — a TabsTrigger with a count badge. Extracted for reuse
 * across the 4 tabs in MyBookings.
 * ─────────────────────────────────────────────────────────────────────── */

export const UserTabTrigger = memo(function UserTabTrigger({
  value,
  icon,
  label,
  count,
  activeClass,
  badgeClass = 'bg-blue-100 text-blue-700',
}: {
  value: string
  icon: React.ReactNode
  label: string
  count: number
  activeClass: string
  badgeClass?: string
}) {
  return (
    <TabsTrigger
      value={value}
      className={`gap-2 px-4 py-2 rounded-lg ${activeClass} font-semibold`}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && (
        <Badge className={`ml-0.5 ${badgeClass} border-0 text-[10px] px-1.5 py-0 font-bold`}>
          {count}
        </Badge>
      )}
    </TabsTrigger>
  )
})
