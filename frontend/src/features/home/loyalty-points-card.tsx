'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import type { Tier } from './loyalty-data'

export function LoyaltyPointsCard({
  loyaltyPoints,
  currentTier,
  nextTier,
}: {
  loyaltyPoints: number
  currentTier: Tier
  nextTier: Tier | null
}) {
  return (
    <div className="rounded-xl border bg-linear-to-br from-blue-50 to-blue-50 p-4 text-center">
      <div className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Số điểm hiện tại</div>
      <div className="text-4xl font-extrabold text-blue-700 mt-1">
        {loyaltyPoints.toLocaleString('vi-VN')}
      </div>

      {/* Tier badge */}
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border"
        style={{
          borderColor: currentTier.key === 'platinum' ? '#7c3aed' : currentTier.key === 'gold' ? '#d97706' : currentTier.key === 'silver' ? '#64748b' : '#ea580c',
          background: currentTier.bg,
          color: currentTier.key === 'platinum' ? '#7c3aed' : currentTier.key === 'gold' ? '#d97706' : currentTier.key === 'silver' ? '#64748b' : '#ea580c',
        }}
      >
        {currentTier.icon}
        {currentTier.name}
      </div>

      {/* Progress to next tier */}
      {nextTier && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>{currentTier.name}</span>
            <span>{nextTier.name} ({nextTier.max + 1} điểm)</span>
          </div>
          <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
            <div



              className="h-full rounded-full bg-linear-to-r from-blue-500 to-blue-500"
            />
          </div>
          <div className="text-[10px] text-muted-foreground mt-1">
            Cần thêm {nextTier.max + 1 - loyaltyPoints} điểm để lên {nextTier.name}
          </div>
        </div>
      )}
    </div>
  )
}
