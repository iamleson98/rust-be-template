import { Check } from 'lucide-react'
import type { LoyaltyTierOut } from '@/api'
import { useT } from '@/lib/i18n'
import { BENEFIT_LABELS } from './tier-styles'

/** The tier's benefits: backend codes, translated here. */
export function LoyaltyTierBenefits({ tier }: { tier: LoyaltyTierOut }) {
  const t = useT()
  return (
    <ul className="space-y-2.5">
      {tier.benefitCodes.map((code) => (
        <li key={code} className="flex items-center gap-2.5 text-sm text-slate-700">
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600">
            <Check className="size-3" strokeWidth={3} aria-hidden />
          </span>
          {BENEFIT_LABELS[code] ? t(BENEFIT_LABELS[code]) : code}
        </li>
      ))}
    </ul>
  )
}
