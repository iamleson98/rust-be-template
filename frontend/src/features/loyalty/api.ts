import { useQuery } from '@tanstack/react-query'
import { loyaltySummaryOptions, type LoyaltyResponse } from '@/api'
import { useSession } from '@/stores/session'
import { DEFAULT_TIER_STYLE, TIER_STYLES } from './tier-styles'

/** The signed-in customer's loyalty summary (idle while signed out). */
export function useLoyalty() {
  const signedIn = useSession((s) => !!s.user)
  return useQuery({ ...loyaltySummaryOptions(), enabled: signedIn })
}

/** Tier look and 0–100 progress toward the next tier (100 at the top tier). */
export function tierView(summary: LoyaltyResponse | undefined) {
  const { tier, nextTier } = summary ?? {}
  const style = (tier && TIER_STYLES[tier.key]) || DEFAULT_TIER_STYLE
  const progress =
    summary && tier && nextTier
      ? Math.min(
          100,
          Math.max(
            0,
            ((summary.points - tier.minPoints) / Math.max(1, nextTier.minPoints - tier.minPoints)) *
              100,
          ),
        )
      : 100
  return { tier, nextTier, style, progress }
}
