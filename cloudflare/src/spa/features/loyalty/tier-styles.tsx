// Extracted from the original 'loyalty-widget.tsx'.
//
// REAL-DATA REWORK (2026-09): tiers, thresholds, benefits and the
// earning history now come from the backend (`GET /api/loyalty`,
// computed from the user's completed bookings). This module only holds
// PRESENTATION metadata keyed by the backend's tier/benefit codes —
// the data itself is never invented here.

import { Crown, Trophy, Medal, Star } from 'lucide-react'

/** Visual styling per backend tier key (bronze/silver/gold/platinum). */
export const TIER_STYLES: Record<
  string,
  { icon: React.ReactNode; color: string; bg: string; ring: string }
> = {
  platinum: {
    icon: <Crown className="h-5 w-5" />,
    color: 'text-violet-600',
    bg: 'bg-violet-100',
    ring: '#7c3aed',
  },
  gold: {
    icon: <Trophy className="h-5 w-5" />,
    color: 'text-amber-600',
    bg: 'bg-amber-100',
    ring: '#d97706',
  },
  silver: {
    icon: <Medal className="h-5 w-5" />,
    color: 'text-slate-500',
    bg: 'bg-slate-100',
    ring: '#64748b',
  },
  bronze: {
    icon: <Star className="h-5 w-5" />,
    color: 'text-orange-600',
    bg: 'bg-orange-100',
    ring: '#ea580c',
  },
}

export const DEFAULT_TIER_STYLE = TIER_STYLES.bronze

/** Backend benefit code → i18n key. The tier→benefit mapping itself is
 *  backend-owned; this table only translates the codes for display. */
export const BENEFIT_LABELS: Record<string, string> = {
  earn_points: 'home.benefitEarnPoints',
  redeem_voucher: 'home.benefitRedeemVoucher',
  discount_5: 'home.benefitDiscount5',
  voucher_25k: 'home.benefitVoucher25k',
  discount_10: 'home.benefitDiscount10',
  priority_seat: 'home.benefitPrioritySeat',
  voucher_60k: 'home.benefitVoucher60k',
  discount_15: 'home.benefitDiscount15',
  free_refund: 'home.benefitFreeRefund',
  voucher_150k: 'home.benefitVoucher150k',
}
