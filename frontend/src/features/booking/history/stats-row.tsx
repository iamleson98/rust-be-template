'use client'

// Extracted from the original 'booking-stats.tsx'.

import { memo } from 'react'
import { StatCard, type StatProps } from './stat-card'

export const StatsRow = memo(function StatsRow({ stats }: { stats: StatProps[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
      {stats.map((s, i) => (
        <StatCard key={i} {...s} />
      ))}
    </div>
  )
})
