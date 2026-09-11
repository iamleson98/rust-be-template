'use client'

// Extracted from the original 'loyalty-widget.tsx'.

import { Sparkles, CheckCircle2 } from 'lucide-react'
import type { Tier } from './loyalty-data'

export function LoyaltyTierBenefits({ currentTier }: { currentTier: Tier }) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
        <Sparkles className="h-4 w-4 text-amber-500" />
        Quyền lợi {currentTier.name}
      </h3>
      <div className="space-y-1.5">
        {currentTier.benefits.map((b, i) => (
          <div key={i} className="flex items-center gap-2 text-xs text-slate-700">
            <CheckCircle2 className="h-3.5 w-3.5 text-blue-600 shrink-0" />
            {b}
          </div>
        ))}
      </div>
    </div>
  )
}
