'use client'

// Extracted from the original 'loyalty-widget.tsx'.
//
// REAL-DATA REWORK: the benefit list comes straight from the backend
// tier's `benefitCodes` — the mapping code→i18n label lives in
// loyalty-data.tsx, the tier→benefits mapping itself is backend-owned.

import { Sparkles, CheckCircle2 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import type { LoyaltyTier } from '@/lib/queries'
import { BENEFIT_LABELS } from './loyalty-data'

export function LoyaltyTierBenefits({ tier }: { tier: LoyaltyTier }) {
  const t = useT()
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-sm">
        <Sparkles className="h-4 w-4 text-amber-500" />
        {t('home.tierBenefits', { name: tier.name })}
      </h3>
      <div className="space-y-1.5">
        {tier.benefitCodes.map((code) => (
          <div key={code} className="flex items-center gap-2 text-xs text-slate-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-blue-600" />
            {BENEFIT_LABELS[code] ? t(BENEFIT_LABELS[code]) : code}
          </div>
        ))}
      </div>
    </div>
  )
}
