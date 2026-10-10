import { useQuery } from '@tanstack/react-query'
import { campaignsListOptions, couponsMineOptions, type CouponOut } from '@/api'
import { getErrorMessage } from '@/lib/error-message'
import type { useT } from '@/lib/i18n'
import { isStaffUser, useSession } from '@/stores/session'

/**
 * Running and upcoming campaigns, served from the server's cache (claims keep
 * its slot counts current; claiming itself is exact).
 */
export function useCampaigns() {
  return useQuery({ ...campaignsListOptions(), staleTime: 15_000 })
}

/** Only customer accounts hold coupons; guests and staff never ask. */
export function useIsCustomer() {
  const user = useSession((s) => s.user)
  return !!user && !isStaffUser(user)
}

/** The coupon this customer holds (if any) and the campaigns they claimed from. */
export function useMyCoupons() {
  return useQuery({ ...couponsMineOptions(), enabled: useIsCustomer(), staleTime: 15_000 })
}

/** Whether the coupon may be used with this operator. */
export const coversBrand = (coupon: CouponOut, brandId: string | null | undefined) =>
  coupon.allBrands || (!!brandId && coupon.brands.some((b) => b.id === brandId))

/** The stable codes the API ends a coupon error's message with (see `docs/CAMPAIGNS.md`). */
const ERROR_KEYS: Record<string, string> = {
  customers_only: 'campaigns.err.customersOnly',
  campaign_not_running: 'campaigns.err.notRunning',
  coupon_already_held: 'campaigns.err.alreadyHeld',
  campaign_already_claimed: 'campaigns.err.alreadyClaimed',
  tier_sold_out: 'campaigns.err.soldOut',
  try_again: 'campaigns.err.tryAgain',
  coupon_unavailable: 'campaigns.err.unavailable',
  coupon_expired: 'campaigns.err.expired',
  coupon_not_for_this_operator: 'campaigns.err.wrongOperator',
}

/** The code of a coupon error, or undefined for any other failure. */
export function couponErrorCode(error: unknown): string | undefined {
  const message = getErrorMessage(error, '')
  return Object.keys(ERROR_KEYS).find((code) => message.endsWith(code))
}

/** What to tell the customer about a coupon error, in their language. */
export function couponErrorText(error: unknown, t: ReturnType<typeof useT>): string | undefined {
  const code = couponErrorCode(error)
  return code ? t(ERROR_KEYS[code]) : undefined
}
