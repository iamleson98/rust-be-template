'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import { TIERS, type Tier } from './loyalty-data'

export function LoyaltyTiersOverview({ currentTier }: { currentTier: Tier }) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2">Các hạng thành viên</h3>
      <div className="grid grid-cols-2 gap-2">
        {TIERS.map((t) => {
          const isCurrent = t.key === currentTier.key
          return (
            <div
              key={t.key}
              className={`rounded-lg border p-2.5 text-center transition-all ${isCurrent ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50'
                }`}
            >
              <div className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${t.bg} ${t.color} mb-1`}>
                {t.icon}
              </div>
              <div className="text-xs font-bold">{t.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {t.max === Infinity ? `${t.min.toLocaleString('vi-VN')}+` : `${t.min}–${t.max.toLocaleString('vi-VN')}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
