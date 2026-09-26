// Extracted from the original 'loyalty-widget.tsx'.

import { Crown, Trophy, Medal, Star } from 'lucide-react'

export type Tier = {
  key: string
  name: string
  min: number
  max: number
  icon: React.ReactNode
  color: string
  bg: string
  benefits: string[]
}

// Tier names (Platinum/Gold/Silver/Bronze) are proper nouns — not translated.
// `benefits` holds i18n keys (home.benefit*) rendered via t() by consumers.
export const TIERS: Tier[] = [
  {
    key: 'platinum',
    name: 'Platinum',
    min: 20000,
    max: Infinity,
    icon: <Crown className="h-5 w-5" />,
    color: 'text-violet-600',
    bg: 'bg-violet-100',
    benefits: ['home.benefitDiscount15', 'home.benefitPrioritySeat', 'home.benefitFreeRefund', 'home.benefitVoucher150k'],
  },
  {
    key: 'gold',
    name: 'Gold',
    min: 5000,
    max: 19999,
    icon: <Trophy className="h-5 w-5" />,
    color: 'text-amber-600',
    bg: 'bg-amber-100',
    benefits: ['home.benefitDiscount10', 'home.benefitPrioritySeat', 'home.benefitVoucher60k'],
  },
  {
    key: 'silver',
    name: 'Silver',
    min: 1000,
    max: 4999,
    icon: <Medal className="h-5 w-5" />,
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    benefits: ['home.benefitDiscount5', 'home.benefitVoucher25k'],
  },
  {
    key: 'bronze',
    name: 'Bronze',
    min: 0,
    max: 999,
    icon: <Star className="h-5 w-5" />,
    color: 'text-orange-600',
    bg: 'bg-orange-100',
    benefits: ['home.benefitEarnPoints', 'home.benefitRedeemVoucher'],
  },
]

export type Voucher = {
  points: number
  value: number
  label: string
}

export const VOUCHERS: Voucher[] = [
  { points: 500, value: 25000, label: 'Voucher 25.000đ' },
  { points: 1000, value: 60000, label: 'Voucher 60.000đ' },
  { points: 2000, value: 150000, label: 'Voucher 150.000đ' },
]

export type PointsHistory = {
  id: string
  description: string
  amount: number
  date: string
}

// `description` holds i18n keys (home.history*) rendered via t() by consumers.
export const MOCK_HISTORY: PointsHistory[] = [
  { id: '1', description: 'home.historyBookedHnSg', amount: 150, date: '2025-07-15' },
  { id: '2', description: 'home.historyBookedDnNt', amount: 85, date: '2025-07-10' },
  { id: '3', description: 'home.historyRedeemVoucher', amount: -500, date: '2025-07-08' },
  { id: '4', description: 'home.historyBookedSgDl', amount: 120, date: '2025-07-01' },
  { id: '5', description: 'home.historyBookedHnHp', amount: 30, date: '2025-06-25' },
]

export function getTier(points: number): Tier {
  return TIERS.find((t) => points >= t.min && points <= t.max) ?? TIERS[TIERS.length - 1]
}

export function getNextTier(points: number): Tier | null {
  const currentTier = getTier(points)
  const currentIdx = TIERS.findIndex((t) => t.key === currentTier.key)
  // TIERS are ordered from highest to lowest, so"next"is the one above (lower index)
  if (currentIdx > 0) return TIERS[currentIdx - 1]
  return null
}
