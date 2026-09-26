'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import { useT } from '@/lib/i18n'
import { TIERS, type Tier } from './loyalty-data'

export function LoyaltyTiersOverview({ currentTier }: { currentTier: Tier }) {
  const t = useT()
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2">{t('home.memberTiers')}</h3>
      <div className="grid grid-cols-2 gap-2">
        {TIERS.map((tier) => {
          const isCurrent = tier.key === currentTier.key
          return (
            <div
              key={tier.key}
              className={`rounded-lg border p-2.5 text-center transition-all ${isCurrent ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200' : 'bg-slate-50'
                }`}
            >
              <div className={`inline-flex items-center justify-center h-7 w-7 rounded-full ${tier.bg} ${tier.color} mb-1`}>
                {tier.icon}
              </div>
              <div className="text-xs font-bold">{tier.name}</div>
              <div className="text-[10px] text-muted-foreground">
                {tier.max === Infinity ? `${tier.min.toLocaleString('vi-VN')}+` : `${tier.min}–${tier.max.toLocaleString('vi-VN')}`}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
